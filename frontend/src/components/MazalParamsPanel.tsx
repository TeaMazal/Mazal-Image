import { getMazalSession } from '../lib/mazalSession'
import type { TaskParams } from '../types'
import ParamPopoverChip from './input/paramPopoverChip'
import { MAX_MAZAL_BATCH_TASKS, MAX_MAZAL_OUTPUT_IMAGES } from '../lib/mazalBatch'

export default function MazalParamsPanel({ model, onModelChange, params, setParams, displaySize, onOpenSizePicker, batchEnabled, batchProgress, batchPromptCount, onBatchChange, onStopBatch, showBatch, onClearPrompt }: {
  model: string
  onModelChange: (model: string) => void
  params: TaskParams
  setParams: (patch: Partial<TaskParams>) => void
  displaySize: string
  onOpenSizePicker: () => void
  batchEnabled: boolean
  batchProgress: { started: number; finished: number; total: number } | null
  batchPromptCount: number
  onBatchChange: (patch: { batchPromptEnabled?: boolean; batchPromptMode?: 'queue' | 'concurrent'; batchPromptConcurrency?: number }) => void
  onStopBatch: () => void
  showBatch: boolean
  onClearPrompt?: () => void
}) {
  const session = getMazalSession()
  const models = session?.image_model_catalog ?? (session?.models ?? ['gpt-image-2']).map((id) => ({ id, name: id, available: true }))
  return <div className="studio-image-params flex flex-wrap items-center gap-2 text-xs">
    <ParamPopoverChip label="模型" ariaLabel="选择绘图模型" summary={models.find((item) => item.id === model)?.name ?? model}>
      {(close) => <>
        <p className="text-xs font-medium text-gray-700 dark:text-gray-200">绘图模型</p>
        <div className="flex flex-col gap-2" role="group" aria-label="绘图模型选项">
          {models.map((item) => <button key={item.id} type="button" disabled={!item.available || Boolean(batchProgress)} aria-pressed={model === item.id} onClick={() => { onModelChange(item.id); close() }} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${model === item.id ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300'}`}><span>{item.name}</span><span>{item.available ? model === item.id ? '已选择' : '可用' : '暂未开放'}</span></button>)}
        </div>
        <p className="text-xs leading-5 text-gray-500">仅可选择已开放且当前密钥有权限的模型。所选模型用于接下来提交的创作。</p>
      </>}
    </ParamPopoverChip>
    <button onClick={onOpenSizePicker} className="rounded-full bg-black/[0.04] dark:bg-white/[0.06] px-3 py-2">尺寸 · {displaySize === 'auto' ? '自动' : displaySize}</button>
    <ParamPopoverChip label="张数" ariaLabel="生成张数" summary={`${params.n} 张`} disabled={Boolean(batchProgress)}>
      {(close) => <>
        <p className="text-xs font-medium text-gray-700 dark:text-gray-200">生成张数</p>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="生成张数选项">
          {Array.from({ length: MAX_MAZAL_OUTPUT_IMAGES }, (_, index) => index + 1).map((count) => <button key={count} type="button" aria-pressed={params.n === count} onClick={() => { setParams({ n: count }); close() }} className={`rounded-lg py-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${params.n === count ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'}`}>{count} 张</button>)}
        </div>
        <p className="text-xs leading-5 text-gray-500">多张图片同时提交，逐张计费，结果陆续显示。</p>
      </>}
    </ParamPopoverChip>
    <ParamPopoverChip label="更多设置" summary={params.transparent_output ? '透明背景' : undefined} active={params.transparent_output}>
      {(close) => <>
      <label className="flex items-center justify-between gap-5 text-xs">生成透明背景<input aria-label="生成透明背景" type="checkbox" checked={params.transparent_output} onChange={(event) => setParams({ transparent_output: event.target.checked })} /></label>
      <p className="text-xs text-gray-500 leading-5">适合贴纸、图标和单主体素材。生成纯色背景后在本地去除，原图会保留，可在作品详情中对比和下载。复杂发丝、半透明物体可能有残边。</p>
      <p className="text-xs font-medium text-gray-700 dark:text-gray-200">质量</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="生成质量">
        {([{ value: 'auto', label: '自动' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }] as const).map((quality) => <button key={quality.value} type="button" aria-pressed={params.quality === quality.value} onClick={() => setParams({ quality: quality.value })} className={`rounded-lg py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${params.quality === quality.value ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'}`}>{quality.label}</button>)}
      </div>
      <p className="text-xs text-gray-500 leading-5">多张图片同时提交，逐张计费，结果陆续显示。输出 PNG；尺寸与质量作为生成要求，实际结果以模型返回为准。</p>
      {onClearPrompt && <button type="button" className="w-full border-t border-gray-200 pt-3 text-left text-xs text-gray-500 dark:border-white/10 dark:text-gray-400" onClick={() => { onClearPrompt(); close() }}>清空提示词文字</button>}
      </>}
    </ParamPopoverChip>
    {showBatch && <ParamPopoverChip label="批量" summary={batchProgress ? `${batchProgress.finished}/${batchProgress.total}` : batchEnabled ? `${batchPromptCount} 条` : undefined} active={batchEnabled}>
      <label className="flex items-center justify-between gap-5 text-xs">按多条描述排队<input type="checkbox" checked={batchEnabled} disabled={Boolean(batchProgress)} onChange={(event) => onBatchChange({ batchPromptEnabled: event.target.checked, batchPromptMode: 'queue', batchPromptConcurrency: 1 })} /></label>
      <p className="text-xs text-gray-500 leading-5">每条描述之间空两行，每条生成所选张数，每批最多 {MAX_MAZAL_BATCH_TASKS} 张。关闭或刷新页面后，尚未提交的图片不会继续执行。</p>
    </ParamPopoverChip>}
    {batchProgress ? <div role="status" className="flex flex-wrap items-center gap-3 basis-full text-gray-500"><span>批量进度 {batchProgress.finished}/{batchProgress.total} · 已提交 {batchProgress.started} 张</span><button className="text-red-600" onClick={onStopBatch}>停止后续任务</button><span>已提交的任务继续完成并按主站规则计费</span></div>
      : null}
  </div>
}
