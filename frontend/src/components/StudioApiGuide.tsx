import { useState } from 'react'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { siteConfig } from '../lib/siteConfig'

export default function StudioApiGuide() {
  const baseUrl = `${window.location.origin}/v1`
  const [copied, setCopied] = useState('')
  const [message, setMessage] = useState('')
  const generation = `curl --max-time 600 '${baseUrl}/images/generations' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"gpt-image-2","prompt":"一只坐在窗边的橘猫，暖色日光，写实摄影","n":1,"size":"1024x1024","response_format":"b64_json"}'`
  const edit = `curl --max-time 600 '${baseUrl}/images/edits' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -F 'model=gpt-image-2' \\
  -F 'prompt=保持主体不变，将背景改为浅色摄影棚' \\
  -F 'image=@reference.png' \\
  -F 'n=1' \\
  -F 'size=1024x1024' \\
  -F 'response_format=b64_json'`

  async function copy(label: string, value: string) {
    try {
      await copyTextToClipboard(value)
      setCopied(label)
      setMessage(`已复制${label}`)
    } catch (error) {
      console.warn('复制 API 接入信息失败', error)
      setCopied('')
      setMessage(getClipboardFailureMessage('复制失败，请选中内容手动复制。', error))
    }
  }

  return <section className="studio-api-guide" aria-labelledby="studio-api-title">
    <h3 id="studio-api-title">在你喜欢的工具里继续创作</h3>
    <p>选择支持 OpenAI Images 接口的工具，填写以下配置。仅支持聊天的工具可能无法调用生图接口。</p>
    <dl className="studio-api-fields">
      {[
        ['Base URL', baseUrl, '填写在工具的接口地址栏；若工具自动添加 /v1，请只填域名。'],
        ['模型名称', 'gpt-image-2', '填写在工具的模型栏。'],
        ['生图接口', `${baseUrl}/images/generations`, 'POST · JSON 请求'],
        ['改图接口', `${baseUrl}/images/edits`, 'POST · multipart/form-data，上传参考图文件'],
      ].map(([label, value, hint]) => <div key={label}>
        <dt>{label}</dt>
        <dd><div><code>{value}</code><button type="button" aria-label={`复制${label}`} onClick={() => void copy(label, value)}>{copied === label ? '已复制' : '复制'}</button></div><small>{hint}</small></dd>
      </div>)}
    </dl>
    <div className="studio-api-feedback" role="status">{message}</div>
    <div className="studio-help-note">
      <strong>使用主站绘图密钥，共用账户余额</strong>
      <p>API Key 使用主站签发、所属分组已开放绘图权限的密钥。接口调用与网页生图共用余额，价格与实际扣费以主站分组配置及用量记录为准。</p>
      <div className="studio-api-links"><a href={`${siteConfig.mainOrigin}/keys`} target="_blank" rel="noreferrer">获取或管理密钥 ↗</a><a href={`${siteConfig.mainOrigin}/usage`} target="_blank" rel="noreferrer">查看用量与扣费 ↗</a></div>
    </div>
    <details className="studio-api-examples">
      <summary>Infinite Canvas · 接入设置</summary>
      <p><a href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noreferrer">项目与下载 ↗</a></p>
      <ol>
        <li>在 API 配置中添加渠道，接口格式选 OpenAI，地址填写 <code>{baseUrl}</code>。</li>
        <li>API Key 填主站绘图密钥，添加图片模型 <code>gpt-image-2</code>，并选为生图模型。</li>
        <li>使用内置图片接口即可。上传参考图后会调用改图接口，支持多张参考图。</li>
      </ol>
    </details>
    <details className="studio-api-examples">
      <summary>AI Canvas · 接入设置</summary>
      <p><a href="https://github.com/Tenney95/AI-Canvas-tauri" target="_blank" rel="noreferrer">项目与下载 ↗</a></p>
      <ol>
        <li>添加 OpenAI 兼容连接，地址填写 <code>{baseUrl}</code>，API Key 填主站绘图密钥。</li>
        <li>添加图片模型 <code>gpt-image-2</code>，快捷适配选「GPT Image 2 · OpenAI 官方 Images」。</li>
        <li>若手动配置，协议预设选 <code>openai-gpt-image</code>，参考图请求选 <code>edits-multipart</code>（上传文件）。</li>
      </ol>
      <p>该预设能读取 Base64 图片；改图时请使用文件上传模式。</p>
    </details>
    <p className="studio-api-key-note">两款工具建议先用 1024×1024、画质 auto、1 张测试；单次图片接口支持 1–4 张。返回格式保留默认即可。生成与改图均按主站规则计费；客户端中的 GPT Image 2.5 选项不代表本站账号池支持该模型。</p>
    <details className="studio-api-examples">
      <summary>调用示例 · cURL</summary>
      <p>以下命令适用于 Bash 等终端。请在自己的环境中将 YOUR_API_KEY 替换为绘图密钥；改图时将 reference.png 替换为本地图片路径。</p>
      {[[ '生图示例', generation ], [ '改图示例', edit ]].map(([label, value]) => <div className="studio-api-example" key={label}>
        <div><strong>{label}</strong><button type="button" aria-label={`复制${label}`} onClick={() => void copy(label, value)}>{copied === label ? '已复制' : '复制示例'}</button></div>
        <pre tabIndex={0} aria-label={label}><code>{value}</code></pre>
      </div>)}
      <p>示例请求返回的 data[].b64_json 是图片的 Base64 内容。生图耗时较长，请为工具预留等待时间；超时后先核对用量，避免自动重试造成重复扣费。</p>
    </details>
    <p className="studio-api-key-note">请妥善保管密钥，不要将完整密钥放入截图、公开代码或分享给他人。</p>
  </section>
}
