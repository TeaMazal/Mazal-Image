# Souhub 无限画布集成

保留 Souhub 已上线画布的源码与部署配套。上游为 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)，MIT 许可与基线见 `LICENSE`、`UPSTREAM.json`。用户入口 `/canvas/`，工作台仍为 `/`，账号池管理仍在原后台。

## 目录与边界

- `web/`：画布前端，包含独立项目、云端作品、任务列表及管理页。
- `integration/app.py`：按主站可信用户隔离项目和私有素材，SQLite WAL 持久化、版本冲突保护、任务恢复与备份。
- `workbench-overrides/`：Souhub 已上线的工作台互通覆盖文件。共享工作台从仓库根 `frontend/` 取得；服务错误提示修复直接维护在根工作台。
- `site-deploy/deploy/`：Souhub 画布网关与内部 HTTPS 入口模板。
- `integration/compose.canvas.yml`：现有 Souhub Compose 布局的画布服务片段。`compose.image-internal.yml` 是内部 HTTPS 网络与证书挂载补充示例。
- `compose.shared-resources.yml`：共享服务器资源模式，取消站内并发和容器资源配额；运行边界见运维文档。

这是现有 Souhub 站点的可选集成，依赖原图片后端、主站 Sub2 用户身份与计费链路。默认安装器仍安装原稳定版；源码同步不表示其他站点已经部署画布。不要把这份 Souhub 网关模板直接覆盖到尚未完成接口合并的其他站点。

## 构建与检查

画布使用 npm 锁定依赖，Node 24：

```bash
cd integrations/canvas/web
npm ci
npm run typecheck
VITE_BASE=/canvas/ npm run build
cd ..
node --experimental-strip-types --test integration/sync.test.ts integration/runtime.test.mjs
python integration/test_app.py
```

Python 测试需要已有后端运行环境中的 FastAPI、Pillow、psycopg2、httpx。使用仓库原后端的锁定依赖，不把测试生成的数据提交 Git。

在临时构建目录准备带画布互通的工作台：

```bash
cp -a frontend integrations/canvas/workbench
cp -a integrations/canvas/workbench-overrides/. integrations/canvas/workbench/
cd integrations/canvas/workbench
npm ci
npm run build
npm test
```

`workbench/` 是生成目录，已忽略。应在新的干净构建目录执行复制；不要重复覆盖正在开发的工作台。

此快照中的 Dockerfile 沿用生产基线镜像标签。在新的构建机上，先从本仓库的 `deploy/Dockerfile.backend` 与 `deploy/Dockerfile.web` 分别构建并标记 `mazal-image-canvas-base:20261031`、`mazal-image-canvas-web-base:20261031`，再以此目录为 context 构建 `integration/Dockerfile` 和 `integration/Dockerfile.web`。所有运行配置、只读身份数据库账号、证书挂载和网络均需按目标站点准备；该步骤不自动创建数据库权限或修改主站渠道。

## 运维

完整行为、备份、回退及主站容器替换步骤见 [OPERATIONS.md](integration/OPERATIONS.md)。账号、主站密钥、SSH 私钥、证书私钥、数据库和运行快照不在源码中。

内部 HTTPS 使用原域名的有效证书与原引擎密钥；用户密钥不能直接调用引擎。示例域名与网络布局属于 Souhub，迁移时逐项调整。证书续签重载单元模板在 `systemd/`；安装前替换证书目录和网页容器名，并保留证书校验。
