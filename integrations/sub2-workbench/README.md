# Sub2 主站绘图入口

ImageWorkbench.vue 对应主站 frontend/src/components/ImageWorkbench.vue；测试对应同目录 __tests__/ImageWorkbench.spec.ts。

主站需要保持同源 POST /api/v1/image-workbench/ticket 代理到绘图网关的 /api/workbench/bridge/ticket。浏览器只交换短期、单次票据，消息验证来源和当前 iframe，不把用户 API 密钥写入地址。

绘图 Nginx 的精确 /embed 路由返回发布脚本生成的 embed.html，禁止缓存，并将 frame-ancestors 限定为本站与指定主站。后台账号和设置页面继续禁止嵌入。/embed 不属于 Service Worker 的页面缓存路由。

刷新恢复上次绘图分组后，先显示“继续你的图片创作”；点击“进入创作空间”才创建内嵌工作台。选择分组也是用户主动进入。未收到握手时只重新导航一次，重复握手不会重复申请票据。桌面端与 390×844 手机视口已验证能登录、读取原作品和报价；未提交付费生成请求。
