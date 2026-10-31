# 第三方软件接入图片 API

Souhub 的协议适配入口为 `https://img.souhub.top`。OpenAI 类客户端的 Base URL 填
`https://img.souhub.top/v1`；Gemini 类客户端的服务器根地址填 `https://img.souhub.top`。
使用主站创建的**绘图分组用户 API 密钥**，模型统一填 `gpt-image-2`。
原主站 `https://ai.souhub.top/v1` 的既有接口不变；新增协议转换在绘图域名提供。
其他站点部署时替换成该站自己的绘图域名和主站用户密钥。

这是图片协议适配层，不是 Gemini 模型、通用聊天模型或完整 Responses 会话服务。
所有生成和编辑最终调用主站的 `/v1/images/generations` 或 `/v1/images/edits`，
按用户实际分组和成功图片计费。管理员密钥、账号池密钥不能用于这些新增入口。

| 方法与路径 | 用途 |
| --- | --- |
| `POST /v1/images/generations` | 原有 OpenAI Images 文生图 |
| `POST /v1/images/edits` | 原有 OpenAI Images 文件上传改图 |
| `POST /v1/chat/completions` | 聊天格式图片生成，模型填 `gpt-image-2` |
| `POST /v1/responses` | 图片生成 Responses 子集，可同步、SSE 或后台任务 |
| `GET /v1/responses/{id}` | 查询该密钥创建的后台 Response |
| `POST /v1beta/models/gpt-image-2:generateContent` | Gemini 格式图片生成 |
| `POST /v1beta/models/gpt-image-2:streamGenerateContent?alt=sse` | Gemini 格式 SSE |
| `GET /v1beta/models` | 图片适配模型列表 |
| `POST /v1/images/tasks` | 创建异步图片任务，返回 202 和查询地址 |
| `GET /v1/images/tasks/{id}` | 查询该密钥自己的任务和结果 |
| `GET /v1/image-capabilities` | 读取支持的图片协议和限制 |

## 鉴权、跨域与重试

OpenAI 类请求使用 `Authorization: Bearer <用户绘图密钥>`。
Gemini 请求支持同一个 Bearer 密钥或 `x-goog-api-key: <用户绘图密钥>`；
不要把密钥放进 URL 的 `?key=` 参数。浏览器 API 支持无 Cookie 的 Bearer 跨域请求和 OPTIONS 预检；
该设置不改变管理员页面、引擎入口或登录交接的来源规则。

推荐每次新生成都带一个新 `Idempotency-Key`，例如 `dog-20261031-001`。
网络中断后重发**相同请求、相同密钥、相同接口、相同 Idempotency-Key**，复用原任务，
不会新提交生成。相同幂等编号用于不同参数时返回 409。
使用新编号或不带编号重新 POST 都会创建新任务，可能再次扣费。
幂等记录随原有图片任务保存，过期清理后不再保证复用；它不是永久账单凭据。
查询不生成图片，但仍检查密钥是否有效、用户状态及 IP 限制。

## Chat Completions 图片模式

```bash
curl https://img.souhub.top/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: dog-chat-001' \
  -d '{"model":"gpt-image-2","messages":[{"role":"user","content":"一只趴在草地上的狗"}],"size":"1024x1024","stream":false}'
```

结果在 `choices[0].message.content` 中，以 Markdown 图片返回；同时提供
`choices[0].message.images[].image_url.url`。客户端需要支持显示 Markdown 图片或 images 字段。
多轮客户端只使用最后一条 user 消息生成；不调用语言模型理解历史，
继续改图需要在该消息中显式附带参考图。
参考图使用 `content` 数组内的 `{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}`。

`stream:true` 返回 SSE，先发 assistant 角色，图片完成后发最终内容和 `[DONE]`。
等待期间发送心跳，不提供逐步绘图或部分图片预览。

## Responses 图片子集

```bash
curl https://img.souhub.top/v1/responses \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: dog-response-001' \
  -d '{"model":"gpt-image-2","input":"一只趴在草地上的狗","tools":[{"type":"image_generation","size":"1024x1024"}],"stream":false}'
```

图片在 `output[].type == "image_generation_call"` 的 `result` 字段中，为 PNG base64。
也支持一个 user 消息或 `input_text`、`input_image` 内容数组。
`background:true` 返回任务 ID，再用同一个密钥 GET `/v1/responses/{id}`。
后台查询与 SSE 两种模式分开使用，不能同时设置 `background:true` 和 `stream:true`。
`instructions` 会与输入一起形成图片提示词。`tool_choice` 支持 `auto`、`required` 和
`{"type":"image_generation"}`；`none` 或其他工具类型会在提交生成前返回 400。
工具的 `action:"edit"` 必须附带内联参考图。
`stream:true` 返回 `response.created`、`response.in_progress`、最终的
`response.output_item.done` 和 `response.completed`；失败返回 `response.failed`。

这是 [OpenAI 图片生成响应结构](https://developers.openai.com/api/docs/guides/image-generation) 的适配子集。
模型填本服务的 `gpt-image-2`，不填一个通用文本模型再期待工具推理。
不支持文本问答、函数工具、`previous_response_id`、`store:true` 或部分图片预览。
查询现有任务与提供完整会话记忆不是同一项功能。

## Gemini 图片格式

```bash
curl https://img.souhub.top/v1beta/models/gpt-image-2:generateContent \
  -H "x-goog-api-key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: dog-gemini-001' \
  -d '{"contents":[{"role":"user","parts":[{"text":"一只趴在草地上的狗"}]}],"generationConfig":{"responseModalities":["IMAGE"],"imageConfig":{"aspectRatio":"1:1","imageSize":"1K"}}}'
```

图片在 `candidates[0].content.parts[].inlineData`，含 `mimeType` 和 base64 `data`。
参考图放在输入 `parts[].inlineData` 中。只接受一个 user 消息、一个候选结果。
比例支持 `1:1`、`3:2`、`2:3`、`16:9`、`9:16`、`4:3`、`3:4`，
尺寸支持 `1K`、`2K`、`4K`；这些参数映射为 Images 尺寸，实际输出和计费仍由主站决定。
上述生成参数同时接受 camelCase 与 snake_case，如 `imageConfig`/`image_config`、
`candidateCount`/`candidate_count`；同一字段同时传入不同值时返回 400，候选数量仅支持整数 1。
显式设置 `responseModalities` 时必须包含 `IMAGE`，不支持仅请求 `TEXT`。
不提供 Google 模型别名、工具调用、缓存内容、多轮对话或文字输出。
客户端必须允许修改服务器地址和模型名；只允许 Google 官方地址的软件无法直接使用。

## 异步任务

```bash
curl https://img.souhub.top/v1/images/tasks \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: dog-task-001' \
  -d '{"model":"gpt-image-2","prompt":"一只趴在草地上的狗","size":"1024x1024","response_format":"url"}'
```

返回 `id`、`status` 和 `Location` 响应头。GET 该地址，状态为
`queued`、`in_progress`、`completed`、`failed`；完成后的 Images 结果在 `result.data` 中。
失败不会自动重新生成。任务在现有保留期内持久化；服务重启会把未完成任务标记失败，
不会自动重发可能已计费的请求。旧任务过期后返回 404。
同步等待超时或提交后的结果错误会保留 `X-Request-Id`、`Location` 响应头及
`error.task_id`、`error.task_url`，可用原任务地址查询，避免立即重复提交新任务。

## 首版限制

- 新适配器每个任务一张图片；需要 `n>1` 时使用原有 Images API 或多个明确的新任务。
- 文本最多 16000 字符，请求最多 30 MB，最多 8 张 PNG/JPEG/WebP 参考图、合计 24 MB。
- 参考图只接受内联 data URL，不让服务器下载任意远程网址。
- 新任务与工作台共用总队列、每密钥并发、图片输入内存限制；拥塞返回 429。
- 基础 size、quality、文本和参考图已适配；遮罩、透明输出、其他工具和未列出的供应商特有参数不属于本版支持范围。
- SSE 代表持续连接和最终结果，不代表上游支持增量图片。实机软件兼容性仍需按具体客户端验收。

Souhub 首次上线与验收记录见 [2026-10-31 发布记录](IMAGE_PROTOCOLS_RELEASE_20261031.md)。
补充审查与已修复问题见 [2026-10-31 审查记录](IMAGE_PROTOCOLS_REVIEW_20261031.md)。
