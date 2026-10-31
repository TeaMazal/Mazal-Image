import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getMazalSession } from '../lib/mazalSession'
import { guideStorageKey, siteConfig } from '../lib/siteConfig'
import StudioApiGuide from './StudioApiGuide'
import '../studio.css'

type HelpTopic = 'start' | 'billing' | 'edit' | 'failures' | 'api'
const topics: Array<[HelpTopic, string]> = [['start', '开始创作'], ['billing', '额度与价格'], ['edit', '参考图改图'], ['failures', '遇到问题'], ['api', 'API 接入']]

function StudioHelpDialog({ initialTopic, close }: { initialTopic: HelpTopic; close: () => void }) {
  const [topic, setTopic] = useState(initialTopic)
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => { content.current?.scrollTo(0, 0) }, [topic])
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return createPortal(<dialog className="studio-help-dialog" ref={dialog} aria-labelledby="studio-help-title" onCancel={(event) => { event.preventDefault(); close() }} onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="studio-help-panel">
      <header><div><p>{siteConfig.name} · 使用指南</p><h2 id="studio-help-title">从第一个想法，到下一轮创作</h2></div><button autoFocus aria-label="关闭使用帮助" onClick={close}>×</button></header>
      <nav aria-label="帮助主题">{topics.map(([id, title]) => <button key={id} aria-current={topic === id ? 'page' : undefined} onClick={() => setTopic(id)}>{title}</button>)}</nav>
      <div className="studio-help-content" ref={content}>
        {topic === 'api' && <StudioApiGuide />}
        {topic === 'start' && <>
          <h3>一个主题，放进一个对话</h3><ol><li><strong>新建对话</strong><p>描述主体、场景、风格和需要保留的细节，选择尺寸与张数后生成。首次提交的提示词会成为对话名称，也可以手动重命名。</p></li><li><strong>边等待，边整理灵感</strong><p>生成时可以切换对话；完成通知中的“查看结果”会带你回到对应轮次。刷新页面后，使用同一密钥可继续查询任务。</p></li><li><strong>从结果接着创作</strong><p>“继续修改”会把选中的图片作为下一轮参考图；“再生成一轮”会使用原来的输入重新生成，并保留原作品。</p></li></ol>
          <div className="studio-help-note"><strong>作品保存在当前浏览器</strong><p>对话、草稿和作品按登录密钥隔离。换设备或清除浏览器数据后不会自动同步。重要作品请下载，或在“设置 → 数据”导出备份。</p></div>
        </>}
        {topic === 'billing' && <>
          <h3>先了解额度，再开始生成</h3><p>顶部显示主站返回的钱包余额或密钥额度，金额单位为美元（USD）。点击金额可刷新并查看详情。</p>
          <dl><dt>钱包余额</dt><dd>主站账户中的可用余额。密钥设置的独立额度与使用限额也会影响能否生成。</dd><dt>密钥额度与周期限额</dt><dd>分别限制当前密钥的总用量和一定时间内的用量。钱包有余额时，仍可能触及这些限制。</dd><dt>图片价格</dt><dd>按当前密钥所属绘图分组、图片尺寸和站点配置计算。不同分组的价格可能不同，最终扣费以主站用量账单为准。</dd></dl>
          <div className="studio-help-note"><strong>关于重试和部分成功</strong><p>“再生成一轮”和“重试”都会提交新请求，成功返回的图片会计费。连接中断时请先检查原任务和主站账单；部分成功时保留已完成的图片，再决定是否重新生成整轮。</p></div>
          <a className="studio-help-main-link" href={siteConfig.mainOrigin} target="_blank" rel="noreferrer">到主站查看分组价格、账户与用量 ↗</a>
        </>}
        {topic === 'edit' && <>
          <h3>把“保持什么”和“修改什么”说清楚</h3><ol><li><strong>选择一张作品，点击“继续修改”</strong><p>它会成为输入区的参考图。也可以点击输入区的“＋”上传自己的图片。</p></li><li><strong>写下这一轮的具体变化</strong><p>例如：“保持同一只猫、窗台和花园构图，只把红色围巾改成蓝色，保持写实摄影。”</p></li><li><strong>确认参考图，再生成</strong><p>每一轮的参考图、提示词和结果分别保存。模型会依据本轮提交的文字与参考图处理，请在每轮写明需要保留的内容。</p></li></ol>
          <div className="studio-help-note"><strong>想尝试另一条创作方向？</strong><p>点击图片上的“↗”可用它新建对话；从作品画廊点击“回到原对话”则能定位到它所在的轮次。</p></div>
        </>}
        {topic === 'failures' && <>
          <h3>先查看原因，避免重复提交</h3><dl><dt>密钥无效或没有绘图权限</dt><dd>到主站检查密钥状态、有效期及所属绘图分组，再重新登录。</dd><dt>余额不足或达到限额</dt><dd>同时检查钱包、密钥额度和周期限额。等待周期恢复或到主站处理额度。</dd><dt>服务繁忙、限流</dt><dd>等待片刻，或等已有任务完成后再试，避免反复点击生成。</dd><dt>内容被拒绝</dt><dd>调整提示词或更换参考图后重新提交。</dd><dt>网络异常或等待超时</dt><dd>先刷新查询原任务、核对主站用量。连接中断不一定代表图片没有生成，确认失败后再重试。</dd></dl><p>每轮下方会保留错误提示。联系管理员时可提供生成时间和错误内容；请勿发送完整 API 密钥。</p>
        </>}
      </div>
      <footer><button onClick={close}>明白了，继续创作</button><span>随时可从顶部“使用帮助”再次打开</span></footer>
    </div>
  </dialog>, document.body)
}

export default function StudioHelpButton({ topic = 'start', children = '使用帮助', className = '' }: { topic?: HelpTopic; children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>{open && <StudioHelpDialog initialTopic={topic} close={() => setOpen(false)} />}</>
}

export function StudioWelcome() {
  const key = `${guideStorageKey}-${getMazalSession()?.subject_id || 'guest'}`
  const [visible, setVisible] = useState(() => { try { return localStorage.getItem(key) !== 'seen' } catch { return true } })
  if (!visible) return null
  return <aside className="studio-welcome" aria-label="创作入门提示"><div><strong>开始前，了解一下你的创作空间</strong><p>查看额度与计费，了解如何用参考图继续修改。</p></div><StudioHelpButton topic="billing">额度与价格</StudioHelpButton><StudioHelpButton topic="edit">如何改图</StudioHelpButton><button aria-label="收起入门提示" onClick={() => { setVisible(false); try { localStorage.setItem(key, 'seen') } catch { /* 无法持久保存时仅收起本次提示。 */ } }}>×</button></aside>
}
