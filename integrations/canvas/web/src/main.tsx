import { initializeCanvas, canvasKey } from "./services/api/souhub";
async function boot() {
  if (canvasKey()) {
    try { await initializeCanvas(); document.getElementById("root")!.textContent = "正在打开你的画布工作区…"; const app = await import("./souhub-app"); await app.ready; return; }
    catch (error) { showLogin(error instanceof Error ? error.message : "连接失败"); return; }
  }
  showLogin("");
}
function showLogin(message: string) {
  document.body.style.cssText = "margin:0;background:#f7f5f0;color:#24231f;font-family:system-ui";
  const root = document.getElementById("root")!;
  root.innerHTML = `<main style="max-width:420px;margin:14vh auto;padding:30px"><a href="/" style="color:inherit">← 返回创作空间</a><h1>Souhub 无限画布</h1><p>使用主站绘图密钥登录，画布自动保存到你的云端空间。</p><form><input name="key" type="password" autocomplete="off" placeholder="输入 API 密钥" required style="box-sizing:border-box;width:100%;padding:14px;border:1px solid #ddd8ce;border-radius:10px"><label style="display:block;margin:16px 0"><input name="remember" type="checkbox"> 在此设备记住密钥</label><button style="width:100%;background:#25241f;color:white;border:0;border-radius:10px;padding:13px;cursor:pointer">进入画布</button><p role="alert" style="color:#965b2d"></p></form></main>`;
  root.querySelector('[role="alert"]')!.textContent = message;
  root.querySelector("form")!.onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const key = String(form.get("key") || "").trim();
    sessionStorage.setItem("mazal-image-key", key);
    root.querySelector("button")!.disabled = true;
    try {
      await initializeCanvas();
      if (form.has("remember")) localStorage.setItem("mazal-image-key", key); else localStorage.removeItem("mazal-image-key");
      // 工作区存储在模块加载时绑定用户；换密钥后重新载入，避免复用旧用户的实例。
      location.reload();
    } catch (error) {
      sessionStorage.removeItem("mazal-image-key");
      showLogin(error instanceof Error ? error.message : "连接失败");
    }
  };
}
void boot();
