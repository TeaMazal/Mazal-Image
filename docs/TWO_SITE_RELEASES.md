# 两站统一维护与发布

日常功能只修改这份项目的 frontend/、backend/。sites/mazal.json 和 sites/souhub.json 保存品牌、公开域名和部署布局；账号池、用户、价格、运行配置及 SSH 私钥仍留在各站服务器，不进入发布包。

**Souhub 是主力站和功能基准，Mazal 是下游同步站。** 以 Souhub 最新功能合成共享版本，再按站点配置同步到 Mazal。Mazal 独立开发的功能须单独审查与合并，不能把整站代码或旧共享包反向覆盖 Souhub。并行开发时，两站上线前均须再次核对 Souhub 最新改动。

本地维护入口：`E:\中转服务器\Mazal-Image`。Mazal 使用 `20261031-r2`；Souhub 已恢复覆盖前的轮次工具与操作图标版本，恢复记录为 `operations/souhub-recovery-current.json`，当前源码为 `/opt/mazal-image/frontend`。本地已合回这两项遗漏更新，尚未重新部署共享版。`/opt/chatgpt2api/current-source` 是首次同步时的历史快照，不再表示最新共享源码。完整记录见 `SHARED_RELEASE_ACCEPTANCE_20261031.md`。

## 发布

1. 在 frontend/ 执行 npm ci、npm run build、npm test。后端有改动时，另外运行 tests/test_gateway_integration.py、test_site_config.py、test_maintenance.py；主站计费集成有改动时在主站项目单独运行对应 Go 测试。
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
