# Sub2 Web 账号统一管理

Souhub 于 2026-11-07 上线。账号存储、调度、分组与计费由 Sub2 管理；绘图站保留用户会话、任务、作品、模板和画布。

```text
用户 → 绘图站用户网关 → Sub2 鉴权/选账号/计费 → 上游
第三方客户端 → Sub2 图片接口 → 上游
```

Web 来源由 Sub2 同容器的单次 Python worker 调用网页图片协议。worker 没有 HTTP 服务、账号数据库或独立调度池，只从 stdin 收到本次分配的单个凭据。Codex 保留原 Go 适配器，浏览器验证辅助服务继续在内网运行。

## 管理入口

主站“账号管理 → Web 账号”支持 JSON 文件、JSON 数组或 access token 导入，选择图片分组及代理。同邮箱 Web 与 Codex 分开保存。Web 新导入默认停用，检查授权与额度后再启用。同邮箱 Web 重新导入更新授权并清除旧令牌缓存；Codex 不被覆盖。

Web 额度是上次明确查询的快照；“刷新列表”不等于刷新上游额度。无 refresh token 的授权到期后需要重新导入。

Web 模型清单为适配器支持清单，目前仅 `gpt-image-2`，不代表账号的全部上游权限。2.5 请求不降级到 2.0。蒙版、指定透明背景、非 PNG 输出及未适配的高级参数会明确拒绝。

## 应用与运行

`backend.patch` 是 Souhub r26 到已部署 r27 的源码差异，统一换行为 LF，包含 Go 服务、管理接口、测试及 worker。`backend-manifest.json` 记录原始、LF 目标及实际部署文件 SHA256，不适用于任意 Sub2 版本。

```sh
python apply_backend.py --backend /path/to/sub2/backend
python apply_backend.py --backend /path/to/sub2/backend --apply
```

基线不符则停止，先合并当前主站功能。主站账号页面加载 `web-accounts.css`，增加调用 `openWebAccounts({api, onApplied})` 的按钮；api 使用现有 accounts/groups/proxies 对象，onApplied 刷新页面。线上采用新资源命名空间，保留旧资源及 r26 分类/批量操作。

运行时需要 worker 使用的 curl_cffi、Pillow 等依赖。线上复用当时绘图镜像的固定 Python 环境，与 Go 主程序同容器：

```text
SUB2API_WEB_PYTHON=/opt/web-runtime/bin/python
SUB2API_WEB_WORKER=/app/resources/chatgpt_web/worker.py
SUB2API_WEB_SOLVER_URL=<内网辅助服务地址>
SUB2API_WEB_SOLVER_KEY=<仅服务器配置>
```

运行容器和持久化 Compose 都要连接辅助服务网络，保留原主站与内部图片网络。密钥不进入源码或镜像。

仅 Souhub 设置 `MI_REMOTE_ACCOUNT_MANAGEMENT=1`，停止旧账号刷新及代理订阅线程，禁止加载/保存本地账号池。旧账号/代理页跳转主站，旧管理 API 返回迁移说明，本地管理密钥不能直接生成图片。图片清理、备份和用户任务继续运行。未设置此变量的站点保持原行为；新加坡 Mazal 未部署。

## 迁移与回退

先备份数据库及完整旧账号，暂停新提交并排空任务。停止旧池刷新后导出最新授权；新 Web 先停用、查额度，再启用健康账号并停用旧引擎渠道。同邮箱 Codex 保留主站授权。最后清空已归档旧账号存储并恢复用户流量。

回退前核对当前版本并排空请求，先暂停新账号，恢复旧池/绘图后端及旧渠道，再按需回退主站程序。不得恢复旧主站数据库覆盖新余额账单。实际生成结果未知时不自动重发。

验收与当前模型边界见 `verification.json` 和 `docs/UNIFIED_ACCOUNTS_20261107.md`。
