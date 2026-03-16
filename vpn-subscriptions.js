const nodes = {
  refreshBtn: document.getElementById("refresh-btn"),
  saveBtn: document.getElementById("save-btn"),
  status: document.getElementById("status"),
  batchInput: document.getElementById("batch-input"),
  batchImportBtn: document.getElementById("batch-import-btn"),
  clearBatchBtn: document.getElementById("clear-batch-btn"),
  addRowBtn: document.getElementById("add-row-btn"),
  copyEnabledBtn: document.getElementById("copy-enabled-btn"),
  sendConvertBtn: document.getElementById("send-convert-btn"),
  tableWrap: document.getElementById("table-wrap")
};

const state = {
  items: []
};

init();

function init() {
  nodes.refreshBtn.addEventListener("click", () => void loadSubscriptions());
  nodes.saveBtn.addEventListener("click", () => void saveSubscriptions());
  nodes.batchImportBtn.addEventListener("click", handleBatchImport);
  nodes.clearBatchBtn.addEventListener("click", () => {
    nodes.batchInput.value = "";
    setStatus("已清空批量输入");
  });
  nodes.addRowBtn.addEventListener("click", addEmptyRow);
  nodes.copyEnabledBtn.addEventListener("click", () => void copyEnabledUrls());
  nodes.sendConvertBtn.addEventListener("click", sendToConverter);
  nodes.tableWrap.addEventListener("click", handleTableClick);
  nodes.tableWrap.addEventListener("input", handleTableInput);
  void loadSubscriptions();
}

async function loadSubscriptions() {
  setStatus("正在读取订阅列表...");
  try {
    const resp = await fetch("/api/vpn-subscriptions", { cache: "no-store" });
    const data = await readMaybeJson(resp);
    if (!resp.ok) {
      throw new Error(data?.error || `读取失败（HTTP ${resp.status}）`);
    }
    state.items = Array.isArray(data?.items) ? data.items : [];
    renderTable();
    setStatus(`读取完成，共 ${state.items.length} 条`);
  } catch (error) {
    state.items = [];
    nodes.tableWrap.className = "table-wrap empty";
    nodes.tableWrap.textContent = error.message || "读取失败";
    setStatus(error.message || "读取失败", true);
  }
}

function renderTable() {
  if (!state.items.length) {
    nodes.tableWrap.className = "table-wrap empty";
    nodes.tableWrap.textContent = "暂无订阅，先从上面批量导入或新增一行。";
    return;
  }

  nodes.tableWrap.className = "table-wrap";
  nodes.tableWrap.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th class="checkbox-cell">启用</th>
          <th>名称</th>
          <th>订阅链接</th>
          <th>标签</th>
          <th>备注</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${state.items
          .map((item, index) => {
            return `
              <tr data-row-index="${index}">
                <td class="checkbox-cell">
                  <label class="checkbox-label">
                    <input type="checkbox" data-field="enabled" ${item.enabled ? "checked" : ""} />
                    开启
                  </label>
                </td>
                <td>
                  <input class="input" data-field="name" value="${escapeAttr(item.name || "")}" placeholder="订阅名称" />
                </td>
                <td>
                  <input class="input" data-field="url" value="${escapeAttr(item.url || "")}" placeholder="https://..." />
                </td>
                <td>
                  <input class="input" data-field="tags" value="${escapeAttr(item.tags || "")}" placeholder="如：家宽/机场A" />
                </td>
                <td>
                  <input class="input" data-field="note" value="${escapeAttr(item.note || "")}" placeholder="备注信息" />
                </td>
                <td>
                  <div class="row-actions">
                    <button class="tiny-btn" type="button" data-action="copy-url">复制链接</button>
                    <button class="tiny-btn" type="button" data-action="delete">删除</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function handleTableInput(event) {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  const row = event.target.closest("tr[data-row-index]");
  if (!row) return;
  const rowIndex = Number(row.dataset.rowIndex);
  if (!Number.isInteger(rowIndex) || !state.items[rowIndex]) return;

  const field = String(input.dataset.field || "").trim();
  if (!field) return;

  if (field === "enabled") {
    state.items[rowIndex].enabled = !!input.checked;
    return;
  }

  const value = String(input.value || "");
  state.items[rowIndex][field] = value;
}

async function handleTableClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const row = event.target.closest("tr[data-row-index]");
  if (!row) return;
  const rowIndex = Number(row.dataset.rowIndex);
  if (!Number.isInteger(rowIndex) || !state.items[rowIndex]) return;

  const action = String(button.dataset.action || "").trim();
  const item = state.items[rowIndex];

  if (action === "copy-url") {
    const url = String(item.url || "").trim();
    if (!url) {
      setStatus("该条没有可复制的链接", true);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("已复制该订阅链接");
    } catch (_error) {
      setStatus("复制失败，请手动复制", true);
    }
    return;
  }

  if (action === "delete") {
    state.items.splice(rowIndex, 1);
    renderTable();
    setStatus("已从列表移除，记得点击“保存全部”");
  }
}

function addEmptyRow() {
  state.items.unshift({
    id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    url: "",
    enabled: true,
    tags: "",
    note: ""
  });
  renderTable();
  setStatus("已新增一行，填写后点击“保存全部”");
}

function handleBatchImport() {
  const text = String(nodes.batchInput.value || "").trim();
  if (!text) {
    setStatus("请先输入要导入的内容", true);
    return;
  }

  const parsed = parseBatchInput(text);
  if (!parsed.length) {
    setStatus("没有识别到有效订阅链接", true);
    return;
  }

  const existingByUrl = new Map();
  state.items.forEach((item) => {
    const key = normalizeUrlForCompare(item.url);
    if (!key) return;
    existingByUrl.set(key, item);
  });

  let added = 0;
  let updated = 0;
  parsed.forEach((item) => {
    const key = normalizeUrlForCompare(item.url);
    if (!key) return;
    const hit = existingByUrl.get(key);
    if (hit) {
      if (!hit.name && item.name) hit.name = item.name;
      if (!hit.tags && item.tags) hit.tags = item.tags;
      hit.enabled = true;
      updated += 1;
      return;
    }
    state.items.unshift({
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${added}`,
      name: item.name,
      url: item.url,
      enabled: true,
      tags: item.tags,
      note: ""
    });
    existingByUrl.set(key, item);
    added += 1;
  });

  renderTable();
  setStatus(`批量导入完成：新增 ${added} 条，激活/更新 ${updated} 条`);
}

function parseBatchInput(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();

  lines.forEach((line) => {
    let name = "";
    let url = "";

    const pair = line.match(/^(.*?)\s*[,|\t]\s*(https?:\/\/\S+)$/i);
    if (pair) {
      name = String(pair[1] || "").trim();
      url = String(pair[2] || "").trim();
    } else if (/^https?:\/\//i.test(line)) {
      url = line;
    }

    if (!url) return;
    const normalized = normalizeUrlForCompare(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);

    out.push({
      name: name || buildNameFromUrl(url),
      url,
      tags: ""
    });
  });

  return out;
}

function buildNameFromUrl(urlText) {
  try {
    const parsed = new URL(String(urlText || "").trim());
    return String(parsed.hostname || "订阅链接").slice(0, 80);
  } catch (_error) {
    return "订阅链接";
  }
}

async function saveSubscriptions() {
  const cleaned = normalizeItemsBeforeSave(state.items);
  if (!cleaned.length) {
    setStatus("当前列表为空，保存后将清空订阅表", true);
  }

  setStatus("正在保存...");
  nodes.saveBtn.disabled = true;
  try {
    const resp = await fetch("/api/vpn-subscriptions/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ items: cleaned })
    });
    const data = await readMaybeJson(resp);
    if (!resp.ok) {
      throw new Error(data?.error || `保存失败（HTTP ${resp.status}）`);
    }
    state.items = Array.isArray(data?.items) ? data.items : [];
    renderTable();
    setStatus(`保存完成，共 ${state.items.length} 条`);
  } catch (error) {
    setStatus(error.message || "保存失败", true);
  } finally {
    nodes.saveBtn.disabled = false;
  }
}

function normalizeItemsBeforeSave(inputItems) {
  const out = [];
  const seen = new Set();
  (Array.isArray(inputItems) ? inputItems : []).forEach((item) => {
    const url = String(item?.url || "").trim();
    const key = normalizeUrlForCompare(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "").trim().slice(0, 120) || buildNameFromUrl(url),
      url,
      enabled: item?.enabled !== false,
      tags: String(item?.tags || "").trim().slice(0, 200),
      note: String(item?.note || "").trim().slice(0, 400),
      createdAt: String(item?.createdAt || "").trim(),
      updatedAt: new Date().toISOString()
    });
  });
  return out;
}

async function copyEnabledUrls() {
  const links = state.items
    .filter((item) => item.enabled !== false)
    .map((item) => String(item.url || "").trim())
    .filter(Boolean);
  if (!links.length) {
    setStatus("没有启用的订阅链接可复制", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(links.join("\n"));
    setStatus(`已复制 ${links.length} 条启用链接`);
  } catch (_error) {
    setStatus("复制失败，请手动复制", true);
  }
}

function sendToConverter() {
  const links = state.items
    .filter((item) => item.enabled !== false)
    .map((item) => String(item.url || "").trim())
    .filter(Boolean);
  if (!links.length) {
    setStatus("没有启用的订阅链接可导入", true);
    return;
  }
  localStorage.setItem("openclaw-vpn-subscription-links", JSON.stringify(links));
  window.location.href = "./vpn-convert.html";
}

function normalizeUrlForCompare(urlText) {
  try {
    const parsed = new URL(String(urlText || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch (_error) {
    return "";
  }
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
