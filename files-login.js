const nodes = {
  status: document.getElementById("status"),
  loginBox: document.getElementById("files-login-box"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  loginBtn: document.getElementById("login-btn"),
  setupBox: document.getElementById("files-setup-box"),
  setupEmail: document.getElementById("setup-email"),
  setupPassword: document.getElementById("setup-password"),
  setupPasswordConfirm: document.getElementById("setup-password-confirm"),
  setupBtn: document.getElementById("setup-btn"),
  authedBox: document.getElementById("files-authed-box"),
  authedText: document.getElementById("authed-text"),
  continueBtn: document.getElementById("continue-btn"),
  logoutBtn: document.getElementById("logout-btn")
};

init();

async function init() {
  nodes.loginBtn.addEventListener("click", () => void loginFileManager());
  nodes.setupBtn.addEventListener("click", () => void setupFileManagerUser());
  nodes.continueBtn.addEventListener("click", () => {
    window.location.href = getNextPath();
  });
  nodes.logoutBtn.addEventListener("click", () => void logoutFileManager());

  [nodes.loginEmail, nodes.loginPassword].forEach((node) => {
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void loginFileManager();
      }
    });
  });
  [nodes.setupEmail, nodes.setupPassword, nodes.setupPasswordConfirm].forEach((node) => {
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void setupFileManagerUser();
      }
    });
  });

  await refreshInfo();
}

async function refreshInfo() {
  try {
    const info = await requestJson("/api/files/auth/info");
    renderInfo(info);
  } catch (error) {
    setStatus(`检查失败：${error.message}`, true);
  }
}

function renderInfo(info) {
  const configured = !!info.configured;
  const user = info.user || null;
  nodes.loginBox.hidden = true;
  nodes.setupBox.hidden = true;
  nodes.authedBox.hidden = true;

  if (user) {
    nodes.authedBox.hidden = false;
    nodes.authedText.textContent = `当前已登录：${user.email || user.name || "文件管理员"}（${user.role || "files-admin"}）`;
    setStatus("文件管理独立登录已生效");
    return;
  }

  if (!configured) {
    nodes.setupBox.hidden = false;
    setStatus("文件管理尚未初始化，请先创建第一个邮件+密码账号");
    return;
  }

  nodes.loginBox.hidden = false;
  setStatus("请输入文件管理邮箱和密码");
}

async function loginFileManager() {
  const email = String(nodes.loginEmail.value || "").trim();
  const password = String(nodes.loginPassword.value || "");
  if (!email) return setStatus("请输入邮箱", true);
  if (!password) return setStatus("请输入密码", true);
  setStatus("正在登录文件管理...");
  try {
    const data = await requestJson("/api/files/auth/login", {
      method: "POST",
      body: {
        email,
        password,
        next: getNextPath()
      }
    });
    setStatus("登录成功，正在进入文件页...");
    window.location.href = String(data.next || getNextPath());
  } catch (error) {
    setStatus(error.message || "文件管理登录失败", true);
  }
}

async function setupFileManagerUser() {
  const email = String(nodes.setupEmail.value || "").trim();
  const password = String(nodes.setupPassword.value || "");
  const confirmPassword = String(nodes.setupPasswordConfirm.value || "");
  if (!email) return setStatus("请输入初始化邮箱", true);
  if (!password) return setStatus("请输入初始化密码", true);
  if (password !== confirmPassword) return setStatus("两次输入的密码不一致", true);
  setStatus("正在创建文件管理账号...");
  try {
    const data = await requestJson("/api/files/auth/setup", {
      method: "POST",
      body: {
        email,
        password,
        next: getNextPath()
      }
    });
    setStatus("初始化成功，正在进入文件页...");
    window.location.href = String(data.next || getNextPath());
  } catch (error) {
    setStatus(error.message || "文件管理初始化失败", true);
  }
}

async function logoutFileManager() {
  setStatus("正在退出文件管理登录...");
  try {
    await requestJson("/api/files/auth/logout", { method: "POST", body: {} });
    window.location.href = `/files-login.html?next=${encodeURIComponent(getNextPath())}&logged_out=1`;
  } catch (error) {
    setStatus(error.message || "退出失败", true);
  }
}

function getNextPath() {
  const qs = new URLSearchParams(window.location.search);
  const next = String(qs.get("next") || "/files.html");
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/files.html";
}

function setStatus(text, isError = false) {
  nodes.status.textContent = String(text || "");
  nodes.status.style.color = isError ? "var(--bad)" : "";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
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
