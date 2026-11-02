# 第三方画布接入

Souhub 用户可在外部画布里使用本站的 OpenAI Images 接口，无需在服务器另起画布服务。配置说明也位于绘图站「使用帮助 → API 接入」，登录前可以查看。

| 项目 | 获取软件 | 接入选择 |
| --- | --- | --- |
| [Infinite Canvas](https://github.com/basketikun/infinite-canvas) | [Releases](https://github.com/basketikun/infinite-canvas/releases) | OpenAI 格式，图片模型 gpt-image-2，使用内置图片接口 |
| [AI Canvas](https://github.com/Tenney95/AI-Canvas-tauri) | [Releases](https://github.com/Tenney95/AI-Canvas-tauri/releases) | 快捷适配「GPT Image 2 · OpenAI 官方 Images」 |

共同配置：

- Base URL：`https://img.souhub.top/v1`。其他站点使用自己的绘图站域名。
- API Key：主站签发、所属分组允许绘图的用户密钥。
- 模型：`gpt-image-2`。
- 初始参数：1024×1024、quality auto、1 张；native Images 单次 n 支持 1–4。
- 生成：POST `/v1/images/generations`，JSON。
- 编辑：POST `/v1/images/edits`，multipart 上传参考图，支持 `image` 和重复的 `image[]`。
- 图片返回格式保留默认，客户端能读取 `data[].b64_json`。当前配置使用 PNG。

Infinite Canvas 自动处理地址中的 `/v1`，填写上述完整 Base URL 即可；模型能力选图片。AI Canvas 手动配置时，协议预设选 `openai-gpt-image`，参考图请求模式选 `edits-multipart`。普通 `openai-image` 预设的结果映射只读取 URL；JSON 图片引用模式也不等同于本站的上传编辑接口。

API 沿用「绘图站公网入口 → Sub2 主站鉴权与计费 → 绘图站内部引擎 → 后台账号池」链路。软件的模型下拉框不赋予账号额外能力；本接入不承诺 GPT Image 2.5、透明背景或其他厂商模型。超时后先查主站用量，再决定是否重试。

## 2026-11-02 兼容核验

研究版本：

- Infinite Canvas：`9cd3deacbcc598361807afc16c059a80dd18b6f9`，MIT。
- AI Canvas：`27692de07a891000fe3234e9d981555f64eb594c`，README v0.10.23，source-available。仅研究接口合同和执行隔离验证，未复制实现或重新分发应用。

独立 Edge 进程加载上游原始请求构建及图片解析代码，连接隔离的本站网关。测试中的主站为模拟计费网关；转发后执行本站真实 Images 路由和 multipart 解析，生成函数返回测试 PNG。客户端原生桌面传输、存储和异步轮询等外围服务替换为测试桩；未使用生产密钥或付费上游。

20 项检查通过：Infinite Canvas 模型发现、1/2/4 张生成、单/多参考图编辑、根地址自动补 `/v1`、无效密钥；AI Canvas 标准 Images 路径的 1/2/4 张生成及多参考图编辑、尾斜杠处理、GPT Images 声明式预设的 1/2/4 张生成、无效密钥。17 个有效生图请求均到达真实引擎解析层，张数和参考图内容保持一致，没有触发额外补图请求。

这项验证确认客户端接口合同，未代替桌面安装版的真实付费生成、账号可用性或实际扣费验收。现有接口已兼容，本次没有修改后端、主站扣费和账号池。

## Souhub 发布

仅更新工作台的两款软件接入说明和 Service Worker 缓存标识。以当前生产源码组合构建，检查全部 286 个工作台源码文件及 Compose 哈希，保留站点既有差异。943 项前端测试、生产构建、电脑/手机公网说明页的展开、复制和链接检查通过；无横向溢出或页面脚本异常。74 个 HTTP 静态文件校验通过。

公网入口验证：两种 Images POST 的 CORS 预检返回 204，允许 Authorization/Content-Type；未携带密钥读取模型返回 401。内部 TLS 回源边界、共享资源不限并发配置保持通过；后台、主站、画布及维护容器未重启。本次未向 Mazal 部署。

- 操作指针：`/opt/mazal-image/operations/canvas-clients-current.json`。
- 发布目录：`/opt/mazal-image/operations/canvas-clients-20261102T122315Z`。
- 活跃工作台源码：`/opt/mazal-image/canvas/release/workbench`。
- web 镜像：`sha256:4e912f60b18b0ab10e7d26b446b4ad20bc25367c066f53fef88595b6e2239942`。
- 回退：在服务器运行 `sudo python3 /opt/mazal-image/operations/canvas-clients-20261102T122315Z/rollback.py`，仅恢复本次前端镜像及改动的源文件，不回写用户数据。

发布快照和测试截图保留在运维目录/本机 artifacts，不进入仓库。
