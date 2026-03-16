const nodes = {
  refreshBtn: document.getElementById("refresh-btn"),
  repairBtn: document.getElementById("repair-btn"),
  restartBtn: document.getElementById("restart-btn"),
  copyBtn: document.getElementById("copy-btn"),
  status: document.getElementById("status"),
  summaryBadge: document.getElementById("summary-badge"),
  summaryText: document.getElementById("summary-text"),
  directStatus: document.getElementById("direct-status"),
  directDetail: document.getElementById("direct-detail"),
  timerStatus: document.getElementById("timer-status"),
  timerDetail: document.getElementById("timer-detail"),
  serviceStatus: document.getElementById("service-status"),
  serviceDetail: document.getElementById("service-detail"),
  directKv: document.getElementById("direct-kv"),
  systemdList: document.getElementById("systemd-list"),
  overrideKv: document.getElementById("override-kv"),
  connectionsList: document.getElementById("connections-list"),
  logOutput: document.getElementById("log-output"),
  rawOutput: document.getElementById("raw-output")
};

let latestSnapshot = null;
let latestCopyText = "";

init();

function init() {
  nodes.refreshBtn.addEventListener("click", () => void loadGuardStatus());
  nodes.repairBtn.addEventListener("click", () => void runRepair());
  nodes.restartBtn.addEventListener("click", () => void restartTunnels());
  nodes.copyBtn.addEventListener("click", () => void copyResult());
  void loadGuardStatus();
}

async function loadGuardStatus() {
  setStatus("正在读取 cloudflared 巡检状态...");
  try {
    const data = await apiGet("/api/cloudflared/guard");
    latestSnapshot = data;
    renderSnapshot(data);
    latestCopyText = buildCopyText(data);
    setStatus(`读取完成：${data?.summary?.label || "已完成"}`);
  } catch (error) {
    latestSnapshot = null;
    latestCopyText = "";
    nodes.summaryBadge.className = "summary-badge danger";
    nodes.summaryBadge.textContent = "读取失败";
    nodes.summaryText.textContent = error.message || "读取状态失败";
    nodes.rawOutput.textContent = String(error.stack || error.message || error);
    nodes.logOutput.textContent = "";
    nodes.directKv.innerHTML = "";
    nodes.overrideKv.innerHTML = "";
    nodes.connectionsList.innerHTML = "";
    nodes.systemdList.innerHTML = "";
    setStatus(error.message || "读取失败", true);
  }
}

async function runRepair() {
  nodes.repairBtn.disabled = true;
  setStatus("正在执行 cloudflared 修复脚本...");
  try {
    const data = await apiPost("/api/cloudflared/guard", { action: "run_fix" });
    latestSnapshot = data.snapshot || null;
    if (latestSnapshot) {
      renderSnapshot(latestSnapshot);
      latestCopyText = buildCopyText(latestSnapshot);
    }
    const stdout = String(data?.execution?.stdout || "").trim();
    const stderr = String(data?.execution?.stderr || "").trim();
    const extra = stderr || stdout || "已执行完成";
    setStatus(`修复完成：${extra}`);
  } catch (error) {
    setStatus(error.message || "修复失败", true);
  } finally {
    nodes.repairBtn.disabled = false;
  }
}

async function restartTunnels() {
  nodes.restartBtn.disabled = true;
  setStatus("正在重启 cloudflared 隧道...");
  try {
    const data = await apiPost("/api/cloudflared/guard", { action: "restart_tunnels" });
    latestSnapshot = data.snapshot || null;
    if (latestSnapshot) {
      renderSnapshot(latestSnapshot);
      latestCopyText = buildCopyText(latestSnapshot);
    }
    const stdout = String(data?.execution?.stdout || "").trim();
    const stderr = String(data?.execution?.stderr || "").trim();
    const extra = stderr || stdout || "隧道已重启";
    setStatus(`重启完成：${extra}`);
  } catch (error) {
    setStatus(error.message || "重启失败", true);
  } finally {
    nodes.restartBtn.disabled = false;
  }
}

function renderSnapshot(data) {
  const summary = data?.summary || {};
  const mihomo = data?.mihomo || {};
  const services = Array.isArray(data?.services) ? data.services : [];
  const guardTimer = data?.guard?.timer || {};
  const guardService = data?.guard?.service || {};
  const override = data?.override || {};
  const log = data?.log || {};

  nodes.summaryBadge.className = `summary-badge ${summary.tone || "warn"}`;
  nodes.summaryBadge.textContent = summary.label || "待确认";
  nodes.summaryText.textContent = summary.detail || "";

  nodes.directStatus.textContent = mihomo.hasCloudflaredConnections ? (mihomo.allDirect ? "全部 DIRECT" : "存在非 DIRECT") : "暂无连接";
  nodes.directDetail.textContent = mihomo.hasCloudflaredConnections
    ? `共 ${mihomo.count || 0} 条 cloudflared 连接，socket：${mihomo.socketPath || "-"}`
    : mihomo.message || "当前没有抓到 cloudflared 连接";

  nodes.timerStatus.textContent = guardTimer.active ? "正常运行" : "未运行";
  nodes.timerDetail.textContent = buildTimerDetail(guardTimer, guardService);

  const activeCount = services.filter((item) => item.active).length;
  nodes.serviceStatus.textContent = `${activeCount}/${services.length || 0} 在线`;
  nodes.serviceDetail.textContent = services.length
    ? services.map((item) => `${item.unit}: ${item.activeState || "unknown"}`).join(" ｜ ")
    : "暂无服务信息";

  renderKv(nodes.directKv, [
    ["Mihomo socket", mihomo.socketPath || "-"],
    ["cloudflared 连接数", String(mihomo.count || 0)],
    ["全部 DIRECT", formatBool(mihomo.allDirect)],
    ["读取结果", mihomo.message || (mihomo.available ? "正常" : "不可用")]
  ]);

  renderConnections(mihomo.connections || []);
  renderSystemd(services, guardService, guardTimer);
  renderKv(nodes.overrideKv, [
    ["override 文件", buildPathState(override.overrideFilePath, override.overrideFileExists, override.overrideRulesReady)],
    ["override 注册", buildPathState(override.registryPath, override.registryExists, override.registered)],
    ["当前 profile", `${override.currentProfileId || "-"}${override.profileBound ? "（已绑定）" : "（未绑定）"}`],
    ["work 配置规则", buildPathState(override.workConfigPath, true, override.workRulesPresent)]
  ]);

  nodes.logOutput.textContent = Array.isArray(log.lines) && log.lines.length ? log.lines.join("\n") : "暂无日志";
  nodes.rawOutput.textContent = JSON.stringify(data, null, 2);
}

function renderConnections(list) {
  if (!Array.isArray(list) || !list.length) {
    nodes.connectionsList.innerHTML = '<div class="muted-text">当前没有可展示的 cloudflared 连接。</div>';
    return;
  }
  nodes.connectionsList.innerHTML = list
    .map((item) => {
      const tone = Array.isArray(item.chains) && item.chains.includes("DIRECT") ? "good" : "danger";
      return `
        <article class="connection-item">
          <div class="item-head">
            <div class="item-title">${escapeHtml(item.destination || item.id || "未命名连接")}</div>
            <span class="pill ${tone}">${escapeHtml((item.chains || []).join(" / ") || "无链路")}</span>
          </div>
          <div class="item-meta">
            <span class="pill neutral">规则：${escapeHtml(item.rule || "-")}</span>
            <span class="pill neutral">命中：${escapeHtml(item.rulePayload || "-")}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSystemd(services, guardService, guardTimer) {
  const items = [...services, guardService, guardTimer].filter(Boolean);
  nodes.systemdList.innerHTML = items
    .map((item) => {
      const tone = item.healthy ? "good" : item.unit && item.unit.endsWith(".timer") ? "warn" : "danger";
      const timeText = [item.lastRunAt ? `上次：${item.lastRunAt}` : "", item.nextRunAt ? `下次：${item.nextRunAt}` : ""]
        .filter(Boolean)
        .join(" ｜ ");
      return `
        <article class="service-item">
          <div class="item-head">
            <div class="item-title">${escapeHtml(item.unit || "未知服务")}</div>
            <span class="pill ${tone}">${escapeHtml(item.healthLabel || item.activeState || "unknown")}</span>
          </div>
          <div class="item-detail">${escapeHtml(item.description || item.statusText || item.error || "无额外说明")}</div>
          <div class="item-meta">
            <span class="pill neutral">启用：${escapeHtml(item.unitFileState || "-")}</span>
            ${timeText ? `<span class="pill neutral">${escapeHtml(timeText)}</span>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderKv(root, rows) {
  root.innerHTML = "";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    root.appendChild(dt);
    root.appendChild(dd);
  });
}

function buildTimerDetail(timer, service) {
  const parts = [];
  if (timer.lastRunAt) parts.push(`上次 ${timer.lastRunAt}`);
  if (timer.nextRunAt) parts.push(`下次 ${timer.nextRunAt}`);
  if (service.activeState) parts.push(`guard service：${service.activeState}`);
  return parts.join(" ｜ ") || "等待读取";
}

function buildPathState(filePath, exists, ready) {
  const parts = [filePath || "-"];
  parts.push(exists ? "已存在" : "不存在");
  if (typeof ready === "boolean") parts.push(ready ? "已就绪" : "未就绪");
  return parts.join(" ｜ ");
}

function formatBool(value) {
  return value ? "是" : "否";
}

function buildCopyText(data) {
  const summary = data?.summary || {};
  const mihomo = data?.mihomo || {};
  const timer = data?.guard?.timer || {};
  const services = Array.isArray(data?.services) ? data.services : [];
  return [
    `检测时间：${formatDateTime(data?.now)}`,
    `结论：${summary.label || "-"}`,
    `说明：${summary.detail || "-"}`,
    `DIRECT：${mihomo.allDirect ? "全部 DIRECT" : mihomo.hasCloudflaredConnections ? "存在非 DIRECT" : "暂无连接"}`,
    `Mihomo socket：${mihomo.socketPath || "-"}`,
    `巡检 timer：${timer.activeState || "-"}`,
    `隧道服务：${services.map((item) => `${item.unit}=${item.activeState || "-"}`).join("; ") || "-"}`
  ].join("\n");
}

async function copyResult() {
  if (!latestCopyText) {
    setStatus("当前没有可复制的结果", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(latestCopyText);
    setStatus("结果已复制到剪贴板");
  } catch (_error) {
    setStatus("复制失败，请手动复制", true);
  }
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function setStatus(message, isError = false) {
  nodes.status.textContent = `状态：${message}`;
  nodes.status.style.color = isError ? "#ffb6b6" : "";
}

async function apiGet(url) {
  const response = await fetch(url, { cache: "no-store" });
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
