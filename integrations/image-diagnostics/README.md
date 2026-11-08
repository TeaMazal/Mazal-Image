# 绘图账号测试诊断 r31

2026-11-08 Souhub 增量修复，以 `drawing-experience` 的 r30 后台为基线。未向 Mazal 部署，未改变用户分组、价格和图片模型开放范围。

```sh
python apply_backend.py --backend /path/to/sub2api/backend
python apply_backend.py --backend /path/to/sub2api/backend --apply
```

五个文件的前后哈希必须匹配；不匹配时先合并，不强制覆盖。`drawing-workspace.js` 替换管理页对应模块，需要与主站现有 AppLayout、认证客户端及静态资源命名空间配套发布。

- 管理测试保留 `UpstreamFailoverError` / `OpenAIImagesUpstreamError` 的状态和诊断分类，避免因响应体为空而丢失真实错误。历史增加 `error_code` 与 `http_status`。
- 400 图片工具拒绝、401 授权失败、403 访问拒绝、429 限流明确显示失败；连接中断、上游 5xx 或缺少图片仍显示结果待核对。已保存的部分图片继续保留，不自动重试。
- 诊断只使用固定安全文案，不把上游完整响应、凭据或原始异常写入历史。
- 菜单显式列出 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`，通过现有 Codex Images 路径调用。原 `gpt-image-2.5` / `gpt-image-2.6` 标记为 Responses 待验证；不将它们静默映射为其他模型。
- 模型检查接口增加映射后模型和计划请求路径；执行器有实现、模型目录可见和账号能出图是不同状态。

本次账号 #940 的真实 `gpt-image-2.5-flare` 请求返回 HTTP 403，没有图片；原通用 2.5 路径触发 HTTP 400 的图片工具拒绝。尚未证明该账号有任何 2.5 生图权限。管理员测试不走普通用户扣费，仍可能消耗上游额度；不能把这次错误展示修复当作 2.5 已打通。

`live-probe.json`、`browser-verification.json` 为脱敏证据。完整上线状态见 [发布记录](../../docs/IMAGE_DIAGNOSTICS_20261108.md)。
