export const MAX_MAZAL_OUTPUT_IMAGES = 4
export const MAX_MAZAL_BATCH_TASKS = 16

export function createMazalPromptQueue(prompts: string[], count: number) {
  const copies = Math.min(MAX_MAZAL_OUTPUT_IMAGES, Math.max(1, Number.isFinite(count) ? Math.floor(count) : 1))
  const clean = prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (clean.length * copies > MAX_MAZAL_BATCH_TASKS) throw new Error(`每批最多 ${MAX_MAZAL_BATCH_TASKS} 张，请减少描述或张数后再提交。`)
  return clean.flatMap((prompt) => Array.from({ length: copies }, () => prompt))
}
