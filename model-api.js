const REMOTE_CONFIG_API = "/api/models/config";
const providerPresets = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic（Claude）", baseUrl: "https://api.anthropic.com/v1" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  azure_openai: {
    label: "Azure OpenAI",
    baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}"
  },
  custom: { label: "自定义", baseUrl: "" }
};

const nodes = {
  quickBaseUrl: document.getElementById("quick-base-url"),
  quickApiKey: document.getElementById("quick-api-key"),
  quickCreateBtn: document.getElementById("quick-create-btn"),
  quickFillCurrentBtn: document.getElementById("quick-fill-current-btn"),
  quickResult: document.getElementById("quick-result"),
  reloadBtn: document.getElementById("reload-btn"),
  saveBtn: document.getElementById("save-btn"),
  newBtn: document.getElementById("new-btn"),
  discoverBtn: document.getElementById("discover-btn"),
  testBtn: document.getElementById("test-btn"),
  toggleKeyBtn: document.getElementById("toggle-key-btn"),
  profileSelect: document.getElementById("profile-select"),
  name: document.getElementById("name"),
  provider: document.getElementById("provider"),
  model: document.getElementById("model"),
  baseUrl: document.getElementById("base-url"),
  apiKey: document.getElementById("api-key"),
  temperature: document.getElementById("temperature"),
  maxTokens: document.getElementById("max-tokens"),
  topP: document.getElementById("top-p"),
  setDefault: document.getElementById("set-default"),
  modelCandidates: document.getElementById("model-candidates"),
  pathText: document.getElementById("path-text"),
  statusText: document.getElementById("status-text")
};

let state = {
  version: 1,
  updatedAt: "",
  defaultModelId: "",
  models: []
};
let selectedModelId = "";
let availableModels = [];

init();

async function init() {
  fillProviderOptions();
  wireEvents();
  await loadState();
}

function fillProviderOptions() {
  nodes.provider.innerHTML = "";
  Object.entries(providerPresets).forEach(([value, item]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = item.label;
    nodes.provider.appendChild(option);
  });
}

function wireEvents() {
  nodes.quickCreateBtn.addEventListener("click", quickCreateDefaultModel);
  nodes.quickFillCurrentBtn.addEventListener("click", quickFillFromCurrentForm);
  nodes.reloadBtn.addEventListener("click", loadState);
  nodes.saveBtn.addEventListener("click", saveCurrentModel);
  nodes.newBtn.addEventListener("click", createEmptyDraft);
  nodes.discoverBtn.addEventListener("click", discoverModels);
  nodes.testBtn.addEventListener("click", testModelConnection);
  nodes.profileSelect.addEventListener("change", onProfileChange);
  nodes.provider.addEventListener("change", onProviderChange);
  nodes.modelCandidates.addEventListener("change", () => {
    const picked = String(nodes.modelCandidates.value || "").trim();
    if (picked) nodes.model.value = picked;
  });
  nodes.toggleKeyBtn.addEventListener("click", toggleApiKeyVisible);
}

async function loadState() {
  setStatus("正在加载模型配置...");
  try {
    const payload = await apiGet(REMOTE_CONFIG_API);
    state = normalizeState(payload.state || {});
    selectedModelId = state.defaultModelId || state.models[0]?.id || "";
    renderProfileList();
    applySelectedModelToForm();
    if (!String(nodes.quickBaseUrl.value || "").trim() && state.models.length) {
      nodes.quickBaseUrl.value = String(state.models[0].baseUrl || "").trim();
    }
    if (state.defaultModelId) {
      const current = state.models.find((item) => item.id === state.defaultModelId);
      if (current) {
        setQuickResult(`当前默认：${current.provider} / ${current.model || "-"}`);
      }
    }
    nodes.pathText.textContent = `配置路径：${payload.path || "-"}`;
    setStatus(`已加载 ${state.models.length} 条模型配置`);
  } catch (error) {
    setStatus(`加载失败：${error.message}`);
  }
}

function onProfileChange() {
  selectedModelId = String(nodes.profileSelect.value || "").trim();
  applySelectedModelToForm();
}

function onProviderChange() {
  const provider = String(nodes.provider.value || "custom").trim();
  const preset = providerPresets[provider] || providerPresets.custom;
  if (!String(nodes.baseUrl.value || "").trim()) {
    nodes.baseUrl.value = preset.baseUrl;
  }
}

function renderProfileList() {
  nodes.profileSelect.innerHTML = "";
  if (!state.models.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "暂无模型，点击“新建”";
    nodes.profileSelect.appendChild(empty);
    return;
  }

  state.models.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    const suffix = item.id === state.defaultModelId ? "（默认）" : "";
    option.textContent = `${item.name} · ${item.model || "-"} ${suffix}`;
    nodes.profileSelect.appendChild(option);
  });
  nodes.profileSelect.value = selectedModelId || state.models[0].id;
}

function applySelectedModelToForm() {
  const current = state.models.find((item) => item.id === selectedModelId);
  if (!current) {
    createEmptyDraft();
    return;
  }
  nodes.name.value = current.name || "";
  nodes.provider.value = current.provider || "custom";
  nodes.model.value = current.model || "";
  nodes.baseUrl.value = current.baseUrl || "";
  nodes.apiKey.value = current.apiKey || "";
  nodes.temperature.value = toDisplayNumber(current.temperature, 0.7);
  nodes.maxTokens.value = toDisplayNumber(current.maxTokens, 1024);
  nodes.topP.value = toDisplayNumber(current.topP, 1);
  nodes.setDefault.checked = current.id === state.defaultModelId;
  nodes.quickBaseUrl.value = current.baseUrl || nodes.quickBaseUrl.value || "";
  if (!String(nodes.quickApiKey.value || "").trim()) {
    nodes.quickApiKey.value = current.apiKey || "";
  }
  availableModels = normalizeModelList(current.availableModels || []);
  renderCandidateList();
}

function createEmptyDraft() {
  selectedModelId = "";
  nodes.profileSelect.value = "";
  nodes.name.value = "新模型";
  nodes.provider.value = "openai";
  nodes.model.value = "";
  nodes.baseUrl.value = providerPresets.openai.baseUrl;
  nodes.apiKey.value = "";
  nodes.temperature.value = "0.7";
  nodes.maxTokens.value = "1024";
  nodes.topP.value = "1";
  nodes.setDefault.checked = !state.models.length;
  availableModels = [];
  renderCandidateList();
  setStatus("已切换到新建模式");
}

function quickFillFromCurrentForm() {
  nodes.quickBaseUrl.value = String(nodes.baseUrl.value || "").trim();
  nodes.quickApiKey.value = String(nodes.apiKey.value || "").trim();
  setQuickResult("已填入当前表单里的 Base URL 与 API Key");
}

async function quickCreateDefaultModel() {
  const baseUrl = String(nodes.quickBaseUrl.value || "").trim();
  const apiKey = String(nodes.quickApiKey.value || "").trim();
  if (!baseUrl) {
    setStatus("一键接入失败：请先填写 Base URL");
    setQuickResult("失败：Base URL 为空");
    return;
  }
  if (!apiKey) {
    setStatus("一键接入失败：请先填写 API Key");
    setQuickResult("失败：API Key 为空");
    return;
  }

  const providerOrder = buildProviderProbeOrder(baseUrl);
  setStatus(`一键接入中：正在识别提供商（${providerOrder.join(" -> ")}）`);
  setQuickResult("正在自动探测提供商与模型...");

  let matchedProvider = "";
  let discoveredModels = [];
  const errors = [];

  for (const provider of providerOrder) {
    try {
      const payload = await apiPost("/api/models/discover", { provider, baseUrl, apiKey });
      const list = normalizeModelList(payload.models);
      if (list.length) {
        matchedProvider = provider;
        discoveredModels = list;
        break;
      }
      errors.push(`${provider}: 无可用模型`);
    } catch (error) {
      errors.push(`${provider}: ${error.message}`);
    }
  }

  if (!matchedProvider || !discoveredModels.length) {
    const brief = errors.slice(0, 3).join("；");
    setStatus("一键接入失败：自动识别不到可用模型，请手动配置");
    setQuickResult(`失败：${brief || "无返回结果"}`);
    return;
  }

  const pickedModel = pickPreferredModel(discoveredModels);
  const modelItem = {
    id: buildId(),
    name: buildQuickModelName(matchedProvider, pickedModel, baseUrl),
    provider: matchedProvider,
    model: pickedModel,
    baseUrl,
    apiKey,
    temperature: 0.7,
    maxTokens: 1024,
    topP: 1,
    enabled: true,
    availableModels: discoveredModels
  };

  const nextModels = state.models.slice();
  const sameIndex = nextModels.findIndex((item) => {
    return (
      String(item.provider || "").trim() === modelItem.provider &&
      String(item.baseUrl || "").trim() === modelItem.baseUrl &&
      String(item.model || "").trim() === modelItem.model
    );
  });
  if (sameIndex >= 0) {
    modelItem.id = nextModels[sameIndex].id;
    nextModels[sameIndex] = modelItem;
  } else {
    nextModels.push(modelItem);
  }

  const nextState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaultModelId: modelItem.id,
    models: nextModels
  };

  setStatus("一键接入中：正在保存为默认模型...");
  try {
    const payload = await apiPost(REMOTE_CONFIG_API, { state: nextState });
    state = normalizeState(payload.state || nextState);
    selectedModelId = modelItem.id;
    renderProfileList();
    applySelectedModelToForm();
    setStatus(`一键接入成功：默认模型已设为 ${pickedModel}`);
    setQuickResult(`成功：${providerPresets[matchedProvider]?.label || matchedProvider} / ${pickedModel}`);
  } catch (error) {
    setStatus(`一键接入失败：${error.message}`);
    setQuickResult(`失败：保存配置出错（${error.message}）`);
  }
}

async function saveCurrentModel() {
  const name = String(nodes.name.value || "").trim() || "未命名模型";
  const provider = normalizeProvider(nodes.provider.value);
  const model = String(nodes.model.value || "").trim();
  const baseUrl = String(nodes.baseUrl.value || "").trim();
  const apiKey = String(nodes.apiKey.value || "").trim();
  if (!model) {
    setStatus("保存失败：模型 ID 不能为空");
    return;
  }
  if (!baseUrl) {
    setStatus("保存失败：API 请求地址不能为空");
    return;
  }
  if (provider !== "ollama" && !apiKey) {
    setStatus("保存失败：API Key 不能为空");
    return;
  }

  const modelItem = {
    id: selectedModelId || buildId(),
    name,
    provider,
    model,
    baseUrl,
    apiKey,
    temperature: parseFloatWithDefault(nodes.temperature.value, 0.7),
    maxTokens: parseIntWithDefault(nodes.maxTokens.value, 1024),
    topP: parseFloatWithDefault(nodes.topP.value, 1),
    enabled: true,
    availableModels: normalizeModelList(availableModels)
  };

  const nextModels = state.models.slice();
  const index = nextModels.findIndex((item) => item.id === modelItem.id);
  if (index >= 0) {
    nextModels[index] = modelItem;
  } else {
    nextModels.push(modelItem);
  }

  let defaultModelId = state.defaultModelId;
  if (nodes.setDefault.checked || !defaultModelId || !nextModels.some((item) => item.id === defaultModelId)) {
    defaultModelId = modelItem.id;
  }

  const nextState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaultModelId,
    models: nextModels
  };

  setStatus("正在保存配置...");
  try {
    const payload = await apiPost(REMOTE_CONFIG_API, { state: nextState });
    state = normalizeState(payload.state || nextState);
    selectedModelId = modelItem.id;
    renderProfileList();
    applySelectedModelToForm();
    setStatus("保存成功，chat.html 可直接使用");
  } catch (error) {
    setStatus(`保存失败：${error.message}`);
  }
}

async function discoverModels() {
  const provider = normalizeProvider(nodes.provider.value);
  const baseUrl = String(nodes.baseUrl.value || "").trim();
  const apiKey = String(nodes.apiKey.value || "").trim();
  if (!baseUrl) {
    setStatus("拉取失败：请先填写 API 请求地址");
    return;
  }
  if (provider !== "ollama" && !apiKey) {
    setStatus("拉取失败：请先填写 API Key");
    return;
  }

  setStatus("正在拉取模型列表...");
  try {
    const payload = await apiPost("/api/models/discover", {
      provider,
      baseUrl,
      apiKey
    });
    availableModels = normalizeModelList(payload.models);
    renderCandidateList();
    if (!String(nodes.model.value || "").trim() && availableModels.length) {
      nodes.model.value = availableModels[0];
    }
    setStatus(`拉取成功：共 ${availableModels.length} 个模型`);
  } catch (error) {
    setStatus(`拉取失败：${error.message}`);
  }
}

function renderCandidateList() {
  nodes.modelCandidates.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = availableModels.length ? "可用模型（请选择）" : "可用模型（先点击“拉取模型列表”）";
  nodes.modelCandidates.appendChild(first);
  availableModels.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    nodes.modelCandidates.appendChild(option);
  });
}

async function testModelConnection() {
  const provider = normalizeProvider(nodes.provider.value);
  const model = String(nodes.model.value || "").trim();
  const baseUrl = String(nodes.baseUrl.value || "").trim();
  const apiKey = String(nodes.apiKey.value || "").trim();
  if (!model) {
    setStatus("测试失败：请先填写模型 ID");
    return;
  }
  if (!baseUrl) {
    setStatus("测试失败：请先填写 API 请求地址");
    return;
  }
  if (provider !== "ollama" && !apiKey) {
    setStatus("测试失败：请先填写 API Key");
    return;
  }

  setStatus("正在进行连通性测试...");
  try {
    const payload = await apiPost("/api/models/test", {
      provider,
      model,
      baseUrl,
      apiKey
    });
    setStatus(`测试成功：${payload.model}，延迟 ${payload.latencyMs}ms，回复 ${payload.preview || "-"}`);
  } catch (error) {
    setStatus(`测试失败：${error.message}`);
  }
}

function toggleApiKeyVisible() {
  const hidden = nodes.apiKey.type === "password";
  nodes.apiKey.type = hidden ? "text" : "password";
  nodes.toggleKeyBtn.textContent = hidden ? "隐藏" : "显示";
}

function buildProviderProbeOrder(baseUrl) {
  const guessed = guessProviderByBaseUrl(baseUrl);
  const fallback = ["openai", "openrouter", "deepseek", "gemini", "anthropic", "custom"];
  const order = [];
  if (guessed) order.push(guessed);
  fallback.forEach((item) => {
    if (!order.includes(item)) order.push(item);
  });
  return order;
}

function guessProviderByBaseUrl(baseUrl) {
  const value = String(baseUrl || "").toLowerCase();
  if (value.includes("localhost:11434") || value.includes("/api/tags") || value.includes("ollama")) return "ollama";
  if (value.includes(".openai.azure.com/") || value.includes("/openai/deployments/")) return "azure_openai";
  if (value.includes("anthropic")) return "anthropic";
  if (value.includes("openrouter")) return "openrouter";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("generativelanguage.googleapis") || value.includes("gemini")) return "gemini";
  if (value.includes("api.openai.com") || value.includes("/v1")) return "openai";
  return "custom";
}

function pickPreferredModel(models) {
  const list = normalizeModelList(models);
  if (!list.length) return "";
  const preferredRules = [
    /^gpt-5(\b|[-.])/i,
    /^gpt-4\.1(\b|[-.])/i,
    /^gpt-4o(\b|[-.])/i,
    /^claude/i,
    /^gemini/i,
    /^deepseek/i
  ];
  for (const rule of preferredRules) {
    const hit = list.find((item) => rule.test(item));
    if (hit) return hit;
  }
  return list[0];
}

function buildQuickModelName(provider, model, baseUrl) {
  const label = String(providerPresets[provider]?.label || provider || "custom")
    .replace(/（.*?）/g, "")
    .trim();
  const host = resolveHostLabel(baseUrl);
  return `一键-${label}-${host}-${model}`;
}

function resolveHostLabel(baseUrl) {
  try {
    const host = new URL(baseUrl).host.toLowerCase();
    return host.replace(/[^a-z0-9.-]/g, "").slice(0, 36) || "api";
  } catch (_error) {
    return "api";
  }
}

function setQuickResult(text) {
  nodes.quickResult.textContent = `结果：${text}`;
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const modelsRaw = Array.isArray(source.models) ? source.models : [];
  const seen = new Set();
  const models = modelsRaw
    .map((item) => normalizeModel(item, seen))
    .filter((item) => !!item);
  const defaultModelId = models.some((item) => item.id === source.defaultModelId)
    ? source.defaultModelId
    : models[0]?.id || "";
  return {
    version: Number.isFinite(source.version) ? source.version : 1,
    updatedAt: String(source.updatedAt || ""),
    defaultModelId,
    models
  };
}

function normalizeModel(input, seen) {
  if (!input || typeof input !== "object") return null;
  let id = String(input.id || "").trim() || buildId();
  while (seen.has(id)) id = buildId();
  seen.add(id);
  return {
    id,
    name: String(input.name || "").trim() || "未命名模型",
    provider: normalizeProvider(input.provider),
    model: String(input.model || "").trim(),
    baseUrl: String(input.baseUrl || "").trim(),
    apiKey: String(input.apiKey || "").trim(),
    temperature: parseFloatWithDefault(input.temperature, 0.7),
    maxTokens: parseIntWithDefault(input.maxTokens, 1024),
    topP: parseFloatWithDefault(input.topP, 1),
    enabled: input.enabled !== false,
    availableModels: normalizeModelList(input.availableModels)
  };
}

function normalizeProvider(value) {
  const provider = String(value || "").trim();
  return providerPresets[provider] ? provider : "custom";
}

function normalizeModelList(input) {
  const list = Array.isArray(input) ? input : [];
  return Array.from(
    new Set(
      list
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function buildId() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function setStatus(text) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  nodes.statusText.textContent = `状态：${text} (${hh}:${mm}:${ss})`;
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
    throw new Error("未登录：已跳转登录页");
  }
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    throw new Error(`服务返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}
