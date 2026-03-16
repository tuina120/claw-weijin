const STORAGE_KEY = "openclaw_web_terminal_v1";

const nodes = {
  reloadBtn: document.getElementById("term-reload-btn"),
  cwd: document.getElementById("term-cwd"),
  tokenWrap: document.getElementById("term-token-wrap"),
  token: document.getElementById("term-token"),
  allowed: document.getElementById("term-allowed"),
  output: document.getElementById("term-output"),
  command: document.getElementById("term-command"),
  runBtn: document.getElementById("term-run-btn"),
  clearBtn: document.getElementById("term-clear-btn"),
  status: document.getElementById("term-status")
};

let info = null;
let history = [];
let running = false;

init();

function init() {
  restoreState();
  wireEvents();
  void loadInfo();
  renderOutput();
}

function wireEvents() {
  nodes.reloadBtn.addEventListener("click", () => void loadInfo(true));
  nodes.runBtn.addEventListener("click", () => void runCommand());
  nodes.clearBtn.addEventListener("click", () => {
    history = [];
    saveState();
    renderOutput();
    setStatus("状态：已清空输出");
  });
  nodes.command.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runCommand();
    }
  });
  nodes.cwd.addEventListener("change", saveState);
  nodes.token.addEventListener("input", saveState);
  document.querySelectorAll(".quick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = String(btn.dataset.cmd || "").trim();
      if (!cmd) return;
      nodes.command.value = cmd;
      void runCommand();
    });
  });
}

async function loadInfo(isManual = false) {
  try {
    const response = await fetch("/api/terminal/info");
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `读取失败（HTTP ${response.status}）`);
    info = payload;
    renderInfo();
    if (isManual) setStatus("状态：已刷新信息");
  } catch (error) {
    setStatus(`状态：信息读取失败：${error.message}`);
  }
}

function renderInfo() {
  const required = !!info?.tokenRequired;
  nodes.tokenWrap.classList.toggle("hidden", !required);
  const selected = String(nodes.cwd.value || loadState().cwd || "").trim();
  const defaultCwd = String(info?.defaultCwd || "").trim();
  nodes.cwd.value = selected || defaultCwd || "";

  const allowedCommands = Array.isArray(info?.allowedCommands) ? info.allowedCommands : [];
  nodes.allowed.textContent = allowedCommands.join("\n");
  saveState();
}

async function runCommand() {
  if (running) return;
  const command = nodes.command.value.trim();
  if (!command) return;
  const cwd = String(nodes.cwd.value || "").trim();

  setRunning(true);
  const token = String(nodes.token.value || "").trim();
  const entry = {
    ts: new Date().toISOString(),
    cwd,
    command,
    ok: false,
    exitCode: null,
    durationMs: 0,
    stdout: "",
    stderr: ""
  };
  history.push(entry);
  nodes.command.value = "";
  saveState();
  renderOutput();

  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Terminal-Token"] = token;
    const response = await fetch("/api/terminal/run", {
      method: "POST",
      headers,
      body: JSON.stringify({ cwd, command })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `执行失败（HTTP ${response.status}）`);
    entry.ok = !!payload.ok;
    entry.exitCode = payload.exitCode;
    entry.durationMs = payload.durationMs || 0;
    entry.stdout = String(payload.stdout || "");
    entry.stderr = String(payload.stderr || "");
    saveState();
    renderOutput();
    setStatus(`状态：执行完成（exit=${entry.exitCode ?? "?"}，${entry.durationMs}ms）`);
  } catch (error) {
    entry.ok = false;
    entry.stderr = `请求失败：${error.message}`;
    saveState();
    renderOutput();
    setStatus("状态：执行失败");
  } finally {
    setRunning(false);
  }
}

function renderOutput() {
  nodes.output.innerHTML = "";
  const list = Array.isArray(history) ? history : [];
  if (!list.length) {
    nodes.output.textContent = "暂无输出。";
    return;
  }
  list.slice(-120).forEach((item) => {
    const block = document.createElement("div");
    block.className = "term-line";
    const prompt = document.createElement("div");
    prompt.className = "term-prompt";
    prompt.textContent = `$ ${item.command}`;
    const meta = document.createElement("div");
    meta.className = "term-meta";
    meta.textContent = `${item.cwd || ""}  exit=${item.exitCode ?? "?"}  ${item.durationMs || 0}ms`;
    const out = document.createElement("div");
    out.textContent = String(item.stdout || "");
    const err = document.createElement("div");
    err.className = item.stderr ? "term-err" : "";
    err.textContent = String(item.stderr || "");
    block.appendChild(prompt);
    block.appendChild(meta);
    if (item.stdout) block.appendChild(out);
    if (item.stderr) block.appendChild(err);
    nodes.output.appendChild(block);
  });
  nodes.output.scrollTop = nodes.output.scrollHeight;
}

function setRunning(value) {
  running = value;
  nodes.runBtn.disabled = value;
  nodes.runBtn.textContent = value ? "执行中..." : "执行";
}

function setStatus(text) {
  nodes.status.textContent = String(text || "");
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (_error) {
    return {};
  }
}

function restoreState() {
  const state = loadState();
  history = Array.isArray(state.history) ? state.history : [];
  nodes.token.value = String(state.token || "");
  if (state.cwd) nodes.cwd.value = String(state.cwd || "");
}

function saveState() {
  const payload = {
    token: String(nodes.token.value || ""),
    cwd: String(nodes.cwd.value || ""),
    history
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
