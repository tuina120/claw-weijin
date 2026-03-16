const STORAGE_KEY = "openclaw_guest_v1";

const nodes = {
  status: document.getElementById("status"),
  provider: document.getElementById("provider"),
  model: document.getElementById("model"),
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  sendBtn: document.getElementById("send-btn"),
  chatStatus: document.getElementById("chat-status"),
  logoutBtn: document.getElementById("logout-btn")
};

let history = [];
let sending = false;

init();

async function init() {
  restoreState();
  wireEvents();
  renderMessages();

  const invite = getInviteFromUrl();
  try {
    const info = await apiGet("/api/guest/info");
    if (!info.enabled) {
      setStatus("访客体验未开启：请联系管理员");
      disableChat();
      return;
    }
    if (invite) {
      await apiPost("/api/guest/verify", { invite });
      // 清理 URL 上的 invite，避免复制分享时泄露
      clearInviteFromUrl();
    }
    setStatus("访客模式已就绪：请先填写你自己的模型 Key，然后开始聊天");
  } catch (error) {
    setStatus(`验证失败：${error.message}`);
    disableChat();
  }
}

function wireEvents() {
  nodes.sendBtn.addEventListener("click", sendMessage);
  nodes.input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  });
  ["provider", "model", "baseUrl", "apiKey"].forEach((id) => {
    nodes[id].addEventListener("input", persistState);
    nodes[id].addEventListener("change", persistState);
  });
  nodes.logoutBtn.addEventListener("click", async () => {
    try {
      await apiPost("/api/guest/logout", {});
    } catch (_error) {}
    history = [];
    persistState();
    window.location.reload();
  });
}

function getInviteFromUrl() {
  const qs = new URLSearchParams(window.location.search);
  const invite = String(qs.get("invite") || "").trim();
  return invite || "";
}

function clearInviteFromUrl() {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("invite");
    window.history.replaceState({}, "", u.toString());
  } catch (_error) {}
}

function disableChat() {
  nodes.sendBtn.disabled = true;
  nodes.input.disabled = true;
  nodes.provider.disabled = true;
  nodes.model.disabled = true;
  nodes.baseUrl.disabled = true;
  nodes.apiKey.disabled = true;
}

function setStatus(text) {
  nodes.status.textContent = String(text || "");
}

function setChatStatus(text) {
  nodes.chatStatus.textContent = String(text || "");
}

function persistState() {
  const payload = {
    cfg: {
      provider: String(nodes.provider.value || "openai"),
      model: String(nodes.model.value || ""),
      baseUrl: String(nodes.baseUrl.value || ""),
      apiKey: String(nodes.apiKey.value || "")
    },
    history
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const cfg = parsed.cfg || {};
    nodes.provider.value = String(cfg.provider || "openai");
    nodes.model.value = String(cfg.model || "");
    nodes.baseUrl.value = String(cfg.baseUrl || "");
    nodes.apiKey.value = String(cfg.apiKey || "");
    history = Array.isArray(parsed.history) ? parsed.history : [];
  } catch (_error) {}
}

function renderMessages() {
  nodes.messages.innerHTML = "";
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "msg assistant";
    empty.innerHTML = '<div class="role">助手</div><div class="text">你可以在上面填写自己的模型 Key，然后开始体验。</div>';
    nodes.messages.appendChild(empty);
    return;
  }
  history.forEach((m) => {
    const row = document.createElement("div");
    row.className = `msg ${m.role}${m.error ? " error" : ""}`;
    const role = document.createElement("div");
    role.className = "role";
    role.textContent = m.role === "user" ? "你" : "助手";
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = String(m.content || "");
    row.appendChild(role);
    row.appendChild(text);
    nodes.messages.appendChild(row);
  });
  nodes.messages.scrollTop = nodes.messages.scrollHeight;
}

function collectCfg() {
  return {
    provider: String(nodes.provider.value || "openai").trim(),
    model: String(nodes.model.value || "").trim(),
    baseUrl: String(nodes.baseUrl.value || "").trim(),
    apiKey: String(nodes.apiKey.value || "").trim()
  };
}

async function sendMessage() {
  if (sending) return;
  const text = String(nodes.input.value || "").trim();
  if (!text) return;

  const cfg = collectCfg();
  if (!cfg.model) {
    setChatStatus("请先填写模型 ID");
    return;
  }
  if (!cfg.baseUrl) {
    setChatStatus("请先填写 baseUrl");
    return;
  }
  if (!cfg.apiKey) {
    setChatStatus("请先填写 API Key");
    return;
  }

  history.push({ role: "user", content: text });
  nodes.input.value = "";
  renderMessages();
  persistState();

  sending = true;
  nodes.sendBtn.disabled = true;
  setChatStatus("发送中...");
  try {
    const response = await apiPost("/api/chat/guest", {
      ...cfg,
      messages: history.map((m) => ({ role: m.role, content: m.content }))
    });
    const assistantText = String(response.message || "").trim();
    history.push({ role: "assistant", content: assistantText || "（空回复）" });
    renderMessages();
    persistState();
    setChatStatus("就绪");
  } catch (error) {
    history.push({ role: "assistant", content: `请求失败：${error.message}`, error: true });
    renderMessages();
    persistState();
    setChatStatus("失败");
  } finally {
    sending = false;
    nodes.sendBtn.disabled = false;
  }
}

async function apiGet(url) {
  const response = await fetch(url);
  return parseResponse(response);
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  return parseResponse(response);
}

async function parseResponse(response) {
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

