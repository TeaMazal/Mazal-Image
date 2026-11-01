# 来源与第三方许可

Mazal Image 是衍生整合项目，新增整合代码的授权见根 LICENSE；原有组件的版权和许可继续保留，不由该文件替代。

## 绘图工作区

- 上游：https://github.com/CookSleep/gpt_image_playground
- 基线：0.8.3，提交 bbddad706145f05e0b84946e1474b66707959747（既有整合记录）。
- Copyright (c) 2026 CookSleep，MIT License，见 `frontend/LICENSE` 与 `licenses/gpt_image_playground-MIT.txt`。
- 上游说明保存在 `frontend/UPSTREAM.md`。本项目的布局、登录入口、网关接入、批量处理和配置等有修改。
- 字体、图标与 npm/Rust 依赖清单保留在 `frontend/src/assets/third-party-notices.txt`、`frontend/third-party-licenses/`、`frontend/public/licenses/`。其中原生客户端条目仅适用于相应客户端代码。

## 账号池引擎与管理页面

- 上游：https://github.com/basketikun/chatgpt2api
- 基线：1.8.0，实际运行镜像摘要和源码快照见 SOURCE.json。
- Copyright (c) 2026 kunkun，MIT License，见 `backend/engine/LICENSE` 与 `licenses/chatgpt2api-MIT.txt`。
- 上游 README 原文在 `backend/engine/UPSTREAM.md`，其中包含非商业等用途限制表述。此分发保留该表述；如需据此判断具体使用权限，应核对所用版本的授权，不应将根 LICENSE 当作对所有第三方组件使用范围的额外保证。
- Python 源码来自实际运行基线的程序目录，未收集生产配置或数据。管理页面从对应版本的公开源码构建；通用版修改了数据路径和构建资源限制。

## 可选无限画布

- 上游：https://github.com/basketikun/infinite-canvas，基线提交记录在 `integrations/canvas/UPSTREAM.json`。
- 上游 MIT 许可保存在 `integrations/canvas/LICENSE`；Souhub 的项目同步、私有素材、任务与计费接入有修改。画布依赖由 `integrations/canvas/web/package-lock.json` 锁定。
- 该目录为独立的可选站点集成，不改变原有工作区和账号池组件的许可。

## 依赖

灵感模板的提示词和示例封面独立采用 CC BY 4.0，原始作者、案例链接及修改说明见 `backend/template_data/library.json`、`backend/template_data/attribution/` 和该目录的 README；许可全文见 `backend/template_data/LICENSE-CC-BY-4.0.txt`。根目录的软件许可不替代这部分素材的署名要求。

前端与管理页面依赖分别由各自 package-lock.json 固定；引擎 Python 依赖由 uv.lock 固定。依赖属于各自作者，须遵守各自许可证。许可收集脚本为 `scripts/collect_npm_licenses.mjs` 与 `scripts/collect_python_licenses.py`，发布材料在 licenses/ 内保留对应构建的报告和许可原文。

`licenses/frontend-npm/` 与 `licenses/admin-npm/` 记录锁定构建中安装的非 dev npm 包，`licenses/python/` 记录运行镜像的 Python 包；这些不是操作系统或所有开发工具的完整 SBOM。缺失的上游许可原文及补充来源见 `licenses/admin-npm/supplemental-sources.json`。

管理页面的构建阶段包含 sharp/libvips 原生工具；相关二进制 npm 包声明 LGPL-3.0-or-later，libvips 原项目另保留 LGPL-2.1 文本。这些工具仅在多阶段 Docker 构建的 admin-build 阶段使用，最终 Python 运行镜像只复制导出的静态管理页面，不复制构建器的 node_modules 或 libvips 二进制。不能将整个依赖树描述为 MIT，也不要把该构建器镜像当作本项目的发布运行镜像。

可选浏览器回归工具 `tests/browser/` 使用 Playwright 1.58.2（Apache-2.0），许可、NOTICE 与其第三方声明见 `licenses/browser-testing/`。它不进入应用生产依赖。浏览器程序通过 Playwright 或各浏览器厂商单独安装，不包含在源码压缩包内。

上游赞助、演示、更新服务和作者身份不代表为本项目提供背书。上游原始文档为来源记录，本项目部署与功能范围以根 README 和 docs/ 为准。
