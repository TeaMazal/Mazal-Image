import { useEffect, useState } from "react";
import { fetchCanvasPricing } from "@/services/api/souhub";
export function SouhubPrice({ size, count }: { size: string; count: string }) {
    const [prices, setPrices] = useState<Record<string, number>>();
    const [failed, setFailed] = useState(false);
    useEffect(() => { let live = true; void fetchCanvasPricing().then((value) => { if (live) setPrices(value); }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, []);
    const dimensions = /^(\d+)x(\d+)$/.exec(size);
    const edge = dimensions ? Math.max(Number(dimensions[1]), Number(dimensions[2])) : 0;
    const tier = edge ? edge <= 1024 ? "1K" : edge <= 2048 ? "2K" : "4K" : "";
    const values = prices && (tier ? [prices[tier]] : Object.values(prices));
    const amount = (value: number) => "$" + Number((value * (Number(count) || 1)).toFixed(6));
    return <p style={{ fontSize: 11, opacity: .65, margin: "8px 0 0" }}>{values ? `预计 ${amount(Math.min(...values))}${Math.min(...values) === Math.max(...values) ? "" : "–" + amount(Math.max(...values))} · ${Number(count) || 1} 张` : failed ? "价格暂不可用，可在主站查看" : "正在读取价格…"} · 最终按成功图片和实际尺寸计费</p>;
}
