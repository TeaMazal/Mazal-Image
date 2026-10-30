# Mazal Image

将作品优先的绘图工作区、账号池引擎和主站 API 密钥接入结合的 Web 自托管项目。

基于 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 与 [basketikun/chatgpt2api](https://github.com/basketikun/chatgpt2api)，保留两份上游版权和第三方许可。项目提供整合后的源码、运行配置、镜像构建、测试与迁移说明。

## 功能

- 文字生图、多参考图、画板标注、遮罩编辑，支持桌面和手机。
- 作品收藏、参数复用、下载、本地作品 ZIP 导入导出。
- 每条描述生成 1～4 张图片、多描述顺序排队、停止后续任务和刷新恢复。
- 浏览器本地纯色去底生成透明 PNG，保留原图；复杂边缘存在效果限制。
- 使用主站 API 密钥登录、查看钱包和密钥额度，由主站执行权限与计费。
- 账号池和管理员页面保留在独立路径，用户绘图页不提供后台导航。
- 独立站入口和一次性票据嵌入，两种入口共用主站密钥。
- 每站独立品牌、可信 origin、网关、端口、状态目录和有限数量的配置备份。

## 架构与范围

浏览器工作区 → 同源集成层 → 主站图片网关 → 账号池引擎。

当前整合版依赖兼容 Sub2API 的主站接口；它不包含整个主站，不提供无计费主站的独立用户系统。账号池后台继续由引擎提供，并非重写成一个新的统一管理后台。直接部署纯静态前端不能获得完整功能。

运行入口：用户 `/`，管理员 `/accounts/`，管理设置 `/settings/`；普通用户使用主站 API 密钥，管理员使用本次初始化生成的内部管理密钥。不要向普通用户分发内部密钥。

## 快速部署

需要 Linux、Docker Engine、Docker Compose v2、Python 3，首次构建需要访问 npm、PyPI 和基础镜像仓库。建议至少 4 GiB 可用内存与 8 GiB 可用磁盘，实际需求随账号池和访问量变化。首次构建的依赖缓存也占磁盘。

### 一条命令安装

在目标 Linux 服务器的 SSH 终端执行（需要 curl）：

```bash
curl -fsSL https://raw.githubusercontent.com/TeaMazal/Mazal-Image/main/scripts/install.sh | sudo bash
```

安装器从终端询问绘图域名、主站地址、站名、项目名、目录和端口，下载固定的 v0.1.2 稳定版并核对提交，生成独立密钥，构建并启动容器，完成本机健康检查。拒绝已有目录、已使用的 Compose 项目名和端口；安装盘可用空间不足 8 GiB 时停止。已有 Docker 不会重装或升级；缺少 Docker 时询问是否使用官方安装脚本，Debian/Ubuntu 缺少 git/Python/curl 时可确认安装所需依赖。

DNS、HTTPS 反代、账号导入和主站图片渠道仍需站主配置。当前安装器在 main 分支维护，安装的应用源码固定为 v0.1.2；不是升级脚本，失败后保留新目录供排查，不能直接在该目录重复初始化。无人值守参数及操作边界见 [安装器说明](docs/INSTALL.md)。

### 手动安装

将源码解压到一个新的目录，然后运行：

```bash
sudo python3 scripts/init_site.py \
  --public-origin https://image.example.com \
  --main-origin https://api.example.com \
  --gateway-url https://api.example.com \
  --name "My Image" \
  --project my-image \
  --port 8310

docker compose up -d --build
docker compose ps
```

初始化生成 `.env`、`state/config.json` 和空数据目录，不覆盖已有文件，也不打印密钥。随机管理密钥位于 `state/config.json` 的 `auth-key`，仅由站主在服务器上读取。若未以 root 初始化，启动前按提示调整 `state`、`backups` 的所有者至 UID/GID 10001。

Web 默认只监听服务器 `127.0.0.1:8310`，须配置域名 HTTPS 反代；后端不映射公网端口。接着导入绘图账号，并在主站配置图片渠道、内部引擎地址和用户分组权限，详见 [部署说明](docs/DEPLOYMENT.md) 与 [主站接入](docs/MAIN_SITE.md)。空账号池不会凭空获得可用绘图额度。

## 复制到另一个网站

将同一份源码发行包解压到另一个空目录，使用不同 `--project`、`--port`、域名和网关重新初始化。不要复制原站 `.env`、`state/`、`backups/` 或真实密钥。第二站会生成自己的管理员密钥并使用独立数据库。

品牌和域名来自运行时配置，不需要因换站重新修改前端代码。不要将原站 origin 保留在新站可信列表，也不要将可信列表设为 `*`。完整步骤见 [迁移与升级](docs/MIGRATION.md)。

## 数据和限制

- 图库保存在当前浏览器，并按密钥身份隔离；不会自动跨设备同步。
- 单张服务器媒体链接采用持有链接即可访问的方式，任务列表隔离不等于媒体链接私有。
- 默认定时控制媒体约 1 GiB、保留约 72 小时，保留 3 份不含图片的配置备份；这是周期清理，不是文件系统硬配额。
- 手动重试会发起新任务并可能计费，自动刷新只查询原任务。关闭页面会停止尚未提交的批量队列。
- 遮罩只指导修改，不保证遮罩外像素不变。透明背景使用浏览器去底处理，不等同于原生模型透明输出。
- 模型当前为 `gpt-image-2`，可用性、实际扣费、真实图片质量与账号额度取决于主站、上游和账号。

## 开发与测试

```bash
cd frontend
npm ci
npm run build
npm test
```

后端使用 Python 3.13 和 `backend/engine/uv.lock`；隔离接口测试、完整镜像构建、模拟网关及双站配置检查见 [验证说明](docs/TESTING.md)。`tests/` 中的密钥都是隔离测试假值，模拟网关不会转发到真实服务。

本版本已执行的检查与范围见 [验收记录](docs/VALIDATION.md)。源码导出支持 `.zip` 与 `.tar.gz`，并附每个文件及压缩包的 SHA-256 清单。

Web 是首版支持范围。保留的原生客户端代码作为上游来源参考，不提供已签名桌面发行包，不继承上游发布工作流。自行开发桌面版本前须配置自己的应用标识、签名和更新源。

## 许可与贡献

新增整合代码按 [MIT](LICENSE) 提供；两个上游版权和完整许可副本见 [NOTICE](NOTICE.md) 与 `licenses/`。chatgpt2api README 同时含有用途限制声明，原文保存在 `backend/engine/UPSTREAM.md`；这里不隐去该声明，也不据此承诺整个分发物的商业使用权。字体、图标、npm/Python 依赖遵循各自许可。

贡献前请阅读 [贡献说明](CONTRIBUTING.md)，漏洞报告方式见 [SECURITY](SECURITY.md)。
