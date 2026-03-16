(function () {
const nodes = {
  reloadBtn: document.getElementById("reload-btn"),
  saveBtn: document.getElementById("save-btn"),
  testTelegramBtn: document.getElementById("test-telegram-btn"),
  serviceStatusBtn: document.getElementById("service-status-btn"),
  serviceStartBtn: document.getElementById("service-start-btn"),
  serviceRestartBtn: document.getElementById("service-restart-btn"),
  serviceStopBtn: document.getElementById("service-stop-btn"),
  serviceSummary: document.getElementById("service-summary"),
  serviceDetail: document.getElementById("service-detail"),
  pathText: document.getElementById("path-text"),
  globalStatus: document.getElementById("global-status")
};

if (
  !nodes.reloadBtn ||
  !nodes.saveBtn ||
  !nodes.testTelegramBtn ||
  !nodes.serviceStatusBtn ||
  !nodes.serviceStartBtn ||
  !nodes.serviceRestartBtn ||
  !nodes.serviceStopBtn ||
  !nodes.serviceSummary ||
  !nodes.serviceDetail ||
  !nodes.pathText ||
  !nodes.globalStatus
) {
  return;
}

init();

async function init() {
  wireEvents();
  await loadConfig();
}

function wireEvents() {
  nodes.reloadBtn.addEventListener("click", loadConfig);
  nodes.saveBtn.addEventListener("click", saveConfig);
  nodes.testTelegramBtn.addEventListener("click", () => testChannel("telegram"));
  nodes.serviceStatusBtn.addEventListener("click", () => serviceAction("status"));
  nodes.serviceStartBtn.addEventListener("click", () => serviceAction("start"));
  nodes.serviceRestartBtn.addEventListener("click", () => serviceAction("restart"));
  nodes.serviceStopBtn.addEventListener("click", () => serviceAction("stop"));
}

async function loadConfig() {
  setStatus("正在加载配置...");
  try {
    const data = await apiGet("/api/integrations/config");
    applyConfigToForm(data.bridgeConfig || {});
    applyEnvToForm(data.env || {});
    renderServiceStatus(data.service || {});
    const configPath = data.paths?.bridgeConfigPath || "-";
    const envPath = data.paths?.bridgeEnvPath || "-";
    nodes.pathText.textContent = `配置路径：${configPath} ｜ 环境变量路径：${envPath}`;
    setStatus("已加载配置");
  } catch (error) {
    setStatus(`加载失败：${error.message}`);
  }
}

async function saveConfig() {
  setStatus("正在保存...");
  try {
    const payload = {
      bridgeConfig: collectBridgeConfigFromForm(),
      env: collectEnvFromForm()
    };
    const data = await apiPost("/api/integrations/config", payload);
    renderServiceStatus(data.service || {});
    setStatus("保存成功");
  } catch (error) {
    setStatus(`保存失败：${error.message}`);
  }
}

async function serviceAction(action) {
  setStatus(`正在执行服务操作：${action}...`);
  try {
    const data = await apiPost("/api/integrations/service", { action });
    renderServiceStatus(data.service || {});
    setStatus(`服务操作成功：${action}`);
  } catch (error) {
    setStatus(`服务操作失败：${error.message}`);
  }
}

async function testChannel(type) {
  setStatus(`正在测试 ${type}...`);
  try {
    const payload = {
      type,
      bridgeConfig: collectBridgeConfigFromForm(),
      env: collectEnvFromForm()
    };
    const data = await apiPost("/api/integrations/test", payload);
    const result = data.result || {};
    nodes.serviceDetail.textContent = JSON.stringify(
      {
        testType: type,
        success: true,
        result
      },
      null,
      2
    );
    setStatus(`测试成功：${type}`);
  } catch (error) {
    setStatus(`测试失败：${error.message}`);
  }
}

function renderServiceStatus(service) {
  const available = !!service.available;
  const active = !!service.active;
  const enabled = !!service.enabled;
  const label = available
    ? `服务状态：${active ? "运行中" : "未运行"} ｜ 开机启动：${enabled ? "已启用" : "未启用"}`
    : `服务状态：不可用（${service.message || "systemctl --user 不可用"}）`;
  nodes.serviceSummary.textContent = label;
  nodes.serviceDetail.textContent = service.statusText || service.activeRaw || service.enabledRaw || "{}";
}

function applyConfigToForm(config) {
  const model = config.model || {};
  const bot = config.bot || {};
  const telegram = config.telegram || {};

  setValue("model-provider", model.provider || "openai");
  setValue("model-id", model.model || "");
  setValue("model-base-url", model.baseUrl || "");
  setValue("model-api-key", model.apiKey || "");
  setValue("model-system-prompt", model.systemPrompt || "");
  setValue("model-temperature", toDisplayNumber(model.temperature, 0.7));
  setValue("model-max-tokens", toDisplayNumber(model.maxTokens, 1024));
  setValue("model-top-p", toDisplayNumber(model.topP, 1));
  setValue("bot-history-turns", toDisplayNumber(bot.historyTurns, 12));

  setChecked("tg-enabled", telegram.enabled);
  setValue("tg-bot-token", telegram.botToken || "");
  setValue("tg-api-base", telegram.apiBase || "https://api.telegram.org");
  setValue("tg-poll-timeout", toDisplayNumber(telegram.pollTimeoutSec, 20));
  setValue("tg-poll-interval", toDisplayNumber(telegram.pollIntervalMs, 1200));
  setValue("tg-allowed-chat-ids", listToText(telegram.allowedChatIds));
}

function collectBridgeConfigFromForm() {
  return {
    model: {
      provider: getValue("model-provider"),
      baseUrl: getValue("model-base-url"),
      apiKey: getValue("model-api-key"),
      model: getValue("model-id"),
      systemPrompt: getValue("model-system-prompt"),
      temperature: parseFloatWithDefault(getValue("model-temperature"), 0.7),
      maxTokens: parseIntWithDefault(getValue("model-max-tokens"), 1024),
      topP: parseFloatWithDefault(getValue("model-top-p"), 1)
    },
    bot: {
      historyTurns: parseIntWithDefault(getValue("bot-history-turns"), 12)
    },
    telegram: {
      enabled: getChecked("tg-enabled"),
      botToken: getValue("tg-bot-token"),
      apiBase: getValue("tg-api-base"),
      pollTimeoutSec: parseIntWithDefault(getValue("tg-poll-timeout"), 20),
      pollIntervalMs: parseIntWithDefault(getValue("tg-poll-interval"), 1200),
      allowedChatIds: textToList(getValue("tg-allowed-chat-ids"))
    }
  };
}

function applyEnvToForm(env) {
  setValue("env-rc-key", env.RC_KEY || "");
  setValue("env-tg-bot-token", env.TG_BOT_TOKEN || "");
}

function collectEnvFromForm() {
  return {
    RC_KEY: getValue("env-rc-key"),
    TG_BOT_TOKEN: getValue("env-tg-bot-token")
  };
}

function setStatus(text) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  nodes.globalStatus.textContent = `状态：${text} (${hh}:${mm}:${ss})`;
}

async function apiGet(url) {
  const response = await fetch(url);
  return parseResponse(response);
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = `/login.html?next=${encodeURIComponent(next)}`;
    throw new Error("未登录：已跳转到登录页");
  }
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    throw new Error(`服务返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  }
  return data;
}

function getValue(id) {
  return String(document.getElementById(id).value || "").trim();
}

function setValue(id, value) {
  document.getElementById(id).value = String(value ?? "");
}

function getChecked(id) {
  return !!document.getElementById(id).checked;
}

function setChecked(id, checked) {
  document.getElementById(id).checked = !!checked;
}

function textToList(text) {
  return String(text || "")
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToText(list) {
  if (!Array.isArray(list)) return "";
  return list.map((item) => String(item).trim()).filter(Boolean).join("\n");
}

function parseFloatWithDefault(value, fallback) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntWithDefault(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDisplayNumber(value, fallback) {
  return Number.isFinite(value) ? String(value) : String(fallback);
}
})();
