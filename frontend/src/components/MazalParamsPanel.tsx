import type { TaskParams } from '../types'
import ParamPopoverChip from './input/paramPopoverChip'
import { MAX_MAZAL_BATCH_TASKS, MAX_MAZAL_OUTPUT_IMAGES } from '../lib/mazalBatch'

export default function MazalParamsPanel({ params, setParams, displaySize, onOpenSizePicker, batchEnabled, batchProgress, batchPromptCount, onBatchChange, onStopBatch, showBatch }: {
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
}) {
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <button onClick={onOpenSizePicker} className="rounded-full bg-black/[0.04] dark:bg-white/[0.06] px-3 py-2">尺寸 · {displaySize === 'auto' ? '自动' : displaySize}</button>
    <ParamPopoverChip label="张数" ariaLabel="生成张数" summary={`${params.n} 张`} disabled={Boolean(batchProgress)}>
      {(close) => <>
        <p className="text-xs font-medium text-gray-700 dark:text-gray-200">生成张数</p>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="生成张数选项">
          {Array.from({ length: MAX_MAZAL_OUTPUT_IMAGES }, (_, index) => index + 1).map((count) => <button key={count} type="button" aria-pressed={params.n === count} onClick={() => { setParams({ n: count }); close() }} className={`rounded-lg py-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${params.n === count ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'}`}>{count} 张</button>)}
        </div>
        <p className="text-xs leading-5 text-gray-500">多张图片按顺序生成，逐张计费。</p>
      </>}
    </ParamPopoverChip>
    <ParamPopoverChip label="更多设置" summary={params.transparent_output ? '透明背景' : undefined} active={params.transparent_output}>
      <label className="flex items-center justify-between gap-5 text-xs">生成透明背景<input aria-label="生成透明背景" type="checkbox" checked={params.transparent_output} onChange={(event) => setParams({ transparent_output: event.target.checked })} /></label>
      <p className="text-xs text-gray-500 leading-5">适合贴纸、图标和单主体素材。生成纯色背景后在本地去除，原图会保留，可在作品详情中对比和下载。复杂发丝、半透明物体可能有残边。</p>
      <p className="text-xs font-medium text-gray-700 dark:text-gray-200">质量</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="生成质量">
        {([{ value: 'auto', label: '自动' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }] as const).map((quality) => <button key={quality.value} type="button" aria-pressed={params.quality === quality.value} onClick={() => setParams({ quality: quality.value })} className={`rounded-lg py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${params.quality === quality.value ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'}`}>{quality.label}</button>)}
      </div>
      <p className="text-xs text-gray-500 leading-5">多张图片按顺序生成，逐张计费。输出 PNG；尺寸与质量作为生成要求，实际结果以模型返回为准。</p>
    </ParamPopoverChip>
    {showBatch && <ParamPopoverChip label="批量" summary={batchProgress ? `${batchProgress.finished}/${batchProgress.total}` : batchEnabled ? `${batchPromptCount} 条` : undefined} active={batchEnabled}>
      <label className="flex items-center justify-between gap-5 text-xs">按多条描述排队<input type="checkbox" checked={batchEnabled} disabled={Boolean(batchProgress)} onChange={(event) => onBatchChange({ batchPromptEnabled: event.target.checked, batchPromptMode: 'queue', batchPromptConcurrency: 1 })} /></label>
      <p className="text-xs text-gray-500 leading-5">每条描述之间空两行，每条生成所选张数，每批最多 {MAX_MAZAL_BATCH_TASKS} 张。关闭或刷新页面后，尚未提交的图片不会继续执行。</p>
    </ParamPopoverChip>}
    {batchProgress ? <div role="status" className="flex flex-wrap items-center gap-3 basis-full text-gray-500"><span>批量进度 {batchProgress.finished}/{batchProgress.total} · 已提交 {batchProgress.started} 张</span><button className="text-red-600" onClick={onStopBatch}>停止后续任务</button><span>已提交的任务继续完成并按主站规则计费</span></div>
      : null}
  </div>
}
