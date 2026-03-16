const nodes = {
  status: document.getElementById("status"),
  btnLogin: document.getElementById("btn-login"),
  btnDevice: document.getElementById("btn-device"),
  btnLogout: document.getElementById("btn-logout"),
  help: document.getElementById("help"),
  helpCode: document.getElementById("help-code"),
  deviceBox: document.getElementById("device-box"),
  deviceQrImg: document.getElementById("device-qr-img"),
  deviceCode: document.getElementById("device-code"),
  deviceLink: document.getElementById("device-link"),
  deviceCancel: document.getElementById("device-cancel"),
  deviceStatus: document.getElementById("device-status")
};

init();

async function init() {
  const next = getNextPath();
  nodes.btnLogin.addEventListener("click", () => {
    window.location.href = `/auth/start?next=${encodeURIComponent(next)}`;
  });
  nodes.btnDevice.addEventListener("click", () => startDeviceLogin(next));

  const adminMode = isAdminMode();
  if (nodes.help) nodes.help.hidden = !adminMode;
  if (adminMode && nodes.helpCode) nodes.helpCode.textContent = buildEnvTemplate();

  try {
    const info = await apiGet("/api/auth/info");
    renderInfo(info, { adminMode });
  } catch (error) {
    nodes.status.textContent = `检查失败：${error.message}`;
  }
}

function renderInfo(info, options) {
  const opts = options && typeof options === "object" ? options : {};
  const adminMode = !!opts.adminMode;
  const configured = !!info.configured;
  const requireLogin = !!info.requireLogin;
  const requireMfa = !!info.requireMfa;
  const user = info.user || null;
  const allowlistEnabled = !!info.allowlist?.enabled;

  if (user) {
    const who = user.name || user.username || user.oid || "已登录";
    nodes.status.textContent = `已登录：${who} ｜ 登录已启用：${requireLogin ? "是" : "否"} ｜ MFA：${requireMfa ? "要求" : "不要求"}`;
    nodes.btnLogout.style.display = "inline-flex";
    nodes.btnLogin.textContent = "继续登录（切换账号）";
    nodes.btnDevice.style.display = "none";
    if (nodes.help) nodes.help.open = false;
    return;
  }

  nodes.btnLogout.style.display = "none";
  nodes.btnDevice.style.display = "inline-flex";

  const qs = new URLSearchParams(window.location.search);
  const err = qs.get("err");
  const errText = err ? `（错误：${err}）` : "";

  if (!configured) {
    nodes.status.textContent = `管理员尚未配置微软登录 ${errText}`.trim();
    if (nodes.help) nodes.help.open = adminMode;
    return;
  }

  const allowHint = allowlistEnabled ? "（已启用白名单）" : "";
  nodes.status.textContent = `未登录：请使用微软账号登录 ${errText}${requireMfa ? "（要求 MFA）" : ""}${allowHint}`.trim();
  if (nodes.help) nodes.help.open = false;
}

let deviceTimer = null;
let deviceActiveId = null;

async function startDeviceLogin(next) {
  stopDeviceLogin();
  nodes.deviceBox.hidden = false;
  nodes.deviceStatus.textContent = "正在生成二维码...";
  nodes.deviceCode.textContent = "-";
  nodes.deviceLink.href = "#";
  nodes.deviceQrImg.removeAttribute("src");

  try {
    const data = await apiPost("/api/auth/device/start", { next });
    deviceActiveId = data.id;

    const verifyUrl = data.verification_uri_complete || data.verification_uri;
    nodes.deviceCode.textContent = String(data.user_code || "-");
    nodes.deviceLink.href = verifyUrl;
    nodes.deviceQrImg.src = `/api/auth/qr.svg?text=${encodeURIComponent(verifyUrl)}`;
    nodes.deviceStatus.textContent = "等待扫码并完成微软登录...";

    const intervalMs = Math.max(1000, Number(data.interval || 5) * 1000);
    nodes.deviceCancel.onclick = () => stopDeviceLogin();
    deviceTimer = window.setInterval(() => pollDeviceLogin(), intervalMs);
    // 先立刻 poll 一次，避免 interval 太长时用户以为没动静
    window.setTimeout(() => pollDeviceLogin(), 600);
  } catch (error) {
    nodes.deviceStatus.textContent = `生成失败：${error.message}`;
  }
}

async function pollDeviceLogin() {
  if (!deviceActiveId) return;
  try {
    const data = await apiPost("/api/auth/device/poll", { id: deviceActiveId });
    if (data.status === "pending") {
      return;
    }
    if (data.status === "ok") {
      nodes.deviceStatus.textContent = "登录成功，正在跳转...";
      stopDeviceLogin({ keepBox: true });
      const next = String(data.next || "/chat.html");
      window.location.href = next;
    }
  } catch (error) {
    nodes.deviceStatus.textContent = `登录失败：${error.message}`;
    stopDeviceLogin({ keepBox: true, keepId: false });
  }
}

function stopDeviceLogin(options) {
  const opts = options && typeof options === "object" ? options : {};
  if (deviceTimer) {
    window.clearInterval(deviceTimer);
    deviceTimer = null;
  }
  if (!opts.keepId) deviceActiveId = null;
  if (!opts.keepBox) nodes.deviceBox.hidden = true;
}

function getNextPath() {
  const qs = new URLSearchParams(window.location.search);
  const next = String(qs.get("next") || "/chat.html");
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/chat.html";
}

function buildEnvTemplate() {
  const origin = window.location.origin;
  return [
    "MS_TENANT_ID=你的TenantId或common",
    "MS_CLIENT_ID=你的ClientId",
    "MS_CLIENT_SECRET=你的ClientSecret",
    `MS_REDIRECT_URI=${origin}/auth/callback`,
    "",
    "# 可选：强制要求登录（默认：配置齐全时自动开启）",
    "OPENCLAW_REQUIRE_LOGIN=1",
    "",
    "# 可选：要求 MFA（由微软登录页触发，比如 Microsoft Authenticator 动态码/推送）",
    "OPENCLAW_REQUIRE_MFA=1",
    "",
    "# 可选：白名单（只允许指定的人登录）",
    "# OPENCLAW_ALLOWED_EMAILS=user1@company.com,user2@company.com",
    "# OPENCLAW_ALLOWED_DOMAINS=company.com",
    "# OPENCLAW_ALLOWED_TENANTS=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "# OPENCLAW_ALLOWED_OIDS=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  ].join("\n");
}

function isAdminMode() {
  const qs = new URLSearchParams(window.location.search);
  return qs.get("admin") === "1";
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
