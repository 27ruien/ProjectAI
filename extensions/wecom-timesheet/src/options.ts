import { validateSelectorConfig } from "./shared/selector-config";
import { loadConfig, saveConfig } from "./shared/storage";

const boardUrl = document.querySelector<HTMLInputElement>("#board-url")!;
const selectors = document.querySelector<HTMLTextAreaElement>("#selectors")!;
const status = document.querySelector<HTMLElement>("#status")!;

function validUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) return null;
    return url;
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  const config = await loadConfig();
  boardUrl.value = config.boardUrl;
  if (config.selectors) selectors.value = JSON.stringify(config.selectors, null, 2);
  else {
    const response = await fetch(chrome.runtime.getURL("selector-config.default.json"));
    selectors.value = await response.text();
  }
  status.textContent = __WECOM_ALLOWED_ORIGIN__
    ? `当前构建允许企业微信 Origin：${__WECOM_ALLOWED_ORIGIN__}`
    : "当前构建未绑定企业微信 Origin。获得真实 URL 后需重新构建扩展。";
}

document.querySelector("#save")?.addEventListener("click", () => {
  void (async () => {
    const url = validUrl(boardUrl.value.trim());
    if (!url) {
      status.textContent = "看板 URL 无效；只允许 HTTPS 或本机 Mock URL。";
      return;
    }
    if (!__WECOM_ALLOWED_ORIGIN__ || url.origin !== __WECOM_ALLOWED_ORIGIN__) {
      status.textContent = "URL Origin 未包含在当前构建权限中，请使用 WECOM_TASK_BOARD_URL 重新构建。";
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(selectors.value);
    } catch {
      status.textContent = "Selector Config JSON 无效。";
      return;
    }
    const parsed = validateSelectorConfig(raw);
    if (!parsed.ok) {
      status.textContent = `Selector Config 被拒绝：${parsed.code}`;
      return;
    }
    const originPattern = `${url.origin}/*`;
    const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
    const granted = hasPermission || (await chrome.permissions.request({ origins: [originPattern] }));
    if (!granted) {
      status.textContent = "未获得该企业微信 Origin 的权限。";
      return;
    }
    await saveConfig({ boardUrl: url.toString(), selectors: parsed.value });
    status.textContent = "配置已保存。完整路径仅保存在本机扩展存储中，不会进入构建产物或日志。";
  })();
});

void load();
