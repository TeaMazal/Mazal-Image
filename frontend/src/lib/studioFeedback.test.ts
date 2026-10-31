import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import { getStudioFailureAdvice, getStudioTaskPhase } from './studioFeedback'

describe('studio task feedback', () => {
  it.each([
    ['HTTP 401 Unauthorized', '检查登录密钥'],
    ['HTTP 403 Forbidden', '检查绘图访问权限'],
    ['Upstream access forbidden, please contact administrator', '检查绘图访问权限'],
    ['insufficient quota', '检查额度与权限'],
    ['429 rate_limit_exceeded', '稍等片刻再试'],
    ['content_policy_violation', '调整提示词或参考图'],
    ['upstream connection timed out', '先检查任务状态'],
    ['无法读取参考图', '检查本轮输入后重试'],
  ])('provides actionable advice for %s', (error, title) => {
    expect(getStudioFailureAdvice(error).title).toBe(title)
  })

  it('keeps recoverable tasks running until recovery completes', () => {
    const task = { status: 'error', customRecoverable: true } as TaskRecord
    expect(getStudioTaskPhase(task)).toBe('running')
    expect(getStudioTaskPhase({ ...task, customRecoverable: false })).toBe('error')
    expect(getStudioTaskPhase({ ...task, customRecoverable: false, status: 'done' })).toBe('done')
  })
})
