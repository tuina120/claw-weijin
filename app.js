const STORAGE_KEY = "openclaw_model_console_v1";
const STORAGE_BACKUP_KEY = "openclaw_model_console_v1_backup";
const REMOTE_CONFIG_API = "/api/models/config";

const providerPresets = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic（Claude）", baseUrl: "https://api.anthropic.com/v1" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  azure_openai: {
    label: "Azure OpenAI（微软）",
    baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}"
  },
  custom: { label: "自定义", baseUrl: "" }
};

const commonModelKeywords = {
  openai: ["gpt", "o1", "o3", "o4"],
  anthropic: ["claude", "sonnet", "opus", "haiku"],
  gemini: ["gemini", "flash", "pro"],
  deepseek: ["deepseek-chat", "deepseek-reasoner", "deepseek-r1", "deepseek-v"],
  openrouter: ["gpt", "claude", "gemini", "deepseek", "llama", "qwen", "mistral"],
  ollama: ["llama", "qwen", "mistral", "gemma", "phi", "deepseek"],
  azure_openai: ["gpt", "o1", "o3", "o4"],
  custom: ["gpt", "claude", "gemini", "deepseek", "llama", "qwen", "mistral"]
};

const modelTemplate = () => ({
  id: makeId(),
  name: "新模型",
  provider: "openai",
  model: "gpt-4o-mini",
  baseUrl: providerPresets.openai.baseUrl,
  apiKey: "",
  temperature: 0.7,
  maxTokens: 1024,
  topP: 1,
  enabled: true,
  availableModels: []
});

let state = loadState();
let selectedModelId = state.defaultModelId || state.models[0]?.id || null;
const discoveredModelMap = new Map();
let syncTimer = null;
let syncingRemote = false;
let queuedRemoteSync = false;

const nodes = {
  modelList: document.getElementById("model-list"),
  template: document.getElementById("model-item-template"),
  addBtn: document.getElementById("add-model-btn"),
  saveModelBtn: document.getElementById("save-model-btn"),
  duplicateBtn: document.getElementById("duplicate-btn"),
  deleteBtn: document.getElementById("delete-btn"),
  setDefaultBtn: document.getElementById("set-default-btn"),
  copyJsonBtn: document.getElementById("copy-json-btn"),
  exportBtn: document.getElementById("export-btn"),
  importInput: document.getElementById("import-input"),
  preview: document.getElementById("json-preview"),
  saveStatus: document.getElementById("save-status"),
  form: document.getElementById("model-form"),
  apiKeyToggleBtn: document.getElementById("apiKey-toggle-btn"),
  fields: {
    name: document.getElementById("name"),
    provider: document.getElementById("provider"),
    model: document.getElementById("model"),
    baseUrl: document.getElementById("baseUrl"),
    apiKey: document.getElementById("apiKey"),
    temperature: document.getElementById("temperature"),
    maxTokens: document.getElementById("maxTokens"),
    topP: document.getElementById("topP"),
    enabled: document.getElementById("enabled")
  },
  fetchModelsBtn: document.getElementById("fetch-models-btn"),
  filterModelsBtn: document.getElementById("filter-models-btn"),
  testModelBtn: document.getElementById("test-model-btn"),
  modelCandidates: document.getElementById("model-candidates"),
  modelSearch: document.getElementById("model-search"),
  onlyCommon: document.getElementById("only-common")
};

init();

function init() {
  renderProviderOptions();
  wireEvents();
  updateApiKeyToggleState();
  renderAll();
  void hydrateStateFromServer();
}

function renderProviderOptions() {
  nodes.fields.provider.innerHTML = "";
  Object.entries(providerPresets).forEach(([value, preset]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = preset.label;
    nodes.fields.provider.appendChild(opt);
  });
}

function wireEvents() {
  nodes.addBtn.addEventListener("click", () => {
    const item = modelTemplate();
    state.models.push(item);
    selectedModelId = item.id;
    saveAndRender("已新增模型");
  });

  nodes.duplicateBtn.addEventListener("click", () => {
    const current = getSelectedModel();
    if (!current) return;
    const clone = { ...current, id: makeId(), name: `${current.name} - 副本` };
    state.models.push(clone);
    selectedModelId = clone.id;
    saveAndRender("已复制模型");
  });

  nodes.deleteBtn.addEventListener("click", () => {
    const current = getSelectedModel();
    if (!current) return;
    if (state.models.length === 1) {
      setStatus("至少保留 1 个模型");
      return;
    }
    state.models = state.models.filter((m) => m.id !== current.id);
    if (state.defaultModelId === current.id) {
      state.defaultModelId = state.models[0].id;
    }
    if (selectedModelId === current.id) {
      selectedModelId = state.models[0].id;
    }
    saveAndRender("已删除模型");
  });

  nodes.setDefaultBtn.addEventListener("click", () => {
    const current = getSelectedModel();
    if (!current) return;
    state.defaultModelId = current.id;
    saveAndRender("已设置默认模型");
  });
  nodes.saveModelBtn.addEventListener("click", () => onFormInput("已手动保存"));

  bindFieldEvents();
  nodes.fields.provider.addEventListener("change", onProviderChange);
  nodes.exportBtn.addEventListener("click", exportConfig);
  nodes.copyJsonBtn.addEventListener("click", copyJson);
  nodes.importInput.addEventListener("change", importConfig);
  nodes.fetchModelsBtn.addEventListener("click", discoverModels);
  nodes.filterModelsBtn.addEventListener("click", filterAvailableModels);
  nodes.testModelBtn.addEventListener("click", testModelConnection);
  nodes.modelCandidates.addEventListener("input", onModelCandidateChange);
  nodes.modelCandidates.addEventListener("change", onModelCandidateChange);
  nodes.modelSearch.addEventListener("input", renderCurrentModelCandidates);
  nodes.onlyCommon.addEventListener("change", renderCurrentModelCandidates);
  if (nodes.apiKeyToggleBtn) {
    nodes.apiKeyToggleBtn.addEventListener("click", toggleApiKeyVisibility);
  }
}

function bindFieldEvents() {
  const inputs = [
    nodes.fields.name,
    nodes.fields.model,
    nodes.fields.baseUrl,
    nodes.fields.apiKey,
    nodes.fields.temperature,
    nodes.fields.maxTokens,
    nodes.fields.topP
  ];
  inputs.forEach((node) => node.addEventListener("input", onFormInput));
  nodes.fields.enabled.addEventListener("change", onFormInput);
}

function onFormInput(statusText = "已保存") {
  const current = getSelectedModel();
  if (!current) return;

  current.name = nodes.fields.name.value.trim();
  current.provider = nodes.fields.provider.value;
  current.model = nodes.fields.model.value.trim();
  current.baseUrl = nodes.fields.baseUrl.value.trim();
  current.apiKey = nodes.fields.apiKey.value;
  current.temperature = parseFloatOrDefault(nodes.fields.temperature.value, 0.7);
  current.maxTokens = parseIntOrDefault(nodes.fields.maxTokens.value, 1024);
  current.topP = parseFloatOrDefault(nodes.fields.topP.value, 1);
  current.enabled = nodes.fields.enabled.checked;

  saveAndRender(statusText);
}

function onProviderChange() {
  const preset = providerPresets[nodes.fields.provider.value];
  if (!preset) return;
  if (!nodes.fields.baseUrl.value.trim()) {
    nodes.fields.baseUrl.value = preset.baseUrl;
  }
  onFormInput();
}

function renderAll() {
  renderModelList();
  renderEditor();
  renderPreview();
}

function renderModelList() {
  nodes.modelList.innerHTML = "";
  state.models.forEach((item) => {
    const clone = nodes.template.content.cloneNode(true);
    const button = clone.querySelector(".model-item");
    button.dataset.id = item.id;
    button.querySelector(".item-title").textContent = item.name || "(未命名)";
    button.querySelector(".item-meta").textContent =
      `${providerPresets[item.provider]?.label || item.provider} · ${item.model || "未填写模型"} · ${item.enabled ? "启用" : "停用"}`;

    if (item.id === selectedModelId) {
      button.classList.add("active");
    }
    if (item.id === state.defaultModelId) {
      button.classList.add("default");
    }

    button.addEventListener("click", () => {
      selectedModelId = item.id;
      renderAll();
    });
    nodes.modelList.appendChild(clone);
  });
}

function renderEditor() {
  const current = getSelectedModel();
  if (!current) return;
  nodes.fields.name.value = current.name || "";
  nodes.fields.provider.value = providerPresets[current.provider] ? current.provider : "custom";
  nodes.fields.model.value = current.model || "";
  nodes.fields.baseUrl.value = current.baseUrl || "";
  nodes.fields.apiKey.value = current.apiKey || "";
  nodes.fields.temperature.value = toDisplayNumber(current.temperature);
  nodes.fields.maxTokens.value = toDisplayNumber(current.maxTokens);
  nodes.fields.topP.value = toDisplayNumber(current.topP);
  nodes.fields.enabled.checked = !!current.enabled;
  updateApiKeyToggleState();
  renderCurrentModelCandidates();
}

function toggleApiKeyVisibility() {
  const hidden = nodes.fields.apiKey.type === "password";
  nodes.fields.apiKey.type = hidden ? "text" : "password";
  updateApiKeyToggleState();
}

function updateApiKeyToggleState() {
  if (!nodes.apiKeyToggleBtn) return;
  const visible = nodes.fields.apiKey.type === "text";
  nodes.apiKeyToggleBtn.classList.toggle("is-visible", visible);
  const label = visible ? "隐藏 API 密钥" : "显示 API 密钥";
  nodes.apiKeyToggleBtn.setAttribute("aria-label", label);
  nodes.apiKeyToggleBtn.title = label;
}

function renderPreview() {
  nodes.preview.textContent = JSON.stringify(getUnifiedConfig(), null, 2);
}

function getUnifiedConfig() {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    defaultModelId: state.defaultModelId,
    models: state.models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      model: m.model,
      enabled: m.enabled,
      availableModels: normalizeDiscoveredModels(m.availableModels),
      api: {
        baseUrl: m.baseUrl,
        apiKey: m.apiKey
      },
      params: {
        temperature: m.temperature,
        maxTokens: m.maxTokens,
        topP: m.topP
      }
    }))
  };
}

function renderModelCandidates(list, selectedModel) {
  nodes.modelCandidates.innerHTML = "";
  const displayList = list.slice();
  if (selectedModel && !displayList.includes(selectedModel)) {
    displayList.unshift(selectedModel);
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = displayList.length ? `从下拉中选择模型（共 ${displayList.length} 个）` : "可用模型（先点击“拉取模型列表”）";
  nodes.modelCandidates.appendChild(placeholder);

  displayList.forEach((modelId) => {
    const opt = document.createElement("option");
    opt.value = modelId;
    opt.textContent = modelId;
    if (modelId === selectedModel) {
      opt.selected = true;
    }
    nodes.modelCandidates.appendChild(opt);
  });
}

function renderCurrentModelCandidates() {
  const current = getSelectedModel();
  if (!current) return;
  const fullList = discoveredModelMap.get(current.id) || [];
  const filteredList = applyModelFilters(current.provider, fullList);
  renderModelCandidates(filteredList, current.model);
}

function onModelCandidateChange() {
  const current = getSelectedModel();
  if (!current) return;
  const selected = String(nodes.modelCandidates.value || "").trim();
  if (!selected) return;
  if (current.model === selected) return;
  current.model = selected;
  nodes.fields.model.value = selected;
  saveState();
  renderModelList();
  renderPreview();
  renderCurrentModelCandidates();
  setStatus(`已选择模型：${selected}`);
}

function applyModelFilters(provider, models) {
  const keyword = nodes.modelSearch.value.trim().toLowerCase();
  let result = models.slice();

  if (keyword) {
    result = result.filter((item) => item.toLowerCase().includes(keyword));
  }

  if (nodes.onlyCommon.checked) {
    result = result.filter((item) => isCommonModel(provider, item));
  }

  return result;
}

function isCommonModel(provider, modelId) {
  const keywords = commonModelKeywords[provider] || commonModelKeywords.custom;
  const value = modelId.toLowerCase();
  return keywords.some((item) => value.includes(item));
}

function saveState() {
  state = normalizeState(state);
  state.updatedAt = new Date().toISOString();
  writeStateToLocal(state);
  scheduleRemoteSync();
}

function saveAndRender(message) {
  saveState();
  renderAll();
  setStatus(message);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const backupRaw = localStorage.getItem(STORAGE_BACKUP_KEY);
  const parsed = parseStateObject(raw) || parseStateObject(backupRaw);
  return normalizeState(parsed);
}

function writeStateToLocal(nextState) {
  const serialized = JSON.stringify(nextState);
  localStorage.setItem(STORAGE_KEY, serialized);
  localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
}

function scheduleRemoteSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void syncStateToServer({ silent: true });
  }, 500);
}

async function hydrateStateFromServer() {
  try {
    const response = await fetch(REMOTE_CONFIG_API, { method: "GET" });
    const payload = await parseJsonResponse(response);
    if (!response.ok) return;
    const remoteRaw = payload && typeof payload === "object" ? payload.state : null;
    if (!remoteRaw || !Array.isArray(remoteRaw.models) || !remoteRaw.models.length) {
      scheduleRemoteSync();
      return;
    }
    const remote = normalizeState(remoteRaw);
    if (!shouldUseRemoteState(state, remote)) {
      scheduleRemoteSync();
      return;
    }
    state = remote;
    selectedModelId = state.defaultModelId || state.models[0]?.id || null;
    writeStateToLocal(state);
    renderAll();
    setStatus("已从服务端同步模型配置");
    scheduleRemoteSync();
  } catch (_error) {
    // 服务端同步失败时保留本地配置
  }
}

function shouldUseRemoteState(localState, remoteState) {
  const localModels = Array.isArray(localState?.models) ? localState.models : [];
  const remoteModels = Array.isArray(remoteState?.models) ? remoteState.models : [];
  if (!remoteModels.length) return false;
  if (!localModels.length) return true;

  const localCount = localModels.length;
  const remoteCount = remoteModels.length;
  const localTs = parseTimestamp(localState?.updatedAt);
  const remoteTs = parseTimestamp(remoteState?.updatedAt);
  if (localCount <= 1 && remoteCount > 1) return true;
  if (remoteCount > localCount) return true;
  if (remoteTs > localTs) return true;
  return false;
}

function parseTimestamp(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

async function syncStateToServer(options = {}) {
  if (syncingRemote) {
    queuedRemoteSync = true;
    return;
  }
  syncingRemote = true;
  const silent = options.silent !== false;
  try {
    const response = await fetch(REMOTE_CONFIG_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      if (!silent) {
        setStatus(`服务端同步失败：${payload.error || "未知错误"}`);
      }
      return;
    }
    if (!silent) {
      setStatus("已同步到服务端");
    }
  } catch (_error) {
    if (!silent) {
      setStatus("服务端同步失败：网络异常");
    }
  } finally {
    syncingRemote = false;
    if (queuedRemoteSync) {
      queuedRemoteSync = false;
      scheduleRemoteSync();
    }
  }
}

function getSelectedModel() {
  return state.models.find((m) => m.id === selectedModelId);
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(getUnifiedConfig(), null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `openclaw-模型配置-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("已导出 JSON");
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(getUnifiedConfig(), null, 2));
    setStatus("已复制 JSON");
  } catch (_error) {
    setStatus("复制失败，请手动复制");
  }
}

function importConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const next = adaptImportedConfig(data);
      if (!next.models.length) throw new Error("empty");
      state = next;
      selectedModelId = state.defaultModelId || state.models[0].id;
      saveAndRender("导入成功");
    } catch (_error) {
      setStatus("导入失败：JSON 格式不正确");
    } finally {
      nodes.importInput.value = "";
    }
  };
  reader.readAsText(file);
}

async function discoverModels() {
  const current = getSelectedModel();
  if (!current) return;
  if (!current.baseUrl) {
    setStatus("请先填写接口地址");
    return;
  }
  if (!current.apiKey && current.provider !== "ollama") {
    setStatus("请先填写 API 密钥");
    return;
  }

  setDiscoverLoading(true);
  try {
    const response = await fetch("/api/models/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: current.provider,
        baseUrl: current.baseUrl,
        apiKey: current.apiKey
      })
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "拉取失败");
    }
    const modelList = normalizeDiscoveredModels(payload.models);
    discoveredModelMap.set(current.id, modelList);
    current.availableModels = modelList.slice();
    saveState();
    renderPreview();
    renderCurrentModelCandidates();
    if (current.model) {
      nodes.modelCandidates.value = current.model;
    }

    if (!current.model && modelList[0]) {
      nodes.fields.model.value = modelList[0];
      onFormInput();
    } else {
      setStatus(`已拉取 ${modelList.length} 个模型`);
    }
  } catch (error) {
    setStatus(`拉取失败：${error.message}`);
  } finally {
    setDiscoverLoading(false);
  }
}

async function filterAvailableModels() {
  const current = getSelectedModel();
  if (!current) return;
  if (!current.baseUrl) {
    setStatus("请先填写接口地址");
    return;
  }
  if (!current.apiKey && current.provider !== "ollama") {
    setStatus("请先填写 API 密钥");
    return;
  }

  let source = (discoveredModelMap.get(current.id) || []).slice();
  if (!source.length) {
    await discoverModels();
    source = (discoveredModelMap.get(current.id) || []).slice();
  }
  if (!source.length) {
    setStatus("没有可筛选的模型，请先拉取模型列表");
    return;
  }

  setFilterLoading(true);
  try {
    const valid = [];
    const invalid = [];
    const total = source.length;
    const workers = Math.min(4, total);
    let cursor = 0;
    let finished = 0;

    const runWorker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= total) break;
        const modelId = source[index];
        try {
          await testModelById(current, modelId);
          valid.push(modelId);
        } catch (error) {
          invalid.push({ modelId, reason: error.message });
        } finally {
          finished += 1;
          if (finished % 5 === 0 || finished === total) {
            setStatus(`筛选中：${finished}/${total}`);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: workers }, () => runWorker()));

    valid.sort((a, b) => a.localeCompare(b));
    discoveredModelMap.set(current.id, valid);
    current.availableModels = valid.slice();

    if (!valid.includes(current.model || "")) {
      current.model = valid[0] || "";
      nodes.fields.model.value = current.model;
    }
    saveState();
    renderModelList();
    renderPreview();
    renderCurrentModelCandidates();
    nodes.modelCandidates.value = current.model || "";

    if (!valid.length) {
      const firstReason = invalid[0]?.reason ? `，示例原因：${invalid[0].reason}` : "";
      setStatus(`筛选完成：0/${total} 可用${firstReason}`);
      return;
    }
    const dropped = invalid.length;
    setStatus(`筛选完成：可用 ${valid.length} 个，已剔除 ${dropped} 个`);
  } catch (error) {
    setStatus(`筛选失败：${error.message}`);
  } finally {
    setFilterLoading(false);
  }
}

async function testModelById(current, modelId) {
  const response = await fetch("/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: current.provider,
      model: modelId,
      baseUrl: current.baseUrl,
      apiKey: current.apiKey
    })
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || `模型不可用：${modelId}`);
  }
  return payload;
}

async function testModelConnection() {
  const current = getSelectedModel();
  if (!current) return;
  if (!current.model) {
    setStatus("请先填写模型 ID");
    return;
  }
  if (!current.baseUrl) {
    setStatus("请先填写接口地址");
    return;
  }
  if (!current.apiKey && current.provider !== "ollama") {
    setStatus("请先填写 API 密钥");
    return;
  }

  setTestLoading(true);
  try {
    const response = await fetch("/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: current.provider,
        model: current.model,
        baseUrl: current.baseUrl,
        apiKey: current.apiKey
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "测试失败");
    }
    const latencyMs = Number(payload.latencyMs || 0);
    const suffix = latencyMs > 0 ? `，耗时 ${latencyMs} ms` : "";
    setStatus(`连通成功：${current.model}${suffix}`);
  } catch (error) {
    setStatus(`连通失败：${error.message}`);
  } finally {
    setTestLoading(false);
  }
}

function setDiscoverLoading(loading) {
  nodes.fetchModelsBtn.disabled = loading;
  nodes.fetchModelsBtn.textContent = loading ? "拉取中..." : "拉取模型列表";
}

function setFilterLoading(loading) {
  nodes.filterModelsBtn.disabled = loading;
  nodes.filterModelsBtn.textContent = loading ? "筛选中..." : "筛选可用模型";
}

function setTestLoading(loading) {
  nodes.testModelBtn.disabled = loading;
  nodes.testModelBtn.textContent = loading ? "测试中..." : "模型连通性测试";
}

function normalizeDiscoveredModels(input) {
  const items = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    let value = "";
    if (typeof item === "string") {
      value = item.trim();
    } else if (item && typeof item === "object") {
      value = String(item.id || item.model || item.name || "").trim();
    }
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function parseStateObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const modelsSource = Array.isArray(source.models) ? source.models : [];
  const usedIds = new Set();
  const models = modelsSource
    .map((item) => normalizeModel(item, usedIds))
    .filter((item) => !!item);

  if (!models.length) {
    const sample = modelTemplate();
    sample.name = "默认模型";
    models.push(sample);
    usedIds.add(sample.id);
  }

  const defaultModelId = models.some((item) => item.id === source.defaultModelId)
    ? source.defaultModelId
    : models[0].id;

  return {
    version: Number.isFinite(source.version) ? source.version : 1,
    updatedAt: String(source.updatedAt || ""),
    defaultModelId,
    models
  };
}

function normalizeModel(input, usedIds) {
  if (!input || typeof input !== "object") return null;
  let id = String(input.id || "").trim() || makeId();
  while (usedIds.has(id)) {
    id = makeId();
  }
  usedIds.add(id);

  const provider = providerPresets[input.provider] ? input.provider : "custom";
  const model = String(input.model || "").trim();
  const api = input.api && typeof input.api === "object" ? input.api : {};
  const params = input.params && typeof input.params === "object" ? input.params : {};
  const baseUrl = String(input.baseUrl || api.baseUrl || "").trim() || providerPresets[provider]?.baseUrl || "";

  return {
    id,
    name: String(input.name || "").trim() || model || "未命名模型",
    provider,
    model,
    baseUrl,
    apiKey: String(input.apiKey || api.apiKey || ""),
    temperature: parseFloatOrDefault(input.temperature ?? params.temperature, 0.7),
    maxTokens: parseIntOrDefault(input.maxTokens ?? params.maxTokens, 1024),
    topP: parseFloatOrDefault(input.topP ?? params.topP, 1),
    enabled: input.enabled !== false,
    availableModels: normalizeDiscoveredModels(input.availableModels)
  };
}

async function parseJsonResponse(response) {
  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = `/login.html?next=${encodeURIComponent(next)}`;
    throw new Error("未登录：已跳转到登录页");
  }
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    const snippet = String(raw || "").slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
      `服务返回了非 JSON 响应（HTTP ${response.status}）。` +
        (snippet ? `返回片段：${snippet}` : "请确认本地服务已重启并使用最新代码。")
    );
  }
}

function adaptImportedConfig(data) {
  if (Array.isArray(data.models) && data.models[0]?.api && data.models[0]?.params) {
    return {
      version: data.version || 1,
      updatedAt: new Date().toISOString(),
      defaultModelId: data.defaultModelId || data.models[0].id,
      models: data.models.map((m) => ({
        id: m.id || makeId(),
        name: m.name || "导入模型",
        provider: m.provider || "custom",
        model: m.model || "",
        baseUrl: m.api?.baseUrl || "",
        apiKey: m.api?.apiKey || "",
        temperature: parseFloatOrDefault(m.params?.temperature, 0.7),
        maxTokens: parseIntOrDefault(m.params?.maxTokens, 1024),
        topP: parseFloatOrDefault(m.params?.topP, 1),
        enabled: m.enabled !== false,
        availableModels: normalizeDiscoveredModels(m.availableModels)
      }))
    };
  }

  if (Array.isArray(data.models)) {
    return {
      version: data.version || 1,
      updatedAt: new Date().toISOString(),
      defaultModelId: data.defaultModelId || data.models[0].id || makeId(),
      models: data.models.map((m) => ({
        id: m.id || makeId(),
        name: m.name || "导入模型",
        provider: m.provider || "custom",
        model: m.model || "",
        baseUrl: m.baseUrl || "",
        apiKey: m.apiKey || "",
        temperature: parseFloatOrDefault(m.temperature, 0.7),
        maxTokens: parseIntOrDefault(m.maxTokens, 1024),
        topP: parseFloatOrDefault(m.topP, 1),
        enabled: m.enabled !== false,
        availableModels: normalizeDiscoveredModels(m.availableModels)
      }))
    };
  }

  throw new Error("unsupported");
}

function setStatus(text) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  nodes.saveStatus.textContent = `状态：${text} (${hh}:${mm}:${ss})`;
}

function toDisplayNumber(value) {
  return Number.isFinite(value) ? String(value) : "";
}

function parseFloatOrDefault(value, fallback) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntOrDefault(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
