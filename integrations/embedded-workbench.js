/** 在已登录主站内挂载绘图页。requestTicket 由主站自己的 API 客户端提供。 */
export function createWorkbench({ container, origin, keyId, requestTicket, onState = () => {}, onError = () => {} }) {
  const url = new URL(origin)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('origin must contain only the drawing site origin')
  }
  if (!Number.isSafeInteger(keyId) || keyId <= 0) throw new Error('Invalid keyId')
  const targetOrigin = url.origin
  const frame = document.createElement('iframe')
  frame.name = 'mazal-image-' + crypto.randomUUID()
  frame.title = '图片创作工作区'
  frame.style.cssText = 'display:block;border:0;width:100%;height:100%;min-height:500px'
  frame.referrerPolicy = 'origin'
  frame.allow = 'clipboard-write'
  let stopped = false
  let pending = ''
  let connected = false
  let navigations = 0
  // 浏览器刷新可能恢复空白子文档；收到握手前最多重载两次，不重试生图请求。
  const navigation = window.setInterval(() => {
    if (stopped || connected || pending || navigations >= 2) {
      window.clearInterval(navigation)
      return
    }
    navigations += 1
    frame.src = targetOrigin + '/?embed=mazal'
  }, 5000)
  let timeout = window.setTimeout(() => onError(new Error('绘图连接超时，请重新连接或使用独立绘图页')), 35000)
  async function receive(event) {
    if (stopped || event.origin !== targetOrigin || event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return
    const data = event.data
    if (data.type === 'mazal-image-connected') {
      connected = true
      window.clearTimeout(timeout)
      window.clearInterval(navigation)
      onState({ connected: true })
      return
    }
    if (data.type === 'mazal-image-state') return onState({ active: data.active === true })
    if (data.type === 'mazal-image-error') {
      window.clearTimeout(timeout)
      return onError(new Error('绘图登录交接失败，请重新连接'))
    }
    if (data.type !== 'mazal-image-ready' || !/^[A-Za-z0-9_-]{20,128}$/.test(data.nonce) || pending === data.nonce) return
    // 子文档重新加载后内存会话已消失；新 nonce 必须重新兑换，不能沿用父页连接状态。
    connected = false
    pending = data.nonce
    window.clearInterval(navigation)
    window.clearTimeout(timeout)
    timeout = window.setTimeout(() => onError(new Error('绘图连接超时，请重新连接或使用独立绘图页')), 35000)
    onState({ connected: false })
    try {
      const result = await requestTicket({ key_id: keyId, nonce: data.nonce })
      if (!stopped && pending === data.nonce) {
        frame.contentWindow.postMessage({ type: 'mazal-image-ticket', nonce: data.nonce, ticket: result.ticket }, targetOrigin)
      }
    } catch {
      if (!stopped && pending === data.nonce) {
        window.clearTimeout(timeout)
        onError(new Error('主站无法签发绘图票据，请检查密钥权限'))
      }
    }
  }
  window.addEventListener('message', receive)
  // 监听器先就绪，挂载时直接加载目标文档，避免额外的空白页导航。
  frame.src = targetOrigin + '/?embed=mazal'
  container.appendChild(frame)
  return {
    frame,
    openSettings() { frame.contentWindow?.postMessage({ type: 'mazal-image-open-settings' }, targetOrigin) },
    destroy() {
      stopped = true
      window.clearTimeout(timeout)
      window.clearInterval(navigation)
      window.removeEventListener('message', receive)
      frame.remove()
    },
  }
}
