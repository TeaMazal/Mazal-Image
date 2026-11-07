# Souhub 绘图管理体验与作品归档

2026-11-07 上线：主站 r30、绘图网关与用户工作台 r29。先合入 `../drawing-management` 的 r28 集成，再应用本目录增量；不适用于任意上游版本。

```sh
python apply_backend.py --backend /path/to/sub2api/backend
python apply_backend.py --backend /path/to/sub2api/backend --apply
```

脚本核对八个文件的前后 SHA256，基线不符会停止。补丁应用不部署服务、不修改数据库。`drawing-*.js` 和 CSS 是已部署管理页源码，应接入主站 Vue 路由、AppLayout 与认证客户端并构建；不能直接覆盖其他版本的编译文件。用户端轮次字段位于仓库 `frontend/src`，网关传递逻辑位于 `backend/gateway_integration.py`。

## 使用与数据

- 左侧「绘图管理 → 生成记录」查看用户作品；生成图、参考图分开，右侧详情支持原图预览、下载和真实账单跳转。「运行日志」独立展示技术诊断。
- 用户生成响应中的内嵌图片和参考图存入主站 `/app/data/drawing-records`，由管理员专用接口 `/api/v1/admin/drawing/records` 及其媒体路由读取。媒体要求完整管理员权限，响应禁止缓存；不提供公开图片链接，也不主动下载响应中的任意远程 URL。
- 归档观察原始响应，不改变返回内容、不发起额外生成、不负责扣费。捕获实际计费 RequestID，精确关联 usage_logs；未匹配或部分匹配显示待核对，不能当作已完整结算。
- `X-Drawing-Round-Id`、`X-Drawing-Conversation-Id`、`X-Drawing-Round-Total` 只用于显示归组，按用户、密钥和会话隔离，不作为鉴权依据。没有明确轮次标识的历史调用按单次请求展示。
- 归档任务遇进程中断标为待核对，不自动重试生图。管理生图测试仍是独立诊断入口，不冒充普通用户付费记录。

## 存储边界

新归档是管理员私密副本，随主站 app-data 备份。旧绘图存储页、WebDAV 和定时清理目前不管理这个目录；当前保留新归档，不自动清理。图片与存储页有入口和范围说明，后续容量治理应独立实现并验收。

只回填服务器确实留存的历史图片，本轮恢复一张并匹配真实账单；历史未保存的提示词或参考图无法补齐。模型开放范围未变，本轮没有付费生图验收。

发布、检查和回退记录见 [上线记录](../../docs/DRAWING_EXPERIENCE_20261107.md)。`release.json` 与 `verification.json` 为脱敏发布信息，不含账号、令牌和数据库。
