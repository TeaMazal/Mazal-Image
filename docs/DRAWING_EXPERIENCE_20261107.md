# 绘图管理体验与用户作品归档（2026-11-07）

Souhub 已上线主站 r30，绘图网关和用户工作台为 r29；新加坡 Mazal 未部署。主站左侧「绘图管理 → 生成记录」可以查看用户作品、提示词、模型、多图状态、耗时与真实账单。列表详情和日志在右侧打开，保留账号筛选、分页与页面滚动状态。顶部与卡片收紧，图片预览关闭后，各区域仍能继续懒加载缩略图。

## 版本与源码

- 主站容器：`sub2api-souhub-drawing-review-r30`，镜像 `sha256:643c7606a6efa4bfa7cb499529cec02cd89b44d1074cd97be95f7c31c2da67a2`。
- 绘图网关：`sha256:d09bc3977db532a2ce3a4bab4414e428c4407a72525e51d0e5630d5b6a7a3e1c`。
- 用户工作台：`sha256:86ec09ef90ef49890a5e239704ad59f980679685d3ad7855f4e60acef5db1775`。
- 管理集成：`integrations/drawing-experience`，以 r28 后台为精确补丁基线；先应用 `integrations/drawing-management`。
- 操作指针：`/opt/mazal-image/operations/drawing-management-current.json`；最终验收：`/opt/sub2api/upgrades/20261107-drawing-review-r30/production/final-verification.json`。

用户工作台发布保留运行中的资源依赖图，只增量加入轮次元数据并切换资源命名空间 `assets-drawing-r29`。本地仓库前端也合入相同字段，但没有用不同基线的整站构建覆盖生产。主站前端命名空间为 `assets-souhub-drawing-r30`。Compose 与启动路由已持久化，旧主站后台任务已交接。

## 验收

- Go 定向检查覆盖媒体权限、路径穿越、非法图片、SSE 最终图、响应无损、多图不误去重、精确账单匹配、轮次隔离和原图片链路；主站构建通过。
- Python 网关、协议、站点与图片保护 111 项检查通过，另有 2 项轮次元数据鉴权与请求头隔离检查通过。
- 用户实际部署资源的生成、编辑元数据场景通过；仓库 TypeScript 检查、Vite 构建和 947 项前端测试通过。既有构建体积和 Browserslist 提示不影响构建。
- 隔离浏览器 14 项检查通过，覆盖真实路由与编译资源、桌面/手机/暗色、账号筛选、导入、管理测试草稿、模板设置、图片与参考图、详情行高、XSS 和放大关闭后的懒加载。
- 线上只读验收通过：用户登录、余额、报价、历史任务、画布、管理员媒体预览/下载、未登录 401，以及账号、代理、设置和日志入口。五项服务运行镜像符合预期。
- 回填服务器留存的一张历史图片，唯一匹配到真实账单。本轮验收额外付费生成请求数为 **0**。

## 边界与恢复

用户模型仍仅开放 `gpt-image-2`；本轮没有验收或开放 2.5/2.6。旧账号、代理、价格、图片保护及画布能力保留。

新私密归档位于主站 `/app/data/drawing-records`，与旧绘图服务的图片存储分开，当前没有接入旧 WebDAV 或自动清理。后续新请求的可归档内嵌图片自动保存；任意远程图片 URL 不自动下载。历史缺失的提示词、参考图不会猜测恢复，旧调用没有明确轮次时按请求展示。

发布目录分别为 `/opt/sub2api/upgrades/20261107-drawing-experience-r29` 和 `/opt/sub2api/upgrades/20261107-drawing-review-r30`，各自保存 `production/precutover-backup`、发布脚本及 `rollback_remote.py`。回退按 r30 → r29 的依赖顺序核对执行，绘图媒体回退需另核对 r29 媒体发布状态。回退程序与路由不恢复余额数据库；本轮无数据库 schema 变更。不要无条件重跑切换脚本，也不要用备份覆盖正在使用的账单数据。
