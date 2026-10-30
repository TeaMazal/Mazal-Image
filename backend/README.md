# 集成层和引擎

`engine/` 包含当前生产基线 1.8.0 的 Python 源码快照、管理前端源码和锁文件。快照只从程序目录收集，没有 config.json、数据目录、账号或密钥。`gateway_integration.py` 保留身份校验、真实主站计费、任务隔离、并发上限和禁止远程参考图代下载等集成逻辑。

通用版将可信主站、绘图站和服务端网关改为 `MI_MAIN_ORIGIN`、`MI_PUBLIC_ORIGIN`、`MI_GATEWAY_URL`，品牌使用 `MI_SITE_NAME`，启动时校验。数据和配置路径通过 `MI_DATA_DIR`、`MI_CONFIG_FILE` 指定。不要允许普通用户控制这些配置。

Docker 构建会从源码重新编译管理前端并按 uv.lock 安装依赖，不依赖本站服务器或上游预编译镜像。通过根目录 Compose 运行，不直接公开后端端口；后端信任的代理头只能由同网络 Web 反代设置。
