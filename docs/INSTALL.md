# 一条命令安装

在目标 Linux 服务器上执行，不要在 Windows 本机运行：

```bash
curl -fsSL https://raw.githubusercontent.com/TeaMazal/Mazal-Image/main/scripts/install.sh | sudo bash
```

root 登录且未安装 sudo 时，把末尾 `sudo bash` 换成 `bash`。安装器从 `/dev/tty` 读取回答，适用于通过管道下载脚本的 SSH 终端；需要 curl 和可访问 GitHub、npm、PyPI、镜像仓库的网络。

## 会执行的操作

1. 询问绘图站 origin、主站 origin、主站 API 根地址、站名、Compose 项目名、新目录和监听端口。
2. 检查参数、安装磁盘至少 8 GiB 可用、端口没有被占用、目录和 Compose 项目名未被使用。
3. 缺少 git、Python 3、curl 时，可确认在 Debian/Ubuntu 用 apt 安装所需依赖；缺少 Docker 时，可确认运行 Docker 官方安装脚本。已有 Docker 不会重装或升级，缺少 Compose v2 或 Docker 服务未启动时停止并提示。
4. 下载固定的 v0.1.1，并核对提交 `db9efde7862d54152712c72806b2ea84e56e8e1a`，初始化新的内部密钥、数据库目录及备份目录。
5. 执行 Docker Compose 从源码构建并启动，等待容器健康，通过 `127.0.0.1` 验证 Web 健康接口。

首次构建时间取决于服务器和网络。不下载其他站点的密钥或账号池，不自动迁移旧站，不清理其他容器、缓存或数据，不修改已有 Nginx 配置。安装失败保留新目录，终端会显示其位置；先排查，不要把再次运行安装器当作升级或重试初始化。

## 无人值守

```bash
curl -fsSL https://raw.githubusercontent.com/TeaMazal/Mazal-Image/main/scripts/install.sh | sudo bash -s -- \
  --yes \
  --public-origin https://image.example.com \
  --main-origin https://api.example.com \
  --gateway-url https://api.example.com \
  --name 'My Image' \
  --project my-image \
  --directory /opt/my-image \
  --port 8320
```

`--yes` 允许补齐缺少的 apt 依赖，但不会默认授权安装 Docker；需要时另加 `--install-docker`。主站 API 根地址不要加 `/v1`。站名可以含空格，脚本使用参数传递，不执行输入中的 shell 表达式。

可下载脚本检查后再运行。安装器属于公开仓库 main 分支维护内容，应用版本固定，不会自动下载未经验证的新应用版本；v0.1.1 原始发行包不含后来新增的安装器。

## 启动后还需完成

- DNS：绘图域名解析到目标服务器。
- HTTPS：用现有 Nginx、Caddy 或面板配置证书，反代到安装器显示的 `http://127.0.0.1:<端口>`；超时和代理头见 [部署说明](DEPLOYMENT.md)。
- 账号池：在绘图域名 `/accounts/` 使用新目录 `state/config.json` 的 `auth-key` 登录，导入绘图账号。安装器不在终端输出该密钥。
- 主站渠道：基础地址为 `https://绘图域名/engine`，渠道凭据使用新站内部密钥；为分组配置 `gpt-image-2`、图片权限和计费。当前要求兼容 Sub2API 的主站，其他网关先适配接口。
- 入口：站外菜单链接绘图域名；站内嵌入另外配置票据代理与连接器，见 [主站接入](MAIN_SITE.md)。

同一服务器部署多个站时，使用不同目录、项目名、监听端口和域名。站点运行时配置、密钥和数据各自独立。维护默认周期清理约 1 GiB 媒体、最多保留 3 份有限大小配置备份；这是周期控制，不是磁盘硬配额，构建缓存也会占空间。
