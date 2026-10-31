"use client";

import { Card, CardContent } from "@/components/ui/card";

const customerEndpoints = [
  ["GET", "/v1/models", "查看当前 Sub2 密钥可用的模型。"],
  ["POST", "/v1/images/generations", "文生图；model 使用 gpt-image-2，prompt 为必填项。"],
  ["POST", "/v1/images/edits", "图生图；使用 multipart/form-data 上传 image 文件和 prompt。"],
];

const adminEndpoints = [
  ["GET", "/api/accounts", "账号池列表与状态"],
  ["GET", "/api/images", "生成图片列表"],
  ["GET", "/api/logs", "调用和账号日志"],
  ["GET / POST", "/api/settings", "查看与保存配置"],
  ["GET", "/api/backups", "备份列表"],
  ["GET", "/api/cpa/pools", "CPA 导入连接"],
  ["GET", "/api/sub2api/servers", "Sub2 账号导入连接"],
  ["GET", "/health?format=json", "账号池和存储健康状态"],
];

function EndpointTable({ rows }: { rows: string[][] }) {
  return <div className="overflow-x-auto rounded-xl border border-stone-200">
    <table className="w-full text-left text-xs">
      <thead className="bg-stone-50 text-stone-500"><tr>
        <th className="px-3 py-2">方法</th><th className="px-3 py-2">路径</th><th className="px-3 py-2">用途</th>
      </tr></thead>
      <tbody className="divide-y divide-stone-100">{rows.map(([method, path, note]) => <tr key={path}>
        <td className="whitespace-nowrap px-3 py-2 font-mono">{method}</td>
        <td className="whitespace-nowrap px-3 py-2 font-mono">{path}</td>
        <td className="px-3 py-2">{note}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function ApiDocsCard() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const example = `curl '${origin}/v1/images/generations' \\
  -H 'Authorization: Bearer <Sub2绘图分组API密钥>' \\
  -H 'User-Agent: Mazal-Image-Gateway/1.0' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"gpt-image-2","prompt":"一只老虎","n":1,"size":"1024x1024","response_format":"b64_json"}'`;
  const editExample = `curl '${origin}/v1/images/edits' \\
  -H 'Authorization: Bearer <Sub2绘图分组API密钥>' \\
  -H 'User-Agent: Mazal-Image-Gateway/1.0' \\
  -F 'model=gpt-image-2' -F 'prompt=将背景改成森林' \\
  -F 'image=@reference.png' -F 'response_format=b64_json'`;
  return <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
    <CardContent className="space-y-6 p-6 text-sm text-stone-700">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">绘图接口接入</h2>
        <p>用户使用 Sub2「生图分组」签发的 API 密钥，生成请求经过主站权限检查与计费。管理员密钥只用于后台和内部引擎。</p>
        <p>用户工作台：<a className="underline" href="/" target="_blank" rel="noreferrer">{origin}/</a>；后台生图测试：<a className="underline" href="/image/">管理员生图测试</a>。</p>
        <div className="rounded-xl bg-stone-50 p-3 font-mono text-xs">OpenAI Base URL：{origin}/v1<br />Authorization: Bearer &lt;Sub2绘图分组API密钥&gt;</div>
        <p className="text-xs">支持模型：gpt-image-2。本站用户入口开放下表中的图片接口；对话、搜索、PPT、PSD 请使用相应服务，不能照搬旧版引擎说明接入。</p>
      </div>
      <EndpointTable rows={customerEndpoints} />
      <details className="rounded-xl border border-stone-200 p-4" open>
        <summary className="cursor-pointer font-semibold">文生图示例</summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-stone-950 p-3 text-xs text-stone-100">{example}</pre>
        <p className="mt-2 text-xs">调用示例会实际生成并按分组定价扣费。size=auto 按主站实际尺寸规则计价；2K、4K 应先在主站设置价格。</p>
      </details>
      <details className="rounded-xl border border-stone-200 p-4">
        <summary className="cursor-pointer font-semibold">图生图示例</summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-stone-950 p-3 text-xs text-stone-100">{editExample}</pre>
        <p className="mt-2 text-xs">上传本地图片文件；不支持让服务器下载参考图链接。请求总大小上限 30 MB。</p>
      </details>
      <div className="space-y-3">
        <h3 className="font-semibold">后台管理接口</h3>
        <p className="text-xs">需要管理员密钥。账号导入连接只负责同步账号，用户鉴权和计费由主站接入链路负责。本地用户密钥的创建、修改已停用。</p>
        <EndpointTable rows={adminEndpoints} />
      </div>
      <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-4">
        <h3 className="font-semibold">Sub2 内部绘图渠道</h3>
        <p className="font-mono text-xs">渠道 Base URL：{origin}/engine</p>
        <p className="text-xs">仅供主站调用，使用独立引擎密钥；模型映射为 gpt-image-2。渠道可配置独立 User-Agent。不要把引擎密钥分发给用户。</p>
        <p className="text-xs">后台「生图测试」直接测试账号池，会消耗账号额度；用户工作台用于核对主站权限与计费。</p>
      </div>
    </CardContent>
  </Card>;
}
