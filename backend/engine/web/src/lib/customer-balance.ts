import { httpRequest } from "@/lib/request";

type Limit = { limit: number | null; used: number | null; remaining: number | null };
export type CustomerBalance = {
  source: "sub2api" | "local";
  balance?: number | null;
  remaining?: number | null;
  quota?: Limit | null;
  subscription?: boolean;
  rate_limits?: Array<Limit & { window: "5h" | "1d" | "7d" }>;
};

export function fetchCustomerBalance() {
  return httpRequest<CustomerBalance>("/api/customer-balance");
}

const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export function formatCustomerBalance(data: CustomerBalance) {
  if (data.source === "local") {
    return { label: "余额", value: "不适用", title: "本地专用密钥没有公益站钱包。使用公益站 API 密钥登录可查看余额。" };
  }
  const limits = data.rate_limits || [];
  const details: string[] = [];
  if (data.balance != null) details.push(`钱包余额：${money(data.balance)}`);
  if (data.quota?.remaining != null) details.push(`密钥剩余额度：${money(data.quota.remaining)}`);
  const windowLabels = { "5h": "5小时", "1d": "每日", "7d": "每周" };
  for (const limit of limits) {
    if (limit.remaining != null) details.push(`${windowLabels[limit.window]}剩余额度：${money(limit.remaining)}`);
  }
  let label = "余额";
  let remaining = data.balance;
  if (data.quota?.remaining != null) {
    label = "密钥额度";
    remaining = data.quota.remaining;
  } else if (data.subscription) {
    label = "套餐额度";
    remaining = data.remaining;
  } else if (remaining == null && limits.length) {
    label = "周期额度";
    const values = limits.flatMap((limit) => limit.remaining == null ? [] : [limit.remaining]);
    remaining = values.length ? Math.min(...values) : null;
  } else if (remaining == null) {
    remaining = data.remaining;
  }
  return { label, value: remaining == null ? "查看公益站" : money(remaining),
    title: [...details, "以公益站计费单位 USD 显示；点击刷新。实际绘图仍受余额、密钥与分组限制。"].join("\n") };
}
