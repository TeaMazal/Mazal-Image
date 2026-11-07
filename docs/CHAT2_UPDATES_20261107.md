# Souhub chatgpt2api 补丁整合：2026-11-07

本轮将 chatgpt2api PR #406、#418、#419、#420、#424 固定版本整合并部署到 Souhub，包含 Sentinel 握手、浏览器辅助服务、代理池/订阅、2.5 型号路由、Codex 驱动和 GIF 协议扩展。具体版本及冲突处理见 [上游清单](../integrations/chatgpt2api/README.md)。五项 PR 尚未合入上游 main；不是盲目覆盖整站，也不是上游正式发行版。

## 保留内容

用户工作台与画布静态文件逐文件比对，更新前后完全相同；独立对话、多图轮次、历史作品、提示词模板、报价、滚动及现有操作图标不变。用户计费仍经过主站，后台账号池仍为绘图站自有 25 个账号，本地用户密钥创建继续禁用。配置、账号库、历史数据和图片未用发布包替换。

Souhub 专用 gateway、top-nav、layout、api-docs 先从线上取回再三方合并；共享仓库保留 Mazal 的独立站点策略。未向新加坡 Mazal 部署。

`MI_SHARED_SERVER_RESOURCES=1` 保留，backend/web/canvas CPU、内存、Pids 无配额。主站、画布、维护容器未重启。新 helper 和 mihomo 只开放 Docker 内网。

## 验证

- 仓库后端 112 项通过，Souhub 组合版 109 项通过。
- 上游回归 143 项，142 项通过、1 项跳过；覆盖新握手、指纹、代理池、模型映射和图片存储。
- helper 按出口隔离 cookies 的测试通过，未授权私有接口拒绝访问。
- 共享版及 Souhub 管理前端构建、TypeScript 检查通过；140 个静态文件与运行镜像逐一核对。
- 实际后台账号调用：Image 2 一次提交返回 PNG 1254×1254，约 14.93 秒。GIF 一次提交返回两张静态 PNG，约 28.72 秒；**不能宣称 GIF 生成功能已可用**。没有继续重试，没有用户账单。
- 未登录权限、跨域预检、管理配置/代理池、未开放模型的 400 拒绝、内部 HTTPS 回源已验证。
- 独立无头浏览器完成公网后台登录、代理池/设置/生图页面及手机布局验证，无页面脚本错误、无失败静态资源、手机无横向溢出。截图和结果保留在服务器私有验收目录。
- 用户工作台未改动，以字节一致性及既有权限/协议回归确认保留；本轮未另发用户付费生成订单。

用户仍只可选 Image 2。2.5 的 web/Codex 路由与别名代码已就位，但不能以本轮更新代替账号实际出图与计费验收。GIF 管理入口为实验接口，用户端不开放。代理池默认不启用，现有出口不自动迁移。

## 发布与一次自动回退

操作目录 `/opt/mazal-image/operations/chat2-updates-20261107T030103Z`，指针 `operations/chat2-updates-current.json`。首次发布校验发现 Docker COPY 忽略了 Webpack 产物中的嵌套 `dist` 路径，已自动回退。随后改用校验后的静态 tar 包加入镜像，并在上线前验证全部 140 文件，再次发布成功。页面预加载另发现新导出目录与旧点分文件名并存，补充路径兼容规则，优先读取当前导出，8 项针对性回归通过。

当前镜像：

- backend：`sha256:e8278e4b5f84a9c7a7829238cfb75119ebc3b7b7fda45343ad6febad4f7e9ee8`
- web：`sha256:79dfa140c3c216b12c0229fe3e708b06214f63230b77c1e3a109758f691fa91a`

发布前检查源码、镜像、Compose 与任务空闲状态，暂停新 POST 并等待旧请求结束。私有 `before-state` 使用 SQLite backup 保存数据库快照，同时保存 config 与元数据；图片文件未复制、清理或删除。回退只恢复代码/镜像/Compose，不回写运行数据库，不丢弃发布后新增作品。

回退入口：`sudo python3 /opt/mazal-image/operations/chat2-updates-20261107T030103Z/rollback.py`。脚本校验当前镜像/源码且要求任务空闲；若已有后续发布需人工合并，不能直接运行旧回退。辅助服务使用同目录 `support.compose.json`，私有环境文件留在服务器，不能进入 Git。

## 主站网络修复

验收发现旧记录 `sub2api-subscription-r18` 已在 11 月 5 日停止；实际主站为 `sub2api-souhub-accounts-r26`，11 月 6 日启动。新主站容器未连接 `souhub_image_bridge`，但绘图渠道 725 仍指向 `https://img.souhub.top:8443/engine`。

本轮为当前主站补回该网络连接，无需重启，DNS 解析与内部 TLS 返回预期 401（无密钥测试）通过。主站 ID/StartedAt 保持不变，证据保存为 `main-bridge-before.json` / `main-bridge-restored.json`。以后替换主站容器必须按画布运维文档恢复这条网络；不要再把已停止的旧容器作为主站检查对象。

使用渠道 725 的现有服务器端密钥，从当前主站网络调用内部 `/engine/v1/models` 成功并包含 Image 2；该校验没有新建密钥、没有提交生成、没有用户扣费。证据为 `channel-acceptance.json`。
