const nodes = {
  status: document.getElementById("status"),
  inviteBtn: document.getElementById("invite-btn"),
  copyBtn: document.getElementById("copy-btn"),
  qrBtn: document.getElementById("qr-btn"),
  inviteUrl: document.getElementById("invite-url"),
  inviteMeta: document.getElementById("invite-meta"),
  qrBox: document.getElementById("qr-box"),
  qrImg: document.getElementById("qr-img"),
  cfSnippet: document.getElementById("cf-snippet")
};

let lastUrl = "";

init();

async function init() {
  nodes.inviteBtn.addEventListener("click", generateInvite);
  nodes.copyBtn.addEventListener("click", copyInvite);
  nodes.qrBtn.addEventListener("click", toggleQr);

  renderCloudflareSnippet();

  try {
    const info = await apiGet("/api/guest/info");
    if (!info.enabled) {
      nodes.status.textContent = "状态：访客体验未开启（请设置 OPENCLAW_GUEST_ENABLED=1 并重启服务）";
    } else {
      nodes.status.textContent = `状态：访客体验已开启（有效期 ${Math.round((info.inviteTtlMs || 0) / 60000)} 分钟，每分钟限流 ${info.rpm} 次，验证限流 ${info.verifyRpm} 次）`;
    }
  } catch (error) {
    nodes.status.textContent = `状态：读取失败：${error.message}`;
  }
}

async function generateInvite() {
  nodes.inviteBtn.disabled = true;
  nodes.copyBtn.disabled = true;
  nodes.qrBtn.disabled = true;
  nodes.inviteMeta.textContent = "";
  nodes.qrBox.hidden = true;
  try {
    const data = await apiPost("/api/guest/invite", {});
    lastUrl = String(data.url || "").trim();
    nodes.inviteUrl.value = lastUrl;
    const expiresAt = data.expiresAt ? new Date(Number(data.expiresAt)) : null;
    const expireText = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toLocaleString() : "-";
    nodes.inviteMeta.textContent = `一次性链接｜过期时间：${expireText}`;
    nodes.copyBtn.disabled = !lastUrl;
    nodes.qrBtn.disabled = !lastUrl;
    nodes.status.textContent = "状态：已生成体验链接（用一次即失效）";
  } catch (error) {
    nodes.status.textContent = `状态：生成失败：${error.message}`;
  } finally {
    nodes.inviteBtn.disabled = false;
  }
}

async function copyInvite() {
  if (!lastUrl) return;
  const ok = await copyToClipboard(lastUrl);
  nodes.status.textContent = ok ? "状态：已复制到剪贴板" : "状态：复制失败，请手动复制";
}

function toggleQr() {
  if (!lastUrl) return;
  const shown = !nodes.qrBox.hidden;
  if (shown) {
    nodes.qrBox.hidden = true;
    return;
  }
  nodes.qrImg.src = `/api/auth/qr.svg?text=${encodeURIComponent(lastUrl)}`;
  nodes.qrBox.hidden = false;
}

function renderCloudflareSnippet() {
  const host = String(window.location.host || "claw.qxyx.net");
  const origin = window.location.origin;
  nodes.cfSnippet.textContent = [
    "# 目标：用 Cloudflare Tunnel 把家里机器的 4173 暴露为 HTTPS 域名，并用 Access 控制登录",
    "",
    "# 建议：OpenClaw 只监听本机（更安全）",
    "HOST=127.0.0.1",
    "",
    "# Cloudflare Access 建议做 2 个 Application：",
    `# 1) 主站（需登录）：https://${host}  只允许你的邮箱`,
    `# 2) 访客入口（不需登录）：https://${host}/guest* 设为 Bypass，让体验码接管`,
    "",
    `# 访客链接默认会用当前 origin 生成：${origin}`,
    "# 如果你想把访客放到单独域名（更干净），在服务端设置：",
    "# OPENCLAW_GUEST_PUBLIC_ORIGIN=https://guest.qxyx.net"
  ].join("\n");
}

async function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_error) {}

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
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
