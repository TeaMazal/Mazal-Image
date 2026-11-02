# Souhub 无限画布

入口 `/canvas/`；工作台保留 `/`，管理账号池保留原后台。上游 basketikun/infinite-canvas 的 MIT 许可及署名随静态文件分发。

## 数据与身份

用户凭主站绘图密钥登录。每个接口先由现有网关确认密钥权限和 IP，再使用 PostgreSQL 只读角色确认所属用户。同一用户的多个密钥共用画布与素材，浏览器缓存按可信用户编号隔离。密钥仅沿用原站浏览器会话/记住登录设置；不写入项目、任务文件或 URL。

SQLite WAL 与图片存于 `/opt/mazal-image/canvas-state`。默认每用户 1GB 原始素材、回收站 30 天；主站管理员在画布管理页调整。素材按内容寻址，生成结果另存，不依赖原绘图缓存的清理周期。被活动或回收站项目引用的素材不能单独删除；永久删项目后仍可从云端作品选择保留或删除素材。缩略图不计入用户原图额度，磁盘保留 5GB。空间满时阻止新增素材，已有作品仍可读取和导出。

## 生成与计费

主站绘图渠道的 base_url 使用 `https://img.souhub.top:8443/engine`，经独立内部 Docker 网络 `souhub_image_bridge` 连接网页网关，保留有效证书校验与 `/engine/v1/` 的引擎密钥鉴权。8443 仅在容器内监听，不发布到公网，只允许 `/engine/v1/`。web 的 `img.souhub.top` 网络别名已写入生产 `compose.override.yml`；主站容器使用手工发布，重启会保留网络，替换容器后必须执行 `docker network connect souhub_image_bridge <新主站容器名>`，并在切换流量前验证该容器把 `img.souhub.top` 解析为内部 web 地址。该网络保持 `internal=true`。不要把引擎密钥写进 URL 或运维输出。

web 只读挂载 Caddy 管理的本站证书目录，`souhub-image-tls-reload.path` 监视证书目录变更并触发 `souhub-image-tls-reload.service`，先检查 nginx 配置再平滑重载，使证书续签生效。手工替换证书后应检查该 path 单元仍 active，内部 TLS 无需关闭证书校验。

仍调用绘图站原有异步生成/编辑接口，由原账号池出图、Sub2 鉴权和扣费。画布多图可同时提交，每张有独立任务编号。提交响应丢失后只查询原编号，不自动重新生成。结果待确认会保留任务，管理员应核对引擎任务文件和主站账单后处理，不凭时间相近推算账单归属。

Souhub 采用共享服务器资源模式：后端设置 `MI_SHARED_SERVER_RESOURCES=1`，取消网关任务执行、任务队列、单用户活动任务、接口转发和提交槽位上限，以及账号池单账号的本地并发上限。工作台与画布同时提交各图片请求，结果仍按原轮次保存。`compose.shared-resources.yml` 给出取消 backend、web、canvas CPU/内存/进程数配额的示例；未启用该环境变量的其他站点仍保留网关原有并发策略。上游服务的额度与限流、主站鉴权计费和单请求大小校验继续生效。

仅使用当前已接通的 gpt-image-2，质量 auto/low/medium/high。报价读取主站真实价格，每次挂载缓存最多一分钟；最终费用按主站成功图片与实际尺寸计算。任务列表保留任务编号和密钥编号，主站是账单权威。没有实现任务和账单 request_id 的精确关联。

## 同步与恢复

IndexedDB 保存本机修改和同步基线；云端 revision 乐观锁。冲突时保留本机独立副本。生成恢复仅补全对应任务未物化的图片，不覆盖已保存或手动替换的结果。初次登录需要联网验证身份；已经打开的页面可继续离线编辑，联网后同步。

每天在 `canvas-state/backups/YYYYMMDD` 创建 SQLite 在线快照和不可变素材硬链接，保留七天。快照在同一服务器，不能替代异地灾备。恢复时先停 canvas 服务、保存故障数据、将同一完整快照中的数据库与 assets 一起复制到新目录、chown 10001:10001、重启后执行 integrity_check 和用户隔离检查，不覆盖尚未备份的新数据。

## 发布与回滚

源码与候选静态文件位于 `operations/canvas-*/release`，`canvas/release` 指向该目录。`compose.canvas.yml` 是持久服务声明，发布脚本最终合并到原 `compose.override.yml`，普通 compose 启停会带上画布。候选网页仅绑定 127.0.0.1:8311，验收后删除。

发布前保存原 web image、compose 和前端变更文件。切换仅重建 web，原 backend 和主站容器保持运行。回滚按对应 operations 目录的 activate-state.json 恢复原镜像和 compose，再执行 web 的 `up -d --no-deps --no-build --pull never --wait`；canvas-state 不删除，画布服务可保留等待修复。

自动验证命令：`node --experimental-strip-types --test integration/sync.test.ts integration/runtime.test.mjs`（runtime 测试使用 web 构建依赖 esbuild，以真实同步和导出模块配合隔离 I/O）；在安装 FastAPI/Pillow/psycopg2/httpx 的隔离环境运行 `python integration/test_app.py`；web typecheck/build；workbench npm test/build。

画布构建必须设置 `VITE_BASE=/canvas/`，工作台仍使用根路径。打包脚本会校验画布 HTML 的静态资源前缀，避免路径错误进入正式镜像。
