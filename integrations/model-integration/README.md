# 绘图模型统一接入 r32

Souhub 的主站增量集成，以 2026-11-08 已上线 r31 源码为基线。共享绘图代码位于仓库的 backend/ 和 frontend/；此目录保存主站 Go 补丁及管理页面模块。本站配置、账号、授权文件和运行密钥不包含在内。

主站补丁先校验二十个源码文件的前后哈希；遇到其他版本须先合并：

```sh
python apply_backend.py --backend /path/to/sub2api/backend
python apply_backend.py --backend /path/to/sub2api/backend --apply
```

补丁包含生成、编辑的独立验证记录、模型列表、调度过滤、模型报价、执行信息和流水关联。应用后须执行对应 Go 测试并构建主站；此脚本不修改数据库或部署服务。管理页的 drawing-*.js/css 模块须合入主站完整静态资源，生成新命名空间并保留旧资源，不可仅改版本号。

`backend.patch` 包含源文件原有的混合换行，`.gitattributes` 将其设为 `-text` 以保持原始字节。不要让编辑器或 Git 自动统一补丁换行；应用器会校验最终文件哈希。2026-11-08 已使用 Git 暂存区实际内容在隔离 Linux 目录重放，二十个结果哈希全部通过。

模型范围为 Image 2、2.5 Flare / Sunburst / 通用名称、2.6 Flare / Sunburst / 通用名称。Web 账号沿用 Image 2；Codex 的新增模型须通过指定账号和对应操作的真实图片验证，且仍受账号模型映射、密钥分组及调度策略约束。账号身份、模型映射或代理绑定改变会使旧验证不匹配；正常 access token 续期保持已有验证。

“图片已保存”和“上游确认模型版本”分别显示。当前实测的上游未声明模型名称，因此不能把请求成功等同于模型版本得到独立证明。2.5 / 2.6 不会因请求失败而自动改成 Image 2 或换用 Responses 路径。

共享后端默认仍只开放 Image 2。Souhub 在自己的 Compose 环境显式配置七个 MI_ENABLED_IMAGE_MODELS；最终用户模型清单来自主站授权模型接口。未向另一站 Mazal 部署。

图片记录与扣费共用主站的规范流水编号。上游 5xx / 连接中断归为结果待核对，不自动重新提交。任务相同编号、相同内容返回原记录；内容不同或无法核对的旧记录返回 409。

验收与回退说明见 [完整发布记录](../../docs/MODEL_INTEGRATION_20261108.md)；verification.json 只包含脱敏结果。
