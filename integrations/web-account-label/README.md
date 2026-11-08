# Web 账号类型标签（r33）

本目录保存 2026-11-08 Souhub 主站已上线的 Web 标签修改及缓存修复配方。账号类型列显示 OpenAI、青色 Web、OAuth；Web 名称展示时去掉 `[Web]` 前缀，避免邮箱重复展示。数据库中的账号名称、凭据和类型不变。

Web 判定要求平台为 OpenAI，并检查 `credentials.source_type === 'web'`，同时兼容既有 Web client ID。仅靠 client ID 会遗漏导入的 Web 授权。OAuth 继续表示授权方式，Web 表示授权来源。

## 重现已发布资源

线上 r33 对已构建的主站资源进行了精确修改。本目录保留可审阅的转换代码和修改前后 SHA256，适用范围为清单对应的 r32 构建，不能直接套用其他 Sub2API 版本。

在隔离的完整主站构建目录操作：

```sh
python apply_assets.py --dist /path/to/backend/internal/web/dist
python apply_assets.py --dist /path/to/backend/internal/web/dist --apply
```

脚本先校验两份目标资源，创建新的 `assets-souhub-web-label-r33` 资源目录，更新内部资源引用及 HTML 入口，保留旧目录。它也接受已完成标签修改但仍使用 r32 命名空间的资源。不能覆盖同名旧缓存资源后仅要求用户刷新；应用后还须重新构建主站、检查页面并按目标站发布。

不同构建版本应在主站源组件中合入同样的行为：AccountsView 根据授权来源传递 `sourceLabel`，PlatformTypeBadge 渲染 Web 标签，账号名称只在显示层移除前缀。不要忽略哈希校验强行应用本配方。

本次源码同步用保存的原始资源执行配方，两份结果与 r33 实际发布资源逐字节一致，JavaScript 语法检查通过。正式站此前独立浏览器验收通过。本目录不包含账号数据、浏览器认证状态、上传系统代码或生产运维脚本。
