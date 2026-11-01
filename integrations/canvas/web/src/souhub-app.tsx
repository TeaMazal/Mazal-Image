import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";
import { startCloudSync } from "@/services/souhub-sync";
import { useConfigStore } from "@/stores/use-config-store";
import { canvasKey } from "@/services/api/souhub";
import "./styles/souhub.css";



document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

async function start() {
document.getElementById("root")!.textContent = "正在读取工作区设置…";
await useConfigStore.persist.rehydrate();
const config = useConfigStore.getState().config;
useConfigStore.setState({ config: { ...config, apiKey: canvasKey(), baseUrl: window.location.origin, model: "souhub::gpt-image-2", imageModel: "souhub::gpt-image-2", textModel: "", videoModel: "", audioModel: "", count: "1", canvasImageCount: "1", channels: [{ id: "souhub", name: "Souhub Image", baseUrl: window.location.origin, apiKey: canvasKey(), apiFormat: "openai", models: [{ name: "gpt-image-2", capability: "image" }] }], models: ["souhub::gpt-image-2"] } });
document.getElementById("root")!.textContent = "正在恢复你的本机画布…";
await startCloudSync();
createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);

}
export const ready = start();
