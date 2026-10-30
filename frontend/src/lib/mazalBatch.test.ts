import { describe, expect, it } from 'vitest'
import { createMazalPromptQueue } from './mazalBatch'

describe('Mazal 图片队列', () => {
  it('每条描述展开为独立图片，保持描述顺序', () => {
    expect(createMazalPromptQueue([' 第一张 ', '第二张'], 2)).toEqual(['第一张', '第一张', '第二张', '第二张'])
  })

  it('清洗导入的张数，并限制一批的总任务数', () => {
    expect(createMazalPromptQueue(['图'], 100)).toHaveLength(4)
    expect(createMazalPromptQueue(['图'], Number.NaN)).toHaveLength(1)
    expect(createMazalPromptQueue(['图'], -1)).toHaveLength(1)
    expect(createMazalPromptQueue(['a', 'b', 'c', 'd'], 4)).toHaveLength(16)
    expect(() => createMazalPromptQueue(['a', 'b', 'c', 'd', 'e'], 4)).toThrow('每批最多 16 张')
  })
})
