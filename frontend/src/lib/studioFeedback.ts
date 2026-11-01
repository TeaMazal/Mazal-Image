import type { TaskRecord } from '../types'

export function getStudioTaskPhase(task: TaskRecord) {
  return task.status === 'running' || task.customRecoverable || task.falRecoverable ? 'running' : task.status
}

export function getStudioFailureAdvice(error: string | null | undefined) {
  const text = error || ''
  if (/401|unauthori|invalid.*key|密钥.*(失效|无效|过期)|请先登录/i.test(text)) return { title: '检查登录密钥', message: '到主站确认密钥有效且已加入绘图分组，再用同一密钥重新登录。已有本地作品会保留。' }
  if (/403|forbidden|access.denied|无.*(权限|访问权)|访问.*(拒绝|禁止)/i.test(text)) return { title: '检查绘图访问权限', message: '到主站确认密钥所属分组已开放绘图。如果错误提示上游拒绝访问，请联系管理员检查绘图渠道和账号池，再决定是否重试。' }
  if (/402|insufficient|余额|额度不足|quota/i.test(text)) return { title: '检查额度与权限', message: '查看钱包余额、密钥额度和分组权限。钱包有余额时，密钥本身的额度或限额仍可能用尽。' }
  if (/429|rate.?limit|繁忙|并发|限流/i.test(text)) return { title: '稍等片刻再试', message: '当前请求较多或达到限额。等待正在进行的任务完成后，再提交这一轮。' }
  if (/policy|moderation|content.*(block|violation)|内容.*(政策|违规|拒绝)|安全策略/i.test(text)) return { title: '调整提示词或参考图', message: '图片服务拒绝了本次内容。请修改描述或更换参考图后再提交。' }
  if (/upstream.*(?:timeout|timed out)|dial tcp.*timeout|gateway.?timeout/i.test(text)) return { title: '绘图服务连接超时', message: '站点连接绘图服务超时。先刷新查询原任务和主站用量，确认失败后再重试；持续出现时请联系管理员检查服务连接。' }
  if (/upstream request failed|upstream.*(?:unavailable|connection|connect error)|\b50[0234]\b|bad gateway|service unavailable/i.test(text)) return { title: '绘图服务连接异常', message: '绘图服务暂时无法完成请求。先查询原任务和主站用量，确认失败后再重试；持续出现时请联系管理员检查服务连接。' }
  if (/timeout|timed out|超时|network|fetch|连接|网络/i.test(text)) return { title: '先检查任务状态', message: '连接异常不代表服务器已停止处理。先刷新查询原任务、查看主站用量，确认失败后再重试，避免重复请求。' }
  return { title: '检查本轮输入后重试', message: '检查提示词与参考图；如果持续失败，可携带本轮时间和错误提示联系站点管理员。重试会发起新的请求。' }
}
