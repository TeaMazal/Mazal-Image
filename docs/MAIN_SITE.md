# 主站 API 与嵌入接入

## 必需接口

用户登录和绘图网关要求主站支持：`GET /v1/usage`、`GET /v1/models`、`POST /v1/images/generations`、`POST /v1/images/edits`，使用主站普通 API 密钥 Bearer 认证。usage 兼容当前 Sub2API 钱包、总配额和周期额度字段；其他网关格式应先适配 `customer_balance` 并测试，不能假定任意 OpenAI 兼容网关都提供相同额度接口。

嵌入还要求主站登录认证接口 `GET /api/v1/auth/me` 和当前用户密钥接口 `GET /api/v1/keys/:id`。服务端校验密钥属于当前用户、密钥与分组启用、`allow_image_generation` 开启，再通过 `/v1/usage` 实际验证密钥。

## 图片渠道

在主站创建仅服务目标图片模型的渠道，基础地址指向绘图站的 `https://image.example.com/engine`，使最终调用路径为 `/engine/v1/images/generations` 等。渠道凭据使用该站初始化的内部引擎/管理密钥，绝不能暴露到用户页面。

该渠道的模型白名单只保留 `gpt-image-2`，不要填写 `*`、聊天模型或开启跳过模型限制的透传模式。v0.1.2 起，内部引擎模型列表只返回图片模型，聊天接口直接拒绝；旧站升级时还应手动清除主站渠道中已经保存的聊天模型，后端更新不会自动改写主站配置。用量日志中的模型名是请求记录，不能单独证明实际使用了对应模型。

该入口在反代中设置内部标记，服务端拒绝普通主站用户密钥直接调用；普通请求仍通过主站真实网关计费。主站网关地址 MI_GATEWAY_URL 指向主站根 URL，不能指回绘图站普通 `/v1`，否则会形成转发循环。

为用户所属分组开放图片模型 `gpt-image-2`、有效渠道和图片权限，设置自己的价格/倍率/额度。绘图项目不会自动修改主站价格或给其他分组授权。不同分组使用各自的 API 密钥。

## 站外菜单

建立普通超链接 `https://image.example.com/`，使用 `target="_blank" rel="noopener noreferrer"`，不附加 JWT、用户 API 密钥或内部服务密钥。用户在独立绘图页使用主站 API 密钥，或者恢复该浏览器已有身份。

## 站内菜单

主站增加同源票据代理；以下片段用于主站自身的 Nginx server 块：

```nginx
location = /api/v1/image-workbench/ticket {
    proxy_pass http://127.0.0.1:8310/api/workbench/bridge/ticket;
    proxy_set_header Host image.example.com;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Mazal-Engine-Only "";
    client_max_body_size 2k;
}
```

主站 CSP 的 frame-src 允许绘图 origin；绘图服务 MI_MAIN_ORIGIN 必须与当前主站 origin 完全一致。不要开放通配来源。

`integrations/embedded-workbench.js` 为不绑定前端框架的接入模块。主站提供自己的票据请求回调，不将登录令牌或完整 API 密钥放入 URL：

```js
import { createWorkbench } from './embedded-workbench.js'

const workbench = createWorkbench({
  container: document.querySelector('#drawing-workspace'),
  origin: 'https://image.example.com',
  keyId: selectedKeyId,
  requestTicket: async (payload) => {
    // 使用主站原有、已登录的 API 客户端。
    const { data } = await apiClient.post('/image-workbench/ticket', payload)
    return data
  },
  onState: (state) => { /* 更新主站连接或生成状态 */ },
  onError: (error) => { /* 在主站展示可重连的错误提示 */ },
})

// 切换密钥或离开页面前：workbench.destroy()
// 需要重连时先 destroy，再按新选择调用 createWorkbench。
```

父容器需设置明确高度。连接器先安装消息监听器，再挂载带目标地址和独立名称的 iframe；子页会在收到票据前重发握手。父页在尚未收到握手时最多重载 iframe 两次，收到握手后不再重载，不会因此重试生图。只接受目标 origin 和当前 iframe 的消息。票据有效 60 秒、绑定 nonce、只能使用一次；原始 API 密钥仅在兑换后用于内存会话，独立站已保存身份不会被嵌入会话覆盖。

绘图子页面自身重新加载后会生成新 nonce，父页会重新申请票据并恢复连接；同一 nonce 的重复握手不会重复签发。`onState` 会在交接期间收到 `{ connected: false }`，成功后收到 `{ connected: true }`。刷新只重新认证和查询既有任务，不会再次提交生图。

接入模块不依赖主站前端框架；具体已执行的模拟部署与浏览器验收结果见 VALIDATION.md。
