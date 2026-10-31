import { useState } from 'react'
import type { StudioConversation, TaskRecord } from '../types'
import { useStore } from '../store'
import { useVisibleTasks } from '../hooks/usePrivacyMode'
import { getStudioConversationId } from '../lib/studioConversations'
import { requestDeleteStudioConversation } from '../lib/studioActions'
import { groupStudioRounds } from '../lib/studioRounds'

function ConversationRow({ conversation, tasks, close }: { conversation: StudioConversation; tasks: TaskRecord[]; close: () => void }) {
  const activeId = useStore((state) => state.activeStudioConversationId)
  const select = useStore((state) => state.setActiveStudioConversationId)
  const rename = useStore((state) => state.renameStudioConversation)
  const pin = useStore((state) => state.toggleStudioConversationPin)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(conversation.title)
  const [menu, setMenu] = useState(false)
  const activeHasDraft = useStore((state) => state.activeStudioConversationId === conversation.id && Boolean(state.prompt || state.inputImages.length))
  const running = tasks.filter((task) => task.status === 'running' || task.customRecoverable || task.falRecoverable).length
  const images = tasks.reduce((sum, task) => sum + task.outputImages.length, 0)
  return <div className="studio-conversation-row" data-active={activeId === conversation.id}>
    {editing ? <form className="studio-rename" onSubmit={(event) => { event.preventDefault(); if (name.trim()) { rename(conversation.id, name); setEditing(false) } }}>
      <input autoFocus aria-label="对话名称" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false) }} />
      <div><button type="submit" disabled={!name.trim()}>保存</button><button type="button" onClick={() => setEditing(false)}>取消</button></div>
    </form> : <>
      <button className="studio-conversation-select" aria-current={activeId === conversation.id ? 'true' : undefined} onClick={() => { select(conversation.id); close() }}>
        <span className="studio-conversation-title">{conversation.pinned && <span className="studio-pin" aria-label="已置顶">⌑</span>}{conversation.title}</span>
        <span className="studio-conversation-meta">{running ? <span role="status" className="studio-conversation-running">生成中 · {running}</span> : images ? `${images} 张图片 · ${groupStudioRounds(tasks).length} 轮创作` : activeHasDraft || conversation.draft.prompt || conversation.draft.inputImages.length ? '有未提交的草稿' : '等待第一个灵感'}</span>
      </button>
      <button className="studio-conversation-menu-trigger" aria-label={`管理对话：${conversation.title}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>···</button>
      {menu && <div className="studio-conversation-menu">
        <button onClick={() => { setName(conversation.title); setEditing(true); setMenu(false) }}>重命名</button>
        <button onClick={() => { pin(conversation.id); setMenu(false) }}>{conversation.pinned ? '取消置顶' : '置顶对话'}</button>
        <button className="studio-menu-danger" onClick={() => { setMenu(false); requestDeleteStudioConversation(conversation.id) }}>删除对话</button>
        <button onClick={() => setMenu(false)}>收起菜单</button>
      </div>}
    </>}
  </div>
}

export default function StudioSidebar({ open, close }: { open: boolean; close: () => void }) {
  const conversations = useStore((state) => state.studioConversations)
  const create = useStore((state) => state.createStudioConversation)
  const privacyMode = useStore((state) => Boolean(state.privacyMode))
  const tasks = useVisibleTasks()
  const [query, setQuery] = useState('')
  const visible = conversations.filter((conversation) => (!privacyMode || tasks.some((task) => getStudioConversationId(task) === conversation.id)) && conversation.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  return <>
    {open && <button className="studio-sidebar-scrim" aria-label="关闭对话列表" onClick={close} />}
    <aside className="studio-sidebar" data-open={open} aria-label="创作对话">
      <div className="studio-sidebar-title"><span>我的对话</span><button className="studio-sidebar-close" aria-label="收起对话列表" onClick={close}>✕</button></div>
      <button className="studio-new" onClick={() => { create(); close() }}><span aria-hidden="true">＋</span>新建对话</button>
      <label className="studio-conversation-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜索对话" placeholder="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="studio-conversation-list">
        {visible.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} tasks={tasks.filter((task) => getStudioConversationId(task) === conversation.id)} close={close} />)}
        {!visible.length && <p className="studio-side-empty">{query ? '没有匹配的对话' : '新建一个对话，开始你的创作。'}</p>}
      </div>
      <p className="studio-sidebar-note">对话与作品保存在此浏览器<br /><span>重要作品可在设置中导出备份</span></p>
    </aside>
  </>
}
