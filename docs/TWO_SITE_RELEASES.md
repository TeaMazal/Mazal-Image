# 两站统一维护与发布

2026-11-07 Souhub 后续已上线主站「绘图管理」r28，统一账号/分组/代理、管理测试、模板与存储入口，并修复 Base64 参考图编辑和独立清理服务的图片保护。后续优先核对 [r28 发布记录](DRAWING_MANAGEMENT_20261107.md) 与 `operations/drawing-management-current.json`，主站增量见 `integrations/drawing-management`。用户工作台前端未替换，新加坡 Mazal 未部署。

2026-11-07 Souhub 已将绘图 Web 账号迁至 Sub2，绘图站通过 `MI_REMOTE_ACCOUNT_MANAGEMENT=1` 关闭旧池及本地直接生图。后续以 [统一账号上线记录](UNIFIED_ACCOUNTS_20261107.md) 和 `operations/unified-accounts-current.json` 为准；不要重新启用旧渠道 725。新加坡 Mazal 保留原行为，本次未同步部署。

日常功能只修改这份项目的 frontend/、backend/。sites/mazal.json 和 sites/souhub.json 保存品牌、公开域名和部署布局；账号池、用户、价格、运行配置及 SSH 私钥仍留在各站服务器，不进入发布包。

**Souhub 是主力站和功能基准，Mazal 是下游同步站。** 以 Souhub 最新功能合成共享版本，再按站点配置同步到 Mazal。Mazal 独立开发的功能须单独审查与合并，不能把整站代码或旧共享包反向覆盖 Souhub。并行开发时，两站上线前均须再次核对 Souhub 最新改动。

本地维护入口：`E:\中转服务器\Mazal-Image`。Mazal 使用 `20261031-r2`；Souhub 已恢复覆盖前的轮次工具与操作图标版本，恢复记录为 `operations/souhub-recovery-current.json`，当前源码为 `/opt/mazal-image/frontend`。本地已合回这两项遗漏更新，尚未重新部署共享版。`/opt/chatgpt2api/current-source` 是首次同步时的历史快照，不再表示最新共享源码。完整记录见 `SHARED_RELEASE_ACCEPTANCE_20261031.md`。

Souhub 于 2026-10-31 07:17 UTC 增量上线图片协议扩展，增加 `backend/image_protocols.py`、网关安装段、任务元数据恢复和 Nginx v1beta 路由。后续发布须合并这部分源码；不得用扩展前的网关、任务服务、Dockerfile 或 Nginx 模板覆盖。操作指针为 `operations/image-protocols-current.json`，详见 [图片协议发布记录](IMAGE_PROTOCOLS_RELEASE_20261031.md)。本次未同步新加坡 Mazal。

07:29 UTC 已在最新模板版镜像上补充接口审查修复，恢复运行镜像中遗漏的任务元数据加载，并修正 Gemini 参数解析、Responses 工具选择和超时任务标识。最新补丁记录为 `operations/image-protocols-review-current.json`，见 [审查记录](IMAGE_PROTOCOLS_REVIEW_20261031.md)。发布时须同时核对源码与运行镜像，确保 `services/image_task_service.py` 保留 `api_protocol`、`api_fingerprint`、`http_status` 的加载逻辑。

## 发布

2026-11-07 Souhub 整合 chatgpt2api PR #406/#418/#419/#420/#424：新握手、内网浏览器辅助服务、代理池/订阅、2.5 路由与 GIF 管理测试接口。当前发布状态与镜像以 `operations/chat2-updates-current.json` 为准，详见 [更新与验收记录](CHAT2_UPDATES_20261107.md)。用户工作台与画布静态文件保持逐字节一致，账号池/用户数据/配置保留，资源配额仍解除。普通 Image 2 实测成功；GIF 返回静态 PNG，2.5 未进行本轮真实出图验收，两者不能直接向用户开放。代理池默认关闭。实际主站现为 `sub2api-souhub-accounts-r26`，已补回内部绘图网络；不要再用已停止的 `sub2api-subscription-r18` 验收主站。未向 Mazal 部署。

2026-11-02 Souhub 上线输入区模型菜单、按所选模型传递生成/编辑请求、历史模型记录及报价隔离。当前仅开放 Image 2，2.5 Flare/Sunburst 保持“暂未开放”：导入账号直调图片接口返回 403，两个 Responses 驱动验证均返回 400，没有成功图片。仓库后端 105 项、生产组合版 102 项、工作台 946 项测试及两套前端构建通过；公网电脑/手机模型菜单、权限、报价和引擎开放校验通过。当前 backend 为 `sha256:300978434c5e8adcefb16edcc71fd86876b7a48b450421dfaadaf9956ce0f476`，web 为 `sha256:fe350c164b6692ef397262e5e07e3186a3de48bcb0e55c3db505adcfb680f778`。操作指针 `operations/image-models-current.json`，保留共享资源和 Souhub 站点差异，主站、画布及维护服务未重启；未向 Mazal 部署。能力边界、测试与回退见 [模型选择发布记录](IMAGE_MODEL_SELECTION.md)。

2026-11-02 Souhub 补充 Infinite Canvas 与 AI Canvas 接入说明，现有 native Images 接口通过两款客户端上游请求构建和图片解析代码的 20 项隔离检查。本次仅更新工作台说明与缓存标识；943 项前端测试及公网电脑/手机说明页验收通过，后端和主站未重启，没有发起付费生成。当前 web 为 `sha256:4e912f60b18b0ab10e7d26b446b4ad20bc25367c066f53fef88595b6e2239942`，操作指针 `operations/canvas-clients-current.json`；完整接入配置、验证边界及回退见 [第三方画布接入](CANVAS_CLIENTS.md)。后续部署须保留上一轮后台不限并发和画布取消修复；未向 Mazal 部署。

2026-11-02 补充共享资源审查修复：画布读取和上传参考图后重新检查取消状态，避免停止后仍产生新生图请求；管理后台将服务器返回的 0 正确显示为“不限并发”，禁用该项编辑，保存其他配置时省略此只读值。操作指针为 `operations/review-fix-current.json`，目录为 `operations/review-fix-20261102T072554Z`，带有源码、镜像备份及回退脚本。12 项画布 Node 回归、5 种后台配置加载保存检查、独立浏览器界面验收、画布类型检查和两套前端构建通过；139 个静态文件校验通过。后端只更新管理后台静态资源，保留 Souhub 现有导航、品牌与接口说明差异；用户工作台文件与共享资源配置保持不变。主站、画布服务和维护容器未重启，未调用付费生图。

本次当前 backend 为 `sha256:f474fdfb0f0a06d7f7cf55b3a365989a0efb36b4d0c8c194142aeb8a7a397740`，web 为 `sha256:dfe3c4b5f541454ccf3c0cce796afd22c6d4bc12bada62002d2e947c99377f0e`；后续操作须优先核对此修复记录，再核对共享资源基线。未向 Mazal 部署。

2026-11-02 Souhub 已启用共享服务器资源模式，更新工作台、画布与网关并发行为，并解除三个绘图容器的 CPU、内存和进程数配额。当前镜像、验收与回退入口见 [共享资源发布记录](SHARED_RESOURCES_20261102.md)，操作指针为 `operations/shared-resources-current.json`。本轮保留此前模板、协议、内部 HTTPS 和标题定位功能；主站与维护服务未重启，未向 Mazal 部署。

Souhub 后续上线了无限画布及内部 HTTPS 回源修复。源码、工作台覆盖文件与站点运维说明已同步至 [integrations/canvas](../integrations/canvas/README.md)，审查与真实生图验收见 [画布源码同步记录](CANVAS_SOURCE_SYNC.md)。该集成没有自动加入默认安装器或新加坡 Mazal；不能用原有只包含 frontend 的共享包覆盖 Souhub 当前画布网关。主站容器替换前必须恢复其内部绘图网络连接。

2026-11-01 修复新建空对话时标题被顶部导航遮挡。空对话保持首屏，开始第一轮后恢复跟随；已有对话最新轮次定位、画廊定点返回和手动翻阅行为保留。Souhub 仅更新 web，当前镜像为 `sha256:157e3ebd6c332aabc2c6834bdcc5f8679c3172e8bd90ba69c6d6e774c319f4b5`，操作记录为 `operations/title-position-current.json`，对应目录保存前版源码和 `rollback.py`。发布前核对 286 个线上源码文件，生产组合版 943 项测试、共享前端 944 项测试通过；两者均构建通过。公网前端使用隔离的模拟身份与接口完成桌面、矮窗口、手机尺寸的连续新建及长输入检查，没有发起付费生图；标题距导航分别为 26px、26px、23.25px。画布文件、内部 HTTPS 与主站/账号池/画布容器保持原有配置。未向 Mazal 部署。

2026-10-31 后续模板中心、输入区及 API 帮助也已合回本仓库，见 [最新源码同步](SOURCE_SYNC_20261031.md)。Souhub 当前 web 为 `sha256:b8743095b80415c616edda5b9a1df2dc4b6b695aef0cc12f94573f8447252111`，backend 为 `sha256:962afa5ea6a6dec4cce07fa83a4f44b1ebf3c7160bfa82b434c40a5fda770c0c`。这里只推送源码，尚未将本次合成版部署到任一站；Mazal 的历史共享版不是 Souhub 的最新基准。

1. 在 frontend/ 执行 npm ci、npm run build、npm test。后端有改动时，另外运行 tests/test_gateway_integration.py、test_image_protocols.py、test_prompt_library.py、test_site_config.py、test_maintenance.py 和 test_release.py，并构建管理前端；主站计费集成有改动时在主站项目单独运行对应 Go 测试。
2. 在项目根目录执行 `python scripts/release.py --release 20261031-r1 --output ../releases/20261031-r1`。该命令使用同一份构建产物生成两站配置及源码包，并生成 SHA256 校验文件。后续版本必须使用新版本名。
3. 将 tar.gz 和 scripts/deploy_site.py 上传到目标服务器；SSH 连接参数使用本机私有配置，不写入项目。先执行 `sudo python3 deploy_site.py --site mazal --archive /path/release.tar.gz --sha256 校验值`，Souhub 使用 `--site souhub`。默认只检查目标站、发布包和文件哈希。
4. 发布前再次核对两站线上源码、现有功能及最新操作记录，将并行开发合回共享源码。检查通过后追加 `--apply` 上线；Compose 站还须用 `--expected-web-image 完整镜像ID` 指定核对过的当前 web 镜像。服务器多出发布包未包含的前端源文件、或镜像发生变化时，脚本拒绝上线。此检查不能代替现有文件内的功能差异审查。默认仅更新用户前端；后端功能更新时同时追加 `--backend`，先确认没有生成中的任务。Python 依赖文件发生变化时脚本会停止，需要单独评估依赖迁移。
5. 验证登录、报价、已有作品和管理权限。不要把“页面能打开”等同于付费生图已验收；需要实际生图时另外明确验证费用和次数。

两站可以按先测试站、后另一站的顺序发布。每次包内的 JavaScript 相同，站点名、下载前缀、引导提示偏好、图标、页面标题和缓存版本由配置生成；不复制浏览器作品或密钥。

## 部署与回退

- Mazal 保留 `/opt/chatgpt2api` 单容器与宿主机 Nginx 结构；前端更新不重启主站或账号池服务。
- Souhub 保留 `/opt/mazal-image` Compose 结构；前端更新只重建 web 容器。
- 上线记录：各站 `operations/shared-release-current.json`。记录包含版本、源码路径、操作目录和是否更新后端。
- 操作目录中的 `before.json` 含私有运行快照，只能在服务器保存，不要上传 GitHub 或打进发布包。
- 回退命令：`sudo python3 deploy_site.py --rollback /opt/对应目录/operations/shared-版本-时间`。恢复前端、运行镜像及必要的网关文件，不回写用户数据库和账号池数据。
- 发布包保留完整共享源码；以后以该项目为修改入口，旧工作目录和临时修复目录只作历史参考。

主站 Sub2 的 Go 计费接口及 Vue 内嵌入口属于独立主站集成，分别放在 integrations/。它们有各自主站构建与验收流程，不会被绘图站发布脚本覆盖。

## 权限与站点差异

用户页面只通过主站绘图密钥登录；管理后台继续用于上传账号和管理。两站均保留禁止创建本地用户密钥的策略。Mazal 的本地图片引擎限制、Souhub 既有引擎策略通过站点配置保留，用户计费均由各自 Sub2 主站处理。

若有人在服务器直接改了代码，应先把修改合回共享源码再发布，避免下次覆盖；发布包不承担数据库结构、Python 依赖升级或主站计费修改的自动迁移。
