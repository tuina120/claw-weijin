const FAVORITES_KEY = "openclaw-service-favorites";
const COLLAPSE_KEY = "openclaw-service-collapsed-groups";
const DASHBOARD_SNAPSHOT_KEY = "openclaw-service-dashboard-snapshot";
const DASHBOARD_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

const nodes = {
  refreshBtn: document.getElementById("refresh-btn"),
  copyOriginsBtn: document.getElementById("copy-origins-btn"),
  status: document.getElementById("status"),
  summaryBadge: document.getElementById("summary-badge"),
  summaryText: document.getElementById("summary-text"),
  serviceCount: document.getElementById("service-count"),
  serviceCountDetail: document.getElementById("service-count-detail"),
  publicOrigin: document.getElementById("public-origin"),
  publicOriginDetail: document.getElementById("public-origin-detail"),
  cloudflaredStatus: document.getElementById("cloudflared-status"),
  cloudflaredDetail: document.getElementById("cloudflared-detail"),
  spotlightGrid: document.getElementById("spotlight-grid"),
  serviceGrid: document.getElementById("service-grid"),
  favoritesPanel: document.getElementById("favorites-panel"),
  favoritesGrid: document.getElementById("favorites-grid"),
  groupsRoot: document.getElementById("groups-root"),
  rawOutput: document.getElementById("raw-output"),
  logsModal: document.getElementById("logs-modal"),
  logsCloseBtn: document.getElementById("logs-close-btn"),
  logsTitle: document.getElementById("logs-title"),
  logsStatus: document.getElementById("logs-status"),
  logsOutput: document.getElementById("logs-output")
};

let latestData = null;
let latestCopyText = "";
let favorites = loadSet(FAVORITES_KEY);
let collapsedGroups = loadSet(COLLAPSE_KEY);
if (!hasStoredValue(COLLAPSE_KEY)) {
  collapsedGroups.add("compat");
  saveSet(COLLAPSE_KEY, collapsedGroups);
}

init();

function init() {
  nodes.refreshBtn.addEventListener("click", () => void loadDashboard());
  nodes.copyOriginsBtn.addEventListener("click", () => void copyOrigins());
  nodes.groupsRoot.addEventListener("click", handleGroupClick);
  nodes.favoritesGrid.addEventListener("click", handleGroupClick);
  nodes.serviceGrid.addEventListener("click", handleServiceClick);
  nodes.logsCloseBtn.addEventListener("click", closeLogsModal);
  nodes.logsModal.addEventListener("click", (event) => {
    if (event.target === nodes.logsModal) closeLogsModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLogsModal();
  });
  renderLoadingShell();
  hydrateDashboardFromCache();
  requestAnimationFrame(() => {
    void loadDashboard();
  });
}

async function loadDashboard() {
  setStatus(latestData ? "正在刷新服务导航数据..." : "正在读取服务导航数据...");
  await Promise.allSettled([loadDashboardLinks(), loadDashboardStatus()]);
}

async function loadDashboardLinks() {
  try {
    const data = await apiGet("/api/services/links");
    const hasFreshStatus = Array.isArray(latestData?.services) && latestData.services.length > 0;
    const merged = mergeDashboardData(data);
    if (hasFreshStatus) {
      merged.summary = latestData.summary || merged.summary;
      merged.cloudflared = latestData.cloudflared || merged.cloudflared;
      merged.services = latestData.services || merged.services;
    }
    latestData = merged;
    latestCopyText = buildCopyText(merged);
    renderDashboard(merged);
    if (!hasFreshStatus) {
      setStatus("常用入口已就绪，正在刷新服务状态...");
    }
  } catch (error) {
    if (!latestData) {
      setStatus(error.message || "入口加载失败", true);
    }
  }
}

async function loadDashboardStatus() {
  try {
    const data = await apiGet("/api/services/dashboard");
    latestData = mergeDashboardData(data);
    latestCopyText = buildCopyText(latestData);
    saveDashboardSnapshot(latestData);
    renderDashboard(latestData);
    setStatus(`读取完成：${latestData?.summary?.label || "已完成"}`);
  } catch (error) {
    if (latestData) {
      nodes.summaryText.textContent = `${error.message || "刷新失败"}，当前先显示最近一次成功结果。`;
      nodes.rawOutput.textContent = `${String(error.stack || error.message || error)}\n\n${nodes.rawOutput.textContent || ""}`.trim();
      setStatus(error.message || "刷新失败，已保留最近结果", true);
      return;
    }
    latestData = null;
    latestCopyText = "";
    nodes.summaryBadge.className = "summary-badge danger";
    nodes.summaryBadge.textContent = "读取失败";
    nodes.summaryText.textContent = error.message || "读取服务导航失败";
    nodes.serviceGrid.innerHTML = "";
    nodes.favoritesGrid.innerHTML = "";
    nodes.groupsRoot.innerHTML = "";
    nodes.rawOutput.textContent = String(error.stack || error.message || error);
    setStatus(error.message || "读取失败", true);
  }
}

function renderLoadingShell() {
  if (!nodes.spotlightGrid.innerHTML.trim()) {
    nodes.spotlightGrid.innerHTML = Array.from({ length: 4 }, () => `
      <article class="spotlight-card">
        <div class="spotlight-top">
          <div class="spotlight-mark">...</div>
          <span class="pill neutral">加载中</span>
        </div>
        <div class="spotlight-title">正在准备常用入口</div>
        <div class="spotlight-desc">页面已经打开，正在后台读取最新状态。</div>
      </article>
    `).join("");
  }
  if (!nodes.serviceGrid.innerHTML.trim()) {
    nodes.serviceGrid.innerHTML = Array.from({ length: 3 }, () => `
      <article class="service-item">
        <div class="card-head">
          <div>
            <div class="card-title">正在读取服务状态</div>
            <div class="link-url">systemd --user</div>
          </div>
          <span class="pill neutral">加载中</span>
        </div>
        <div class="service-detail">页面内容会先显示，状态随后补齐。</div>
      </article>
    `).join("");
  }
  if (!nodes.groupsRoot.innerHTML.trim()) {
    nodes.groupsRoot.innerHTML = `
      <section class="panel group-panel">
        <div class="group-head">
          <div class="group-head-main">
            <button class="collapse-btn" type="button" disabled>准备中</button>
            <div>
              <div class="group-tag">loading</div>
              <h2 class="group-title">入口列表加载中</h2>
            </div>
          </div>
          <span class="panel-tip">请稍候</span>
        </div>
        <div class="link-grid">
          <article class="link-card">
            <div class="card-head">
              <div class="card-title">正在整理入口</div>
              <span class="pill neutral">加载中</span>
            </div>
            <div class="link-desc">会优先展示最近一次成功结果，然后再刷新最新状态。</div>
          </article>
        </div>
      </section>
    `;
  }
}

function hydrateDashboardFromCache() {
  const cached = loadDashboardSnapshot();
  if (!cached) return;
  latestData = cached;
  latestCopyText = buildCopyText(cached);
  renderDashboard(cached);
  setStatus("已显示最近一次结果，正在刷新最新状态...");
}

function loadDashboardSnapshot() {
  try {
    const raw = localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    const savedAt = Number(parsed.savedAt || 0);
    if (!savedAt || Date.now() - savedAt > DASHBOARD_SNAPSHOT_MAX_AGE_MS) return null;
    return parsed.data && typeof parsed.data === "object" ? parsed.data : null;
  } catch (_error) {
    return null;
  }
}

function saveDashboardSnapshot(data) {
  try {
    localStorage.setItem(DASHBOARD_SNAPSHOT_KEY, JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  } catch (_error) {}
}

function mergeDashboardData(incoming) {
  const current = latestData && typeof latestData === "object" ? latestData : {};
  const next = incoming && typeof incoming === "object" ? incoming : {};
  const nextServices = Array.isArray(next.services) && next.services.length ? next.services : Array.isArray(current.services) ? current.services : [];
  const nextGroups = Array.isArray(next.groups) && next.groups.length ? next.groups : Array.isArray(current.groups) ? current.groups : [];
  const nextCloudflared =
    next.cloudflared && typeof next.cloudflared === "object"
      ? { ...(current.cloudflared || {}), ...next.cloudflared }
      : (current.cloudflared || {});
  const nextOrigins =
    next.origins && typeof next.origins === "object"
      ? { ...(current.origins || {}), ...next.origins }
      : (current.origins || {});
  return {
    ...current,
    ...next,
    summary: next.summary || current.summary || {},
    origins: nextOrigins,
    services: nextServices,
    groups: nextGroups,
    cloudflared: nextCloudflared
  };
}

function renderDashboard(data) {
  const summary = data?.summary || {};
  const services = Array.isArray(data?.services) ? data.services : [];
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const cloudflared = data?.cloudflared || {};
  const publicOrigin = data?.origins?.public || "未配置";
  const onlineCount = services.filter((item) => item.ok).length;

  nodes.summaryBadge.className = `summary-badge ${summary.tone || "warn"}`;
  nodes.summaryBadge.textContent = summary.label || "待确认";
  nodes.summaryText.textContent = summary.detail || "";

  nodes.serviceCount.textContent = `${onlineCount}/${services.length || 0}`;
  nodes.serviceCountDetail.textContent = services.length ? "关键服务在线数量" : "暂无服务数据";

  nodes.publicOrigin.textContent = publicOrigin;
  nodes.publicOriginDetail.textContent = publicOrigin === "未配置" ? "当前未推导出主站公网域名" : "你的主站公网入口";

  nodes.cloudflaredStatus.textContent = cloudflared.label || "未知";
  nodes.cloudflaredDetail.textContent = cloudflared.detail || "";

  renderSpotlight(groups);
  renderServices(services);
  renderFavorites(groups);
  renderGroups(groups);
  nodes.rawOutput.textContent = JSON.stringify(data, null, 2);
}

function renderSpotlight(groups) {
  const allItems = flattenGroupItems(groups);
  const picks = [
    findSpotlightItem(allItems, ["对话页"]),
    findSpotlightItem(allItems, ["Web IDE", "Web IDE 公网"]),
    findSpotlightItem(allItems, ["文件管理", "文件公网"]),
    findSpotlightItem(allItems, ["SSH工具"])
  ].filter(Boolean);

  if (!picks.length) {
    nodes.spotlightGrid.innerHTML = '<div class="empty-tip">当前没有可展示的核心入口。</div>';
    return;
  }

  nodes.spotlightGrid.innerHTML = picks
    .map((item) => {
      const mark = buildSpotlightMark(item.name);
      return `
        <article class="spotlight-card">
          <div class="spotlight-top">
            <div class="spotlight-mark">${escapeHtml(mark)}</div>
            <span class="pill neutral">${escapeHtml(renderKind(item.kind))}</span>
          </div>
          <div class="spotlight-title">${escapeHtml(item.name)}</div>
          <div class="spotlight-desc">${escapeHtml(item.description || item.url || "")}</div>
          <div class="spotlight-actions">
            <a class="spotlight-link" href="${escapeAttr(item.url || "")}" target="_blank" rel="noreferrer">立即打开</a>
            <button class="btn spotlight-copy" type="button" data-copy-url="${escapeAttr(item.url || "")}">复制地址</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderServices(services) {
  if (!services.length) {
    nodes.serviceGrid.innerHTML = '<div class="empty-tip">当前没有可展示的服务。</div>';
    return;
  }
  nodes.serviceGrid.innerHTML = services
    .map((item) => `
      <article class="service-item">
        <div class="card-head">
          <div>
            <div class="card-title">${escapeHtml(item.name || "未命名服务")}</div>
            <div class="link-url">${escapeHtml(item.unit || "-")}</div>
          </div>
          <span class="pill ${item.tone || "warn"}">${escapeHtml(item.state || "unknown")}</span>
        </div>
        <div class="service-detail">${escapeHtml(item.detail || "")}</div>
        <div class="link-desc">${escapeHtml(item.extra || "")}</div>
        <div class="card-actions">
          <button class="logs-btn" type="button" data-service-unit="${escapeAttr(item.unit || "")}" data-service-name="${escapeAttr(item.name || "")}">最近日志</button>
          <span class="pill neutral">${item.enabled ? "已启用" : "未启用"}</span>
          ${item.updatedAt ? `<span class="pill neutral">${escapeHtml(item.updatedAt)}</span>` : ""}
        </div>
      </article>
    `)
    .join("");
}

function renderFavorites(groups) {
  const allItems = flattenGroupItems(groups);
  const list = allItems.filter((item) => favorites.has(buildFavoriteKey(item)));
  if (!list.length) {
    nodes.favoritesPanel.hidden = true;
    nodes.favoritesGrid.innerHTML = "";
    return;
  }
  nodes.favoritesPanel.hidden = false;
  nodes.favoritesGrid.innerHTML = list.map((item) => renderLinkCard(item, { favorite: true })).join("");
}

function renderGroups(groups) {
  nodes.groupsRoot.innerHTML = groups
    .map((group) => {
      const collapsed = collapsedGroups.has(group.id);
      return `
        <section class="panel group-panel ${collapsed ? "is-collapsed" : ""}" data-group-id="${escapeAttr(group.id || "")}">
          <div class="group-head">
            <div class="group-head-main">
              <button class="collapse-btn" type="button" data-toggle-group="${escapeAttr(group.id || "")}">${collapsed ? "展开" : "收起"}</button>
              <div>
                <div class="group-tag">${escapeHtml(group.id || "group")}</div>
                <h2 class="group-title">${escapeHtml(group.title || "未命名分组")}</h2>
              </div>
            </div>
            <span class="panel-tip">${Array.isArray(group.items) ? group.items.length : 0} 个入口</span>
          </div>
          <div class="link-grid">
            ${(Array.isArray(group.items) ? group.items : []).map((item) => renderLinkCard(item)).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderLinkCard(item, options = {}) {
  const url = String(item?.url || "");
  const favoriteKey = buildFavoriteKey(item);
  const isFavorite = favorites.has(favoriteKey);
  return `
    <article class="link-card ${item?.featured ? "featured" : ""}">
      <div class="card-head">
        <div class="card-title">${escapeHtml(item?.name || "未命名入口")}</div>
        <span class="pill neutral">${escapeHtml(renderKind(item?.kind))}</span>
      </div>
      <div class="link-desc">${escapeHtml(item?.description || "")}</div>
      <div class="link-url">${escapeHtml(url || "-")}</div>
      <div class="card-actions">
        <a class="card-link" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">打开</a>
        <button class="btn" type="button" data-copy-url="${escapeAttr(url)}">复制地址</button>
        <button class="favorite-btn ${isFavorite ? "active" : ""}" type="button" data-favorite-key="${escapeAttr(favoriteKey)}" data-favorite-name="${escapeAttr(item?.name || "")}">${options.favorite ? "取消收藏" : isFavorite ? "已收藏" : "收藏"}</button>
      </div>
    </article>
  `;
}

function renderKind(kind) {
  const value = String(kind || "").trim().toLowerCase();
  if (value === "public") return "公网";
  if (value === "current") return "当前源";
  return "本机";
}

function handleGroupClick(event) {
  const toggleButton = event.target.closest("[data-toggle-group]");
  if (toggleButton) {
    const groupId = String(toggleButton.getAttribute("data-toggle-group") || "").trim();
    toggleGroup(groupId);
    return;
  }

  const favoriteButton = event.target.closest("[data-favorite-key]");
  if (favoriteButton) {
    const key = String(favoriteButton.getAttribute("data-favorite-key") || "").trim();
    toggleFavorite(key);
    return;
  }

  const button = event.target.closest("[data-copy-url]");
  if (!button) return;
  const url = String(button.getAttribute("data-copy-url") || "").trim();
  if (!url) return;
  void copyText(url, "地址已复制");
}

function handleServiceClick(event) {
  const button = event.target.closest("[data-service-unit]");
  if (!button) return;
  const unit = String(button.getAttribute("data-service-unit") || "").trim();
  const name = String(button.getAttribute("data-service-name") || unit).trim();
  if (!unit) return;
  void openLogsModal(unit, name);
}

function toggleGroup(groupId) {
  if (!groupId) return;
  if (collapsedGroups.has(groupId)) collapsedGroups.delete(groupId);
  else collapsedGroups.add(groupId);
  saveSet(COLLAPSE_KEY, collapsedGroups);
  if (latestData) renderGroups(latestData.groups || []);
}

function toggleFavorite(key) {
  if (!key) return;
  if (favorites.has(key)) favorites.delete(key);
  else favorites.add(key);
  saveSet(FAVORITES_KEY, favorites);
  if (latestData) {
    renderFavorites(latestData.groups || []);
    renderGroups(latestData.groups || []);
  }
}

async function openLogsModal(unit, name) {
  nodes.logsTitle.textContent = `${name} 日志`;
  nodes.logsStatus.textContent = `正在读取 ${unit} 最近日志...`;
  nodes.logsOutput.textContent = "";
  nodes.logsModal.classList.remove("hidden");
  try {
    const data = await apiGet(`/api/services/logs?unit=${encodeURIComponent(unit)}&lines=60`);
    nodes.logsStatus.textContent = data.ok ? `${unit} 最近 ${data.lineLimit} 行日志` : `读取失败：${data.error || "未知错误"}`;
    nodes.logsOutput.textContent = data.text || data.error || "暂无日志";
  } catch (error) {
    nodes.logsStatus.textContent = error.message || "读取日志失败";
    nodes.logsOutput.textContent = String(error.stack || error.message || error);
  }
}

function closeLogsModal() {
  nodes.logsModal.classList.add("hidden");
}

async function copyOrigins() {
  if (!latestCopyText) {
    setStatus("当前没有可复制的地址", true);
    return;
  }
  await copyText(latestCopyText, "常用地址已复制");
}

async function copyText(text, successText) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    setStatus(successText || "已复制");
  } catch (_error) {
    setStatus("复制失败，请手动复制", true);
  }
}

function buildCopyText(data) {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const lines = [];
  groups.forEach((group) => {
    lines.push(`【${group.title || group.id || "分组"}】`);
    (Array.isArray(group.items) ? group.items : []).forEach((item) => {
      lines.push(`${item.name}: ${item.url}`);
    });
    lines.push("");
  });
  return lines.join("\n").trim();
}

function flattenGroupItems(groups) {
  return (Array.isArray(groups) ? groups : []).flatMap((group) => Array.isArray(group.items) ? group.items : []);
}

function findSpotlightItem(items, names) {
  const wanted = new Set((Array.isArray(names) ? names : []).map((item) => String(item || "").trim()));
  return (Array.isArray(items) ? items : []).find((item) => wanted.has(String(item?.name || "").trim())) || null;
}

function buildSpotlightMark(name) {
  const value = String(name || "").trim();
  if (value.includes("Web IDE")) return "IDE";
  if (value.includes("对话")) return "CHAT";
  if (value.includes("文件")) return "FILE";
  if (value.includes("SSH")) return "SSH";
  return value.slice(0, 4).toUpperCase();
}

function buildFavoriteKey(item) {
  return `${String(item?.name || "").trim()}|${String(item?.url || "").trim()}`;
}

function loadSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.map((item) => String(item || "").trim()).filter(Boolean) : []);
  } catch (_error) {
    return new Set();
  }
}

function saveSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch (_error) {}
}

function hasStoredValue(key) {
  try {
    return localStorage.getItem(key) !== null;
  } catch (_error) {
    return false;
  }
}

function setStatus(message, isError = false) {
  nodes.status.textContent = `状态：${message}`;
  nodes.status.style.color = isError ? "#ffb6b6" : "";
}

async function apiGet(url) {
  const response = await fetch(url, { cache: "no-store" });
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

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
