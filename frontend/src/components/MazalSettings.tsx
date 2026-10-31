import { useEffect, useRef, useState } from 'react'
import { clearData, exportData, importData, useStore } from '../store'
import { siteConfig } from '../lib/siteConfig'

export default function MazalSettings() {
  const open = useStore((state) => state.showSettings)
  const close = useStore((state) => state.setShowSettings)
  const settings = useStore((state) => state.settings)
  const setSettings = useStore((state) => state.setSettings)
  const confirm = useStore((state) => state.setConfirmDialog)
  const [tab, setTab] = useState<'preferences' | 'data' | 'about'>('preferences')
  const dialog = useRef<HTMLDialogElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open) dialog.current?.close()
  }, [open])

  return <dialog ref={dialog} onCancel={() => close(false)} onClick={(event) => { if (event.target === event.currentTarget) close(false) }} className="w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-0 shadow-xl backdrop:bg-black/40">
    <div className="p-5 border-b border-gray-100 dark:border-white/10 flex items-center justify-between"><h2 className="text-lg font-semibold">偏好与数据</h2><button aria-label="关闭设置" onClick={() => close(false)} className="p-2 text-gray-500">✕</button></div>
    <div className="px-5 pt-4 flex gap-2 text-sm">{([['preferences', '偏好'], ['data', '本地数据'], ['about', '关于']] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-2 ${tab === id ? 'bg-blue-50 text-blue-600 dark:bg-blue-950' : 'text-gray-500'}`}>{label}</button>)}</div>
    <div className="p-5 space-y-5 text-sm max-h-[65vh] overflow-y-auto">
      {tab === 'preferences' && <>
        <label className="flex justify-between items-center">外观<select aria-label="外观" value={settings.colorMode} onChange={(event) => setSettings({ colorMode: event.target.value as typeof settings.colorMode })} className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <label className="flex justify-between items-center gap-4">参考图编辑方式<select aria-label="参考图编辑方式" value={settings.referenceImageEditAction} onChange={(event) => setSettings({ referenceImageEditAction: event.target.value as typeof settings.referenceImageEditAction })} className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2"><option value="ask">每次询问</option><option value="sketch">画板标注</option><option value="mask">遮罩重绘</option></select></label>
        <label className="flex justify-between gap-4">按 Enter 提交<input type="checkbox" checked={settings.enterSubmit} onChange={(event) => setSettings({ enterSubmit: event.target.checked })} /></label>
        <label className="flex justify-between gap-4">生成后清空描述<input type="checkbox" checked={settings.clearInputAfterSubmit} onChange={(event) => setSettings({ clearInputAfterSubmit: event.target.checked })} /></label>
        <label className="flex justify-between gap-4">显示批量创作入口<input type="checkbox" checked={settings.showBatchPrompt} onChange={(event) => setSettings({ showBatchPrompt: event.target.checked, batchPromptMode: 'queue', batchPromptConcurrency: 1 })} /></label>
        <p className="text-xs leading-6 text-gray-500">张数可选 1～4 张，每张建立独立任务，按主站规则计费。多条描述可共用参考图和参数，每批最多 16 张，按顺序生成；停止只影响尚未提交的图片。局部编辑由模型参考遮罩修改，不能保证遮罩外像素完全不变。</p>
      </>}
      {tab === 'data' && <>
        <p className="text-xs leading-6 text-gray-500">对话、草稿和作品按当前登录密钥保存在此浏览器。退出不会删除作品；清除浏览器数据会丢失本地记录。服务器缓存约保留 3 天，并可能因容量限制提前清理。</p>
        <button onClick={() => { close(false); void exportData({ exportConfig: false, exportTasks: true }) }} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-white">导出对话与作品备份（不含密钥）</button>
        <input ref={importInput} type="file" accept=".zip" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) { close(false); void importData(files, { importConfig: false, importTasks: true }) } }} />
        <button onClick={() => importInput.current?.click()} className="w-full rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">导入作品备份</button>
        <button onClick={() => { close(false); confirm({ title: '清空本地作品', message: '这会删除当前密钥在此浏览器中的对话、草稿、作品和参考图。请先下载或导出重要作品。', confirmText: '清空作品', action: () => { void clearData({ clearConfig: false, clearTasks: true }) } }) }} className="w-full rounded-xl border border-red-200 dark:border-red-900 px-4 py-3 text-red-600">清空本地作品</button>
      </>}
      {tab === 'about' && <>
        <p className="font-semibold">{siteConfig.name} · 整合版 1.1</p>
        <p className="text-xs leading-6 text-gray-500">由主站提供密钥验证、权限与计费，结合绘图工作区和账号池引擎。</p>
        <a className="block text-blue-600" href="https://github.com/CookSleep/gpt_image_playground" target="_blank" rel="noreferrer">gpt_image_playground · MIT</a>
        <a className="block text-blue-600" href="https://github.com/basketikun/chatgpt2api" target="_blank" rel="noreferrer">chatgpt2api · 项目来源</a>
        <a className="block text-blue-600" href="/licenses/" target="_blank" rel="noreferrer">许可与第三方声明</a>
      </>}
    </div>
  </dialog>
}
