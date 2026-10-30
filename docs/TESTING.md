# 验证

默认测试使用模拟网关与假密钥，不连接真实账号池或付费服务。不要在正在运行的生产目录内初始化测试状态。

## 前端

```bash
cd frontend
npm ci
npm run build
npm test
node ../tests/test_embedded_workbench.mjs
```

## 全套隔离安装

在单独的空源码目录初始化测试站，端口不可与现有服务冲突：

```bash
sudo python3 scripts/init_site.py \
  --public-origin http://127.0.0.1:8341 \
  --main-origin http://127.0.0.1:8340 \
  --gateway-url http://mock:8080 \
  --name "Test A" --project mazal-image-check --port 8341

docker compose -f compose.yml -f deploy/compose.test.yml up -d --build
docker compose -f compose.yml -f deploy/compose.test.yml ps
```

在运行 Docker 的同一台机器打开 http://127.0.0.1:8341 ，使用 `mock-customer-key`；余额为模拟值，生成只返回 32×32 蓝色测试图片，不访问真实绘图服务。http://127.0.0.1:8340 为模拟主站嵌入页。远程服务器测试时应使用 SSH 本地端口转发，不将这些测试端口暴露公网。

## 浏览器回归

保持上述模拟环境运行，在源码根目录执行：

```bash
npm ci --prefix tests/browser
npx --prefix tests/browser playwright install --with-deps chromium firefox
npm test --prefix tests/browser
MI_TEST_BROWSER=firefox npm test --prefix tests/browser
```

Windows 已安装 Edge 时，可在 PowerShell 使用 `$env:MI_TEST_BROWSER='msedge'`，然后执行 `npm test --prefix tests/browser`；Firefox 使用 `firefox`。不同浏览器依次运行，不要并发共享模拟计数器。每次启动使用独立、临时浏览器配置，不读取站主浏览器的真实登录状态。

检查覆盖：独立页登录与 Service Worker 缓存预热、嵌入首次连接、整页刷新 5 次、子页刷新 3 次、手动重连 2 次、首次加载中断恢复、生成中刷新及不重复提交、URL 与本地密钥隔离、作品保留、余额和手机宽度。每个浏览器只生成一张蓝色测试图片；程序只允许 loopback 地址，并先验证模拟网关标记，不对生产站运行。

结果和截图位于 `artifacts/browser/`，该目录不会进入 Git 或源码发行包。CI 包含同一套 Chromium、Firefox 检查；工作流是否在远端执行成功，须以实际 CI 结果为准。

## 后端隔离单元与接口检查

先从根目录构建镜像，再使用 Linux Docker 运行下列命令。Compose backend 自身不映射宿主机端口；额外测试进程关闭外网，只使用自身 loopback 模拟主站。

```bash
docker compose build backend
IMAGE_ID=$(docker compose images -q backend | head -n 1)

docker run --rm --network none \
  -e PYTHONPATH=/app \
  -v "$PWD:/suite:ro" \
  --entrypoint /app/.venv/bin/python \
  "$IMAGE_ID" /suite/tests/test_gateway_integration.py

docker run --rm --network none \
  -v "$PWD:/suite:ro" --entrypoint /app/.venv/bin/python \
  "$IMAGE_ID" /suite/tests/test_site_config.py

docker run --rm --network none \
  -v "$PWD:/suite:ro" --entrypoint /app/.venv/bin/python \
  "$IMAGE_ID" /suite/tests/test_maintenance.py /suite/backend/maintenance.py

python3 tests/test_init_site.py
```

命令从当前 Compose 项目取得构建镜像 ID。`.env` 文件不会自动成为宿主 shell 变量，不要用 `source .env` 加载不可信文件。

## 发布验收

应验证：匿名/普通身份不能调用管理接口；错误来源和重放票据被拒；任务不跨密钥；主站额度不足不回退直连；重复任务只提交一次；刷新不重新扣费；参考图与遮罩完整传递；站外链接无密钥；重连与切换身份隔离；不同站点的名称、origin、数据库和内部密钥互不混用；备份不包含媒体且不会无限增长。

浏览器验证还应包含手机布局、画板、遮罩、收藏、下载、作品备份以及站内首次加载和刷新。模拟图片检查可以验证工作流，不证明真实图片质量或上游额度。

## 打包检查

```bash
python3 scripts/source_archive.py --output ../Mazal-Image-v0.1.0.tar.gz
python3 scripts/source_archive.py --output ../Mazal-Image-v0.1.0.zip
```

工具从白名单导出，排除状态、凭据、编译产物与日志，生成每个源码文件的 SHA-256 清单。可用 `--forbid-value` 增加本部署的私有标记；命中时只报告文件名。还应人工复查示例、文档、锁文件、图片素材和 Git 历史，不能把扫描当作绝对保证。
