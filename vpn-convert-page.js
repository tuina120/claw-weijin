const nodes = {
  convertBtn: document.getElementById("convert-btn"),
  clearBtn: document.getElementById("clear-btn"),
  pasteExampleBtn: document.getElementById("paste-example-btn"),
  copyInputBtn: document.getElementById("copy-input-btn"),
  importSubsBtn: document.getElementById("import-subs-btn"),
  qrImportBtn: document.getElementById("qr-import-btn"),
  qrExportBtn: document.getElementById("qr-export-btn"),
  qrFileInput: document.getElementById("qr-file-input"),
  sourceInput: document.getElementById("source-input"),
  status: document.getElementById("status"),
  dedupeMode: document.getElementById("dedupe-mode"),
  regionFilter: document.getElementById("region-filter"),
  keywordFilter: document.getElementById("keyword-filter"),
  protocolChips: document.getElementById("protocol-chips"),
  totalCount: document.getElementById("total-count"),
  summaryText: document.getElementById("summary-text"),
  protocols: document.getElementById("protocols"),
  regions: document.getElementById("regions"),
  fetchCount: document.getElementById("fetch-count"),
  statExtra: document.getElementById("stat-extra"),
  warningsList: document.getElementById("warnings-list"),
  sourcesList: document.getElementById("sources-list"),
  nodesTableWrap: document.getElementById("nodes-table-wrap"),
  tabRow: document.getElementById("tab-row"),
  copyBtn: document.getElementById("copy-btn"),
  downloadBtn: document.getElementById("download-btn"),
  downloadLinkQrBtn: document.getElementById("download-link-qr-btn"),
  copyDownloadLinkBtn: document.getElementById("copy-download-link-btn"),
  outputText: document.getElementById("output-text"),
  historyList: document.getElementById("history-list"),
  refreshHistoryBtn: document.getElementById("refresh-history-btn"),
  clearHistoryBtn: document.getElementById("clear-history-btn"),
  qrModal: document.getElementById("qr-modal"),
  qrImage: document.getElementById("qr-image"),
  qrTextPreview: document.getElementById("qr-text-preview"),
  qrCloseBtn: document.getElementById("qr-close-btn"),
  qrCopyTextBtn: document.getElementById("qr-copy-text-btn"),
  qrDownloadBtn: document.getElementById("qr-download-btn")
};

const state = {
  result: null,
  activeTab: "raw",
  history: [],
  tableNodes: [],
  qrCurrentText: "",
  lastDownloadLink: ""
};

const outputMeta = {
  raw: { label: "原始节点", ext: "txt", mime: "text/plain;charset=utf-8" },
  base64: { label: "Base64", ext: "txt", mime: "text/plain;charset=utf-8" },
  clash: { label: "Clash YAML", ext: "yaml", mime: "text/yaml;charset=utf-8" },
  singbox: { label: "sing-box", ext: "json", mime: "application/json;charset=utf-8" },
  surge: { label: "Surge", ext: "conf", mime: "text/plain;charset=utf-8" },
  loon: { label: "Loon", ext: "conf", mime: "text/plain;charset=utf-8" },
  quantumultx: { label: "Quantumult X", ext: "conf", mime: "text/plain;charset=utf-8" }
};

init();

function init() {
  nodes.convertBtn.addEventListener("click", () => void runConvert());
  nodes.clearBtn.addEventListener("click", clearAll);
  nodes.pasteExampleBtn.addEventListener("click", fillExample);
  nodes.copyInputBtn.addEventListener("click", () => void copyInput());
  nodes.importSubsBtn.addEventListener("click", () => void importEnabledSubscriptions());
  nodes.qrImportBtn.addEventListener("click", triggerQrImport);
  nodes.qrExportBtn.addEventListener("click", () => void exportFromCurrentSelection());
  nodes.qrFileInput.addEventListener("change", () => void handleQrFileChange());
  nodes.tabRow.addEventListener("click", handleTabClick);
  nodes.copyBtn.addEventListener("click", () => void copyCurrentOutput());
  nodes.downloadBtn.addEventListener("click", downloadCurrentOutput);
  nodes.downloadLinkQrBtn.addEventListener("click", () => void createDownloadLinkQr());
  nodes.copyDownloadLinkBtn.addEventListener("click", () => void copyLastDownloadLink());
  nodes.refreshHistoryBtn.addEventListener("click", () => void loadHistory());
  nodes.clearHistoryBtn.addEventListener("click", () => void clearHistory());
  nodes.nodesTableWrap.addEventListener("click", (event) => void handleNodesTableClick(event));
  nodes.historyList.addEventListener("click", handleHistoryClick);
  nodes.qrCloseBtn.addEventListener("click", closeQrModal);
  nodes.qrCopyTextBtn.addEventListener("click", () => void copyQrContent());
  nodes.qrDownloadBtn.addEventListener("click", () => void downloadCurrentQr());
  nodes.qrModal.addEventListener("click", (event) => {
    if (event.target === nodes.qrModal) closeQrModal();
  });
  document.addEventListener("keydown", handleEscCloseQrModal);
  refreshDownloadLinkCopyButton();
  consumePendingSubscriptions();
  void loadHistory();
  renderEmpty("尚未转换");
}

async function runConvert(options = {}) {
  const input = String(options.input ?? nodes.sourceInput.value ?? "").trim();
  if (!input) {
    setStatus("请先输入订阅链接或节点内容", true);
    nodes.sourceInput.focus();
    return;
  }

  if (!options.keepInput) {
    nodes.sourceInput.value = input;
  }

  setStatus("正在转换节点...");
  nodes.convertBtn.disabled = true;

  try {
    const payload = buildConvertPayload(input);
    const { resp, data, text } = await postJsonWithOneRetry("/api/vpn-convert", payload);
    if (!resp.ok) {
      throw new Error(data?.error || buildNonJsonErrorMessage(resp.status, text, "转换失败"));
    }
    state.result = data || null;
    renderResult(data || {});
    await loadHistory();
    setStatus(data?.summary?.message || "转换完成", !data?.summary?.total);
  } catch (error) {
    state.result = null;
    renderEmpty(error.message || "转换失败");
    setStatus(error.message || "转换失败", true);
  } finally {
    nodes.convertBtn.disabled = false;
  }
}

function buildConvertPayload(input) {
  return {
    input,
    dedupeMode: nodes.dedupeMode.value,
    region: nodes.regionFilter.value,
    keyword: String(nodes.keywordFilter.value || "").trim(),
    protocols: getSelectedProtocols()
  };
}

function getSelectedProtocols() {
  return Array.from(nodes.protocolChips.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

function clearAll() {
  nodes.sourceInput.value = "";
  nodes.keywordFilter.value = "";
  nodes.regionFilter.value = "all";
  nodes.dedupeMode.value = "endpoint";
  nodes.protocolChips.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
  state.result = null;
  state.activeTab = "raw";
  syncTabButtons();
  renderEmpty("尚未转换");
  setStatus("已清空");
}

function fillExample() {
  nodes.sourceInput.value = [
    "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:8388#test-ss",
    "vless://123e4567-e89b-12d3-a456-426614174000@example.com:443?security=tls&type=ws&host=example.com&path=%2Fws#test-vless"
  ].join("\n");
  setStatus("已填入示例，可直接开始转换");
}

async function copyInput() {
  const text = String(nodes.sourceInput.value || "").trim();
  if (!text) {
    setStatus("当前输入为空，无法复制", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("当前输入已复制");
  } catch (_error) {
    setStatus("复制输入失败，请手动复制", true);
  }
}

function triggerQrImport() {
  nodes.qrFileInput.value = "";
  nodes.qrFileInput.click();
}

async function importEnabledSubscriptions() {
  setStatus("正在读取常用订阅...");
  try {
    const resp = await fetch("/api/vpn-subscriptions", { cache: "no-store" });
    const data = await readMaybeJson(resp);
    if (!resp.ok) {
      throw new Error(data?.error || `读取订阅失败（HTTP ${resp.status}）`);
    }
    const items = Array.isArray(data?.items) ? data.items : [];
    const links = items
      .filter((item) => item?.enabled !== false)
      .map((item) => String(item?.url || "").trim())
      .filter(Boolean);
    if (!links.length) {
      setStatus("没有启用中的订阅链接可导入", true);
      return;
    }
    const imported = appendSourceLines(links);
    if (!imported) {
      setStatus("常用订阅已全部在输入框中");
      return;
    }
    setStatus(`已导入常用订阅 ${imported} 条`);
  } catch (error) {
    setStatus(error.message || "导入常用订阅失败", true);
  }
}

function consumePendingSubscriptions() {
  try {
    const raw = localStorage.getItem("openclaw-vpn-subscription-links");
    if (!raw) return;
    localStorage.removeItem("openclaw-vpn-subscription-links");
    const parsed = JSON.parse(raw);
    const links = Array.isArray(parsed)
      ? parsed.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    if (!links.length) return;
    const imported = appendSourceLines(links);
    if (!imported) return;
    setStatus(`已从订阅管理页带入 ${imported} 条链接`);
  } catch (_error) {
    localStorage.removeItem("openclaw-vpn-subscription-links");
  }
}

function appendSourceLines(lines) {
  const sourceLines = String(nodes.sourceInput.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set(sourceLines);
  let added = 0;
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const text = String(line || "").trim();
    if (!text || seen.has(text)) return;
    sourceLines.push(text);
    seen.add(text);
    added += 1;
  });
  nodes.sourceInput.value = sourceLines.join("\n");
  return added;
}

async function handleQrFileChange() {
  const file = nodes.qrFileInput.files?.[0];
  if (!file) return;
  try {
    setStatus("正在识别二维码...");
    const text = await decodeQrFromFile(file);
    if (!text) {
      throw new Error("未识别到二维码内容，请换一张更清晰的二维码图片");
    }
    const imported = appendSourceLines(splitQrTextToLines(text));
    if (!imported) {
      setStatus("二维码内容已存在，无需重复导入");
      return;
    }
    setStatus(`二维码导入成功，新增 ${imported} 行`);
  } catch (error) {
    setStatus(error.message || "二维码识别失败", true);
  } finally {
    nodes.qrFileInput.value = "";
  }
}

async function decodeQrFromFile(file) {
  if (typeof window.BarcodeDetector !== "function") {
    throw new Error("当前浏览器不支持二维码识别，请使用最新版 Chrome 或 Edge");
  }
  let detector;
  try {
    detector = new window.BarcodeDetector({ formats: ["qr_code"] });
  } catch (_error) {
    detector = new window.BarcodeDetector();
  }
  const bitmap = await createImageBitmap(file);
  try {
    const codes = await detector.detect(bitmap);
    const hit = Array.isArray(codes)
      ? codes.find((item) => String(item?.rawValue || "").trim())
      : null;
    return String(hit?.rawValue || "").trim();
  } finally {
    if (bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

function splitQrTextToLines(text) {
  const value = String(text || "").trim();
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function exportFromCurrentSelection() {
  const text = pickQrExportText();
  if (!text) {
    setStatus("当前没有可导出的节点或链接", true);
    return;
  }
  await openQrModalWithText(text);
}

function handleTabClick(event) {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.activeTab = String(button.dataset.tab || "raw");
  syncTabButtons();
  renderOutput();
}

function renderResult(data) {
  const summary = data?.summary || {};
  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  const fetchedSources = Array.isArray(data?.fetchedSources) ? data.fetchedSources : [];
  const list = Array.isArray(data?.nodes) ? data.nodes : [];

  nodes.totalCount.textContent = String(summary.total || 0);
  nodes.summaryText.textContent = summary.message || "转换完成";
  nodes.protocols.textContent = formatCountMap(summary.protocols, protocolLabelMap);
  nodes.regions.textContent = formatCountMap(summary.regions, regionLabelMap);
  nodes.fetchCount.textContent = String(fetchedSources.length);
  nodes.statExtra.textContent = buildStatExtra(summary, fetchedSources);

  renderWarnings(warnings);
  renderSources(fetchedSources);
  renderTable(list);
  renderOutput();
}

function buildStatExtra(summary, fetchedSources) {
  const extras = [];
  if (summary?.rawTotal && summary.rawTotal !== summary.total) {
    extras.push(`原始 ${summary.rawTotal} 个`);
  }
  if (summary?.duplicateRemoved) {
    extras.push(`去重 ${summary.duplicateRemoved}`);
  }
  if (summary?.filteredOut) {
    extras.push(`筛掉 ${summary.filteredOut}`);
  }
  if (!extras.length) {
    return fetchedSources.length ? "远程订阅源处理情况" : "当前没有额外统计";
  }
  return extras.join(" / ");
}

function renderWarnings(items) {
  if (!items.length) {
    nodes.warningsList.className = "list-box empty";
    nodes.warningsList.textContent = "暂无警告";
    return;
  }
  nodes.warningsList.className = "list-box";
  nodes.warningsList.innerHTML = `<ol class="list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
}

function renderSources(items) {
  if (!items.length) {
    nodes.sourcesList.className = "list-box empty";
    nodes.sourcesList.textContent = "暂无订阅抓取记录";
    return;
  }
  nodes.sourcesList.className = "list-box";
  nodes.sourcesList.innerHTML = items
    .map((item) => {
      const ok = !!item?.ok;
      return `
        <div class="source-item">
          <div class="source-main">
            <div class="source-url">${escapeHtml(item?.url || "-")}</div>
            <div class="source-meta">${escapeHtml(ok ? `抓取成功，内容长度 ${Number(item?.length || 0)} 字符` : item?.error || "抓取失败")}</div>
          </div>
          <div class="source-flag ${ok ? "good" : "warn"}">${ok ? "成功" : "失败"}</div>
        </div>
      `;
    })
    .join("");
}

function renderTable(list) {
  if (!list.length) {
    state.tableNodes = [];
    nodes.nodesTableWrap.className = "table-wrap empty";
    nodes.nodesTableWrap.textContent = "尚未转换";
    return;
  }

  const rows = list.slice(0, 200);
  state.tableNodes = rows;
  nodes.nodesTableWrap.className = "table-wrap";
  nodes.nodesTableWrap.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>名称</th>
          <th>协议</th>
          <th>地区</th>
          <th>地址</th>
          <th>端口</th>
          <th>附加信息</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((item, index) => {
            const extra = buildNodeExtra(item);
            return `
              <tr>
                <td>${escapeHtml(item?.name || "-")}</td>
                <td>${escapeHtml(protocolLabelMap[item?.protocol] || item?.protocol || "-")}</td>
                <td>${escapeHtml(regionLabelMap[item?.regionTag] || item?.regionLabel || "其他")}</td>
                <td>${escapeHtml(item?.server || "-")}</td>
                <td>${escapeHtml(String(item?.port || "-"))}</td>
                <td>${escapeHtml(extra)}</td>
                <td>
                  <button class="btn node-qr-btn" type="button" data-node-action="show-qr" data-node-index="${index}">
                    二维码
                  </button>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

async function handleNodesTableClick(event) {
  const button = event.target.closest("[data-node-action]");
  if (!button) return;
  const action = String(button.dataset.nodeAction || "").trim();
  if (action !== "show-qr") return;
  const index = Number(button.dataset.nodeIndex);
  if (!Number.isInteger(index) || !state.tableNodes[index]) {
    setStatus("节点不存在，可能已刷新", true);
    return;
  }
  const text = String(state.tableNodes[index]?.original || "").trim();
  if (!text) {
    setStatus("该节点缺少原始链接，无法生成二维码", true);
    return;
  }
  await openQrModalWithText(text);
}

function renderOutput() {
  const outputs = state.result?.outputs || {};
  const current = outputs[state.activeTab] || "";
  nodes.outputText.value = current;
}

function renderEmpty(message) {
  state.tableNodes = [];
  nodes.totalCount.textContent = "0";
  nodes.summaryText.textContent = message || "尚未转换";
  nodes.protocols.textContent = "-";
  nodes.regions.textContent = "-";
  nodes.fetchCount.textContent = "0";
  nodes.statExtra.textContent = "远程订阅源处理情况";
  nodes.warningsList.className = "list-box empty";
  nodes.warningsList.textContent = "暂无警告";
  nodes.sourcesList.className = "list-box empty";
  nodes.sourcesList.textContent = "暂无订阅抓取记录";
  nodes.nodesTableWrap.className = "table-wrap empty";
  nodes.nodesTableWrap.textContent = "尚未转换";
  nodes.outputText.value = "";
}

async function copyCurrentOutput() {
  const text = String(nodes.outputText.value || "");
  if (!text) {
    setStatus("当前结果为空，无法复制", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`已复制${outputMeta[state.activeTab]?.label || "当前结果"}`);
  } catch (_error) {
    setStatus("复制失败，请手动复制", true);
  }
}

function downloadCurrentOutput() {
  const text = String(state.result?.outputs?.[state.activeTab] || "");
  if (!text) {
    setStatus("当前没有可下载内容", true);
    return;
  }
  const meta = outputMeta[state.activeTab] || outputMeta.raw;
  const blob = new Blob([text], { type: meta.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `openclaw-nodes-${formatFileStamp(new Date())}.${meta.ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`${meta.label} 已开始下载`);
}

async function createDownloadLinkQr() {
  const text = String(state.result?.outputs?.[state.activeTab] || "");
  if (!text) {
    setStatus("当前没有可生成链接的结果", true);
    return;
  }
  const meta = outputMeta[state.activeTab] || outputMeta.raw;
  nodes.downloadLinkQrBtn.disabled = true;
  nodes.copyDownloadLinkBtn.disabled = true;
  setStatus("正在生成下载链接...");
  try {
    const { resp, data, text: errorText } = await postJsonWithOneRetry("/api/vpn-convert/export-link", {
      tab: state.activeTab,
      ext: meta.ext,
      mime: meta.mime,
      text
    });
    if (!resp.ok) {
      throw new Error(data?.error || buildNonJsonErrorMessage(resp.status, errorText, "生成链接失败"));
    }
    const url = String(data?.url || "").trim();
    if (!url) {
      throw new Error("下载链接为空");
    }
    state.lastDownloadLink = url;
    refreshDownloadLinkCopyButton();
    const copied = await tryCopyText(url);
    await openQrModalWithText(url);
    setStatus(copied ? "下载链接二维码已生成，链接也已复制" : "下载链接二维码已生成，可扫码下载");
  } catch (error) {
    setStatus(error.message || "生成下载链接失败", true);
  } finally {
    nodes.downloadLinkQrBtn.disabled = false;
    refreshDownloadLinkCopyButton();
  }
}

async function copyLastDownloadLink() {
  const url = String(state.lastDownloadLink || "").trim();
  if (!url) {
    setStatus("请先点击“下载链接二维码”生成链接", true);
    return;
  }
  const copied = await tryCopyText(url);
  if (copied) {
    setStatus("下载链接已复制");
    return;
  }
  setStatus("复制下载链接失败，请手动复制", true);
}

function refreshDownloadLinkCopyButton() {
  const hasLink = !!String(state.lastDownloadLink || "").trim();
  nodes.copyDownloadLinkBtn.disabled = !hasLink;
}

async function tryCopyText(text) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    return true;
  } catch (_error) {
    return false;
  }
}

async function postJsonWithOneRetry(url, payload) {
  const requestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  };

  let resp = await fetch(url, requestInit);
  if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
    await delay(700);
    resp = await fetch(url, requestInit);
  }
  const { json, text } = await readMaybeJsonWithText(resp);
  return { resp, data: json, text };
}

function buildNonJsonErrorMessage(status, text, fallback) {
  const snippet = String(text || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!snippet) return `${fallback}（HTTP ${status}）`;
  return `${fallback}（HTTP ${status}）：${snippet}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickQrExportText() {
  const source = String(nodes.outputText.value || "");
  const start = Number(nodes.outputText.selectionStart);
  const end = Number(nodes.outputText.selectionEnd);
  if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
    const selected = source.slice(start, end).trim();
    if (selected) return selected;
  }

  const firstOutputLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstOutputLine) return firstOutputLine;

  const nodeLink = String(state.result?.nodes?.[0]?.original || "").trim();
  if (nodeLink) return nodeLink;

  const firstInputLine = String(nodes.sourceInput.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstInputLine || "";
}

async function openQrModalWithText(text) {
  const content = String(text || "").trim();
  if (!content) {
    setStatus("二维码内容为空，无法生成", true);
    return;
  }
  state.qrCurrentText = content;
  nodes.qrTextPreview.value = content;
  nodes.qrImage.src = `/api/auth/qr.svg?text=${encodeURIComponent(content)}`;
  nodes.qrModal.hidden = false;
}

function closeQrModal() {
  nodes.qrModal.hidden = true;
}

function handleEscCloseQrModal(event) {
  if (event.key === "Escape" && !nodes.qrModal.hidden) {
    closeQrModal();
  }
}

async function copyQrContent() {
  const text = String(state.qrCurrentText || "").trim();
  if (!text) {
    setStatus("没有可复制的二维码内容", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("已复制二维码内容");
  } catch (_error) {
    setStatus("复制二维码内容失败，请手动复制", true);
  }
}

async function downloadCurrentQr() {
  const text = String(state.qrCurrentText || "").trim();
  if (!text) {
    setStatus("没有可下载的二维码", true);
    return;
  }
  try {
    const resp = await fetch(`/api/auth/qr.svg?text=${encodeURIComponent(text)}`, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`二维码下载失败（HTTP ${resp.status}）`);
    }
    const svg = await resp.text();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `openclaw-node-qr-${formatFileStamp(new Date())}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("二维码已下载");
  } catch (error) {
    setStatus(error.message || "下载二维码失败", true);
  }
}

async function loadHistory() {
  try {
    const resp = await fetch("/api/vpn-convert/history", { cache: "no-store" });
    const data = await readMaybeJson(resp);
    if (!resp.ok) {
      throw new Error(data?.error || `读取历史失败（HTTP ${resp.status}）`);
    }
    state.history = Array.isArray(data?.items) ? data.items : [];
    renderHistory();
  } catch (error) {
    state.history = [];
    nodes.historyList.className = "history-list empty";
    nodes.historyList.textContent = error.message || "读取历史失败";
  }
}

function renderHistory() {
  if (!state.history.length) {
    nodes.historyList.className = "history-list empty";
    nodes.historyList.textContent = "暂无历史记录";
    return;
  }
  nodes.historyList.className = "history-list";
  nodes.historyList.innerHTML = state.history
    .map((item) => {
      const protocolText = formatCountMap(item?.summary?.protocols, protocolLabelMap);
      const filterText = buildHistoryFilterText(item?.options || {});
      return `
        <article class="history-item">
          <div class="history-top">
            <div class="history-preview">${escapeHtml(item?.preview || "未命名输入")}</div>
            <span class="pill">${escapeHtml(formatDateTime(item?.createdAt))}</span>
          </div>
          <div class="history-meta">${escapeHtml(item?.summary?.message || `${item?.summary?.total || 0} 个节点`)}</div>
          <div class="history-meta">${escapeHtml(protocolText || "无协议统计")}</div>
          <div class="history-meta">${escapeHtml(filterText)}</div>
          <div class="history-actions">
            <button class="btn" type="button" data-history-action="import" data-id="${escapeAttr(item.id)}">导入</button>
            <button class="btn" type="button" data-history-action="run" data-id="${escapeAttr(item.id)}">导入并转换</button>
            <button class="btn btn-ghost" type="button" data-history-action="delete" data-id="${escapeAttr(item.id)}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function buildHistoryFilterText(options) {
  const parts = [];
  parts.push(`去重：${dedupeLabelMap[options?.dedupeMode] || "按地址与协议"}`);
  if (Array.isArray(options?.protocols) && options.protocols.length) {
    parts.push(`协议：${options.protocols.map((item) => protocolLabelMap[item] || item).join("/")}`);
  }
  if (options?.region && options.region !== "all") {
    parts.push(`地区：${regionLabelMap[options.region] || options.region}`);
  }
  if (options?.keyword) {
    parts.push(`关键词：${options.keyword}`);
  }
  return parts.join(" | ");
}

async function handleHistoryClick(event) {
  const button = event.target.closest("[data-history-action]");
  if (!button) return;
  const action = String(button.dataset.historyAction || "").trim();
  const id = String(button.dataset.id || "").trim();
  const item = state.history.find((entry) => entry.id === id);
  if (!item) {
    setStatus("历史记录不存在，可能已被删除", true);
    return;
  }

  if (action === "import") {
    applyHistoryItem(item);
    setStatus("已导入历史输入");
    return;
  }
  if (action === "run") {
    applyHistoryItem(item);
    await runConvert({ input: item.input, keepInput: true });
    return;
  }
  if (action === "delete") {
    await deleteHistoryItem(id);
  }
}

function applyHistoryItem(item) {
  nodes.sourceInput.value = String(item?.input || "");
  nodes.dedupeMode.value = String(item?.options?.dedupeMode || "endpoint");
  nodes.regionFilter.value = String(item?.options?.region || "all");
  nodes.keywordFilter.value = String(item?.options?.keyword || "");
  const protocolSet = new Set(Array.isArray(item?.options?.protocols) ? item.options.protocols : []);
  nodes.protocolChips.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = protocolSet.has(String(input.value || ""));
  });
}

async function deleteHistoryItem(id) {
  try {
    const resp = await fetch("/api/vpn-convert/history/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id })
    });
    const data = await readMaybeJson(resp);
    if (!resp.ok) {
      throw new Error(data?.error || `删除失败（HTTP ${resp.status}）`);
    }
    await loadHistory();
    setStatus("历史记录已删除");
  } catch (error) {
    setStatus(error.message || "删除历史失败", true);
  }
}

async function clearHistory() {
  try {
    const resp = await fetch("/api/vpn-convert/history/clear", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    const data = await readMaybeJson(resp);
    if (!resp.ok) {
      throw new Error(data?.error || `清空失败（HTTP ${resp.status}）`);
    }
    state.history = [];
    renderHistory();
    setStatus("历史记录已清空");
  } catch (error) {
    setStatus(error.message || "清空历史失败", true);
  }
}

function syncTabButtons() {
  nodes.tabRow.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });
}

function formatCountMap(map, labelMap = {}) {
  const entries = Object.entries(map || {});
  if (!entries.length) return "-";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${labelMap[key] || key} ${value}`)
    .join(" / ");
}

function buildNodeExtra(item) {
  const chunks = [];
  if (item?.tls) chunks.push("TLS");
  if (item?.network) chunks.push(`网络 ${item.network}`);
  if (item?.cipher) chunks.push(`加密 ${item.cipher}`);
  if (item?.sni) chunks.push(`SNI ${item.sni}`);
  if (item?.host) chunks.push(`Host ${item.host}`);
  return chunks.join(" | ") || "-";
}

function formatFileStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
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

async function readMaybeJson(resp) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

async function readMaybeJsonWithText(resp) {
  const text = await resp.text();
  if (!text) return { json: null, text: "" };
  try {
    return { json: JSON.parse(text), text };
  } catch (_error) {
    return { json: null, text };
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const protocolLabelMap = {
  vmess: "vmess",
  vless: "vless",
  trojan: "trojan",
  ss: "ss",
  hysteria2: "hysteria2",
  tuic: "tuic"
};

const regionLabelMap = {
  hk: "香港",
  tw: "台湾",
  jp: "日本",
  sg: "新加坡",
  us: "美国",
  kr: "韩国",
  uk: "英国",
  de: "德国",
  fr: "法国",
  nl: "荷兰",
  ca: "加拿大",
  au: "澳大利亚",
  my: "马来西亚",
  in: "印度",
  ru: "俄罗斯",
  other: "其他"
};

const dedupeLabelMap = {
  endpoint: "按地址与协议",
  link: "按原始链接",
  none: "不去重"
};
