const nodes = {
  refreshBtn: document.getElementById("refresh-btn"),
  selfTestBtn: document.getElementById("self-test-btn"),
  copyBtn: document.getElementById("copy-btn"),
  status: document.getElementById("status"),
  summaryBadge: document.getElementById("summary-badge"),
  summaryText: document.getElementById("summary-text"),
  countReceived: document.getElementById("count-received"),
  countReceivedDetail: document.getElementById("count-received-detail"),
  countForwarded: document.getElementById("count-forwarded"),
  countForwardedDetail: document.getElementById("count-forwarded-detail"),
  countFailed: document.getElementById("count-failed"),
  countFailedDetail: document.getElementById("count-failed-detail"),
  countSecret: document.getElementById("count-secret"),
  countSecretDetail: document.getElementById("count-secret-detail"),
  configKv: document.getElementById("config-kv"),
  latestKv: document.getElementById("latest-kv"),
  telegramKv: document.getElementById("telegram-kv"),
  warningList: document.getElementById("warning-list"),
  eventList: document.getElementById("event-list"),
  rawOutput: document.getElementById("raw-output")
};

let latestSnapshot = null;
let latestCopyText = "";

init();

function init() {
  nodes.refreshBtn.addEventListener("click", () => void loadHealth());
  nodes.selfTestBtn.addEventListener("click", () => void runSelfTest());
  nodes.copyBtn.addEventListener("click", () => void copyResult());
  void loadHealth();
}

async function loadHealth() {
  setStatus("正在读取 Webhook 状态...");
  try {
    const data = await apiGet("/api/telegram/webhook/health");
    latestSnapshot = data;
    latestCopyText = buildCopyText(data);
    renderSnapshot(data);
    setStatus(`读取完成：${data?.summary?.label || "已完成"}`);
  } catch (error) {
    latestSnapshot = null;
    latestCopyText = "";
    nodes.summaryBadge.className = "summary-badge danger";
    nodes.summaryBadge.textContent = "读取失败";
    nodes.summaryText.textContent = error.message || "读取失败";
    nodes.rawOutput.textContent = String(error.stack || error.message || error);
    nodes.warningList.innerHTML = "";
    nodes.eventList.innerHTML = "";
    nodes.configKv.innerHTML = "";
    nodes.latestKv.innerHTML = "";
    nodes.telegramKv.innerHTML = "";
    setStatus(error.message || "读取失败", true);
  }
}

async function runSelfTest() {
  nodes.selfTestBtn.disabled = true;
  setStatus("正在执行 Webhook 自检...");
  try {
    const data = await apiPost("/api/telegram/webhook/self-test", {});
    const statusText = data.ok ? "成功" : "失败";
    setStatus(`自检完成：${statusText}（HTTP ${data.status || "-"}，${data.durationMs || 0}ms）`, !data.ok);
    if (data.snapshot) {
      latestSnapshot = data.snapshot;
      latestCopyText = buildCopyText(data.snapshot);
      renderSnapshot(data.snapshot);
    } else {
      await loadHealth();
    }
  } catch (error) {
    setStatus(error.message || "自检失败", true);
  } finally {
    nodes.selfTestBtn.disabled = false;
  }
}

function renderSnapshot(data) {
  const summary = data?.summary || {};
  const counters = data?.counters || {};
  const latest = data?.latest || {};
  const bridge = data?.bridge || {};
  const telegram = bridge?.telegram || {};
  const webhook = telegram?.webhook || {};
  const checks = data?.checks || {};
  const telegramApi = data?.telegramApi || {};
  const events = Array.isArray(data?.events) ? data.events : [];
  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];

  nodes.summaryBadge.className = `summary-badge ${summary.tone || "warn"}`;
  nodes.summaryBadge.textContent = summary.label || "待确认";
  nodes.summaryText.textContent = summary.detail || "";

  nodes.countReceived.textContent = String(counters.received || 0);
  nodes.countForwarded.textContent = String(counters.forwarded || 0);
  nodes.countFailed.textContent = String(counters.failed || 0);
  nodes.countSecret.textContent = String(counters.secretMismatch || 0);

  nodes.countReceivedDetail.textContent = latest.lastReceivedAt ? `最近：${formatDateTime(latest.lastReceivedAt)}` : "暂无记录";
  nodes.countForwardedDetail.textContent = latest.lastForwardedAt ? `最近：${formatDateTime(latest.lastForwardedAt)}` : "暂无记录";
  nodes.countFailedDetail.textContent = latest.lastFailedAt ? `最近：${formatDateTime(latest.lastFailedAt)}` : "暂无记录";
  nodes.countSecretDetail.textContent = latest.lastSecretMismatchAt ? `最近：${formatDateTime(latest.lastSecretMismatchAt)}` : "暂无记录";

  renderKv(nodes.configKv, [
    ["Bridge 服务", bridge?.service?.healthLabel || bridge?.service?.activeState || "-"],
    ["Telegram 启用", formatBool(telegram.enabled)],
    ["Webhook 模式", telegram.mode || "-"],
    ["Bot Token", telegram.botTokenConfigured ? "已配置" : "未配置"],
    ["Secret Token", webhook.hasSecretToken ? "已配置" : "未配置"],
    ["允许 Chat 数", String(telegram.allowedChatCount ?? "-")],
    ["公网 URL", webhook.publicUrl || "-"],
    ["代理入口", data?.proxy?.publicPath || "-"],
    ["代理转发目标", data?.proxy?.localUrl || "-"],
    ["Bridge webhook.path", webhook.path || "-"],
    ["Bridge 监听", `${webhook.listenHost || "-"}:${webhook.listenPort || "-"}`],
    ["路径检查(公网->代理)", checks.proxyPathMatchesPublicUrl ? "一致" : "不一致"],
    ["路径检查(代理->Bridge)", checks.proxyLocalPathMatchesBridgePath ? "一致" : "不一致"]
  ]);

  renderKv(nodes.latestKv, [
    ["最近接收", formatDateTime(latest.lastReceivedAt)],
    ["最近转发成功", formatDateTime(latest.lastForwardedAt)],
    ["最近失败", formatDateTime(latest.lastFailedAt)],
    ["最近密钥不匹配", formatDateTime(latest.lastSecretMismatchAt)],
    ["最近错误", latest.lastError || "-"]
  ]);

  renderKv(nodes.telegramKv, [
    ["读取状态", telegramApi.ok ? "成功" : `失败：${telegramApi.error || "unknown"}`],
    ["Webhook URL", telegramApi.url || "-"],
    ["pending_update_count", String(telegramApi.pendingUpdateCount ?? "-")],
    ["last_error_date", formatDateTime(telegramApi.lastErrorDate)],
    ["last_error_message", telegramApi.lastErrorMessage || "-"],
    ["last_synchronization_error_date", formatDateTime(telegramApi.lastSyncErrorDate)],
    ["max_connections", String(telegramApi.maxConnections ?? "-")],
    ["ip_address", telegramApi.ipAddress || "-"]
  ]);

  renderWarnings(warnings);
  renderEvents(events);
  nodes.rawOutput.textContent = JSON.stringify(data, null, 2);
}

function renderWarnings(warnings) {
  if (!warnings.length) {
    nodes.warningList.innerHTML = '<article class="service-item ok-item">未发现明显配置问题。</article>';
    return;
  }
  nodes.warningList.innerHTML = warnings
    .map((item) => `<article class="service-item warning-item">${escapeHtml(item)}</article>`)
    .join("");
}

function renderEvents(events) {
  if (!events.length) {
    nodes.eventList.innerHTML = '<div class="muted-text">暂无事件记录。</div>';
    return;
  }
  nodes.eventList.innerHTML = events
    .map((item) => {
      const type = String(item?.type || "").trim();
      const tone =
        type === "forwarded"
          ? "good"
          : type === "secret_mismatch"
            ? "warn"
            : "danger";
      const typeLabel =
        type === "forwarded"
          ? "转发成功"
          : type === "forward_failed"
            ? "上游返回失败"
            : type === "secret_mismatch"
              ? "密钥不匹配"
              : type === "proxy_error"
                ? "代理错误"
                : type || "未知";
      return `
        <article class="service-item">
          <div class="item-head">
            <div class="item-title">${escapeHtml(formatDateTime(item.time))}</div>
            <span class="pill ${tone}">${escapeHtml(typeLabel)}</span>
          </div>
          <div class="item-meta">
            <span class="pill neutral">HTTP ${escapeHtml(String(item.statusCode || "-"))}</span>
            <span class="pill neutral">${escapeHtml(String(item.durationMs || 0))}ms</span>
          </div>
          <div class="item-detail">${escapeHtml(item.detail || "-")}</div>
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

function buildCopyText(data) {
  const summary = data?.summary || {};
  const counters = data?.counters || {};
  const latest = data?.latest || {};
  const telegramApi = data?.telegramApi || {};
  return [
    `检测时间：${formatDateTime(data?.now)}`,
    `结论：${summary.label || "-"}`,
    `说明：${summary.detail || "-"}`,
    `累计接收：${counters.received ?? "-"}`,
    `累计成功：${counters.forwarded ?? "-"}`,
    `累计失败：${counters.failed ?? "-"}`,
    `密钥不匹配：${counters.secretMismatch ?? "-"}`,
    `最近接收：${formatDateTime(latest.lastReceivedAt)}`,
    `最近失败：${formatDateTime(latest.lastFailedAt)}`,
    `官方 pending_update_count：${telegramApi.pendingUpdateCount ?? "-"}`,
    `官方 last_error_message：${telegramApi.lastErrorMessage || "-"}`
  ].join("\n");
}

async function copyResult() {
  if (!latestCopyText) {
    setStatus("当前没有可复制的数据", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(latestCopyText);
    setStatus("已复制到剪贴板");
  } catch (_error) {
    setStatus("复制失败，请手动复制", true);
  }
}

function setStatus(message, isError = false) {
  nodes.status.textContent = `状态：${message}`;
  nodes.status.style.color = isError ? "#ffb6b6" : "";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatBool(value) {
  return value ? "是" : "否";
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
