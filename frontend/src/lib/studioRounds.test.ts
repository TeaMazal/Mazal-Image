import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getStudioRoundTasks, getStudioRoundTotal, groupStudioRounds } from './studioRounds'

const task = (id: string, patch: Partial<TaskRecord> = {}): TaskRecord => ({ id, studioConversationId: 'a', prompt: '同一个提示词', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1, ...patch })

describe('studio submission rounds', () => {
  it('keeps late results in their original round in image order', () => {
    const a = task('first', { studioRoundId: 'r', studioRoundIndex: 0, studioRoundTotal: 2, outputImages: ['one'] })
    const b = task('second', { studioRoundId: 'r', studioRoundIndex: 1, studioRoundTotal: 2, createdAt: 9, status: 'running' })
    expect(getStudioRoundTotal([a])).toBe(2)
    expect(groupStudioRounds([b, a])).toEqual([[a, b]])
    expect(getStudioRoundTasks([b, a], b)).toEqual([a, b])
  })
  it('does not merge historical retries with identical prompts or cross conversations', () => {
    const a = task('a')
    const b = task('b')
    const c = task('c', { studioRoundId: 'r' })
    const d = task('d', { studioRoundId: 'r', studioConversationId: 'b' })
    expect(groupStudioRounds([a, b, c, d])).toHaveLength(4)
    expect(getStudioRoundTasks([a, b, c, d], c)).toEqual([c])
  })
})
