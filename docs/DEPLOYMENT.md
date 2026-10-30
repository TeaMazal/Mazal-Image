# 部署

## 配置

用根目录初始化命令生成配置，不要把真实密钥写进源码或任何 `VITE_*` 变量。`.env.example` 只展示公开站点配置；内部管理员/引擎密钥在被 Git 和打包工具排除的 `state/config.json` 中。

| 配置 | 含义 |
| --- | --- |
| MI_SITE_NAME | 独立绘图页、浏览器标题及 PWA 名称 |
| MI_PUBLIC_ORIGIN | 绘图站唯一公开 origin，例如 https://image.example.com |
| MI_MAIN_ORIGIN | 主站唯一可信 origin，例如 https://api.example.com |
| MI_GATEWAY_URL | 服务端访问主站的根 URL，不能带 /v1 尾缀，可使用可信内网地址 |
| COMPOSE_PROJECT_NAME | 每个站独立的 Compose 项目名 |
| MI_BIND_ADDRESS / MI_PORT | Web 在宿主机上的监听地址和端口 |
| MI_TRUSTED_PROXY_CIDR | Web 信任的外层反代连接地址范围，默认 Docker 私网范围；部署后应按实际网络缩小 |
| MI_MEDIA_LIMIT_MB / MI_MEDIA_MAX_AGE_HOURS | 媒体周期清理容量与时间 |
| MI_MIN_FREE_MB | 磁盘低水位，影响清理和是否跳过备份 |
| MI_BACKUP_KEEP / MI_BACKUP_LIMIT_MB | 备份数量与单次备份源/文件上限 |

origin 必须是无路径、无参数、无账户密码的 HTTP(S) origin；服务端启动时拒绝缺失值或非法值。主站和绘图站生产应使用 HTTPS。修改名称、域名或网关后执行 `docker compose up -d --force-recreate`，再刷新浏览器。正式域名变化还需更新外层 TLS、DNS 和主站接入配置。

## HTTPS 反代

域名证书由外层 Nginx、Caddy 或现有面板管理。下面片段用于现有 HTTPS server 块内部；不要仅复制片段后假定已配置证书：

```nginx
location / {
    proxy_pass http://127.0.0.1:8310;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
    client_max_body_size 30m;
    proxy_read_timeout 650s;
    proxy_send_timeout 650s;
    proxy_buffering off;
}
```

若前方还有 CDN，应先在外层反代按可信 CDN 网段恢复真实客户端 IP。不要直接信任任意访客发送的 X-Real-IP。确认容器看到的外层代理源地址后，缩小 `MI_TRUSTED_PROXY_CIDR`。主站有 IP 限制时必须实测真实 IP 传递。

Web 根页只允许自身与配置的主站嵌入；管理路径禁止被嵌入。后端只在 Docker 内部可达。不要为方便排错公开后端端口。

## 首次运行

1. 按 README 初始化并构建启动；确认 `docker compose ps` 中 backend、web 正常。
2. 从服务器的 `state/config.json` 自行读取内部密钥，在 `/accounts/` 登录，导入自己有权使用的账号。
3. 按 MAIN_SITE.md 创建主站图片渠道及有图片权限的分组。
4. 使用该分组的普通用户 API 密钥登录 `/`，检查余额和模型提示。
5. 只有站主决定进行真实验收时再提交图片；隔离测试使用模拟接口，不产生真实费用。

空配置可启动服务，但不代表账号池已可用。普通用户不要使用内部管理密钥，服务端也不会在主站错误时回退到免费直连引擎。

## 日常维护

```bash
docker compose ps
docker compose logs --tail=100 backend
docker compose logs --tail=50 maintenance
docker compose run --rm maintenance /app/.venv/bin/python /app/maintenance.py
```

备份只含配置和账号状态，不含媒体或请求日志；属于敏感文件，目录限制为站主/容器用户访问。默认最多 3 份、源文件合计和单文件约 32 MiB。超过上限或磁盘不足会跳过并在日志提示，不会无限扩大备份。

媒体周期清理可能提前移除服务器缓存；重要作品应下载或由用户导出。本地图库不在服务器配置备份内。周期清理允许短时超出媒体目标；需要严格硬上限时，为 `state/` 配置独立容量受限文件系统或项目配额，不能把周期清理当成硬配额。

不自动升级宿主机、不全量备份服务器、不清理其他 Docker 项目的镜像或卷。
