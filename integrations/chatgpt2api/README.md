# chatgpt2api 上游补丁集成

2026-11-07 将以下 **尚未合入上游 main 的 PR** 三方合入 Souhub 定制后端，不能把本次发布称为上游正式版本升级。上游基线 `92dd80e91543157d36a4ddad60e765c5293760e9`，VERSION 仍为 1.8.0。

| PR | 固定提交 | 内容 |
| --- | --- | --- |
| [406](https://github.com/basketikun/chatgpt2api/pull/406) | `3c6357576fedf08b7756389fde1b19b0dfb65cd3` | Image 2.5 网页及 Codex 别名 |
| [418](https://github.com/basketikun/chatgpt2api/pull/418) | `ebc050e465f68f93142cf4b2889e603b21f3e5fb` | Sentinel 握手、浏览器辅助服务、代理池、订阅、mihomo |
| [419](https://github.com/basketikun/chatgpt2api/pull/419) | `3d5930bdb3a6f4448eb06c39438fe3e1f7f749d7` | Codex 驱动模型、模型选择保存及映射 |
| [420](https://github.com/basketikun/chatgpt2api/pull/420) | `4b7b23304e4e660f059c890d43236c947be120a8` | 明确传递网页 Image 2.5 型号 |
| [424](https://github.com/basketikun/chatgpt2api/pull/424) | `3ef7edd6839db0433507bcfd17d0c8a754f558da` | GIF 生成/编辑端点、格式和帧保留、300 秒等待 |

## 站点适配

- 账号继续来自绘图站管理后台，用户鉴权和计费仍走 Sub2。
- Image 2 保留原有上游模型设置；2.5 不允许静默降级到 auto 或 Image 2。别名和模型映射都受既有开放校验约束。
- `MI_IMAGE25_ROUTE` 或后台 `image25_route` 可以指定 `codex` / `web`，默认 `codex` 保留原行为。`codex_responses_model` 默认 `gpt-6.1-sol`。路由配置不代表账号已获模型权限。
- 用户端目前仍只开放 `gpt-image-2`，本轮没有宣称 2.5 / 2.6 实测可用，也没有新增对应价格。
- GIF 两端点仅限管理员测试；客户请求返回 403、未登录返回 401，避免绕过主站计费。实测 GIF 提示返回静态 PNG，尚未验收为真正动图。
- 代理池默认关闭，保留旧账号代理、全局代理、稳定代理及 SSL 设置。启用空池时明确报错，不能自动转为直连。没有订阅时不创建虚构节点。
- 保留 Souhub 导航、品牌、接口说明及网关差异，不覆盖用户工作台、历史作品或画布。

## 辅助组件

`sentinel_solver/` 是浏览器辅助服务；`script/`、`k8s/`、Compose 和 `upstream-examples/` 是上游参考配置，**不可原样替换现网部署文件**。辅助服务只加入服务器 Docker 网络，不发布端口；授权 key 仅存服务器私有文件。无授权健康检查只返回状态，不暴露浏览器 cookies。

浏览器依赖在构建镜像时下载，启动时不重复安装。mihomo 固定 `v1.19.24`，控制接口有独立 secret，默认无监听节点。两者与绘图后端共享服务器资源，不新增 CPU/内存限制。

保留上游 MIT 授权；引擎授权见 `../../backend/engine/LICENSE`，辅助组件授权副本见本目录 `LICENSE`。

完整部署、实测边界及回退见 [发布记录](../../docs/CHAT2_UPDATES_20261107.md)。
