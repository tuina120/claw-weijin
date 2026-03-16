const state = {
  items: [],
  categories: [],
  tree: null,
  selected: new Set(),
  root: "",
  stats: { matchedCount: 0, totalSize: 0 },
  searchText: "",
  category: "",
  folder: "",
  treeSearch: "",
  previewPath: "",
  previewMode: "empty",
  previewCollapsed: false,
  previewEmptyMessage: "点击表格中的“预览”查看 PDF、图片或文本。"
};

const imagePreviewExts = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"]);
const textPreviewExts = new Set([
  "txt",
  "md",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "log",
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "go",
  "java",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "php",
  "rb",
  "sh",
  "ps1",
  "yaml",
  "yml",
  "xml",
  "html",
  "css",
  "sql",
  "toml",
  "ini",
  "conf",
  "env"
]);
const pdfPreviewExts = new Set(["pdf"]);
const downloadChunkBytes = 8 * 1024 * 1024;
const downloadRetryMaxAttempts = 4;
const downloadRetryDelaysMs = [800, 1600, 2800];
const downloadReliableMaxMergeBytes = 1024 * 1024 * 1024;

const nodes = {
  currentUser: document.getElementById("current-user"),
  shareRoot: document.getElementById("share-root"),
  totalCount: document.getElementById("total-count"),
  totalSize: document.getElementById("total-size"),
  searchInput: document.getElementById("search-input"),
  categorySelect: document.getElementById("category-select"),
  refreshBtn: document.getElementById("refresh-btn"),
  refreshTreeBtn: document.getElementById("refresh-tree-btn"),
  clearFolderBtn: document.getElementById("clear-folder-btn"),
  currentFolderLabel: document.getElementById("current-folder-label"),
  folderRootBtn: document.getElementById("folder-root-btn"),
  folderSearchInput: document.getElementById("folder-search-input"),
  folderTree: document.getElementById("folder-tree"),
  downloadSelectedBtn: document.getElementById("download-selected-btn"),
  deleteSelectedBtn: document.getElementById("delete-selected-btn"),
  selectAll: document.getElementById("select-all"),
  tableBody: document.getElementById("file-table-body"),
  status: document.getElementById("status"),
  previewMeta: document.getElementById("preview-meta"),
  previewToggleBtn: document.getElementById("preview-toggle-btn"),
  previewEmpty: document.getElementById("preview-empty"),
  previewImageWrap: document.getElementById("preview-image-wrap"),
  previewImage: document.getElementById("preview-image"),
  previewPdfWrap: document.getElementById("preview-pdf-wrap"),
  previewPdf: document.getElementById("preview-pdf"),
  previewTextWrap: document.getElementById("preview-text-wrap"),
  previewText: document.getElementById("preview-text"),
  qrDialog: document.getElementById("qr-dialog"),
  qrImage: document.getElementById("qr-image"),
  qrLink: document.getElementById("qr-link"),
  copyLinkBtn: document.getElementById("copy-link-btn"),
  closeQrBtn: document.getElementById("close-qr-btn")
};

let searchTimer = null;

init();

async function init() {
  bindEvents();
  resetPreview();
  await loadInfo();
  await Promise.all([loadTree(), loadList()]);
}

function bindEvents() {
  nodes.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchText = nodes.searchInput.value.trim();
      void loadList();
    }, 220);
  });

  nodes.categorySelect.addEventListener("change", () => {
    state.category = nodes.categorySelect.value;
    void loadList();
  });

  nodes.refreshBtn.addEventListener("click", () => void loadList());
  nodes.refreshTreeBtn.addEventListener("click", () => void loadTree());

  nodes.clearFolderBtn.addEventListener("click", () => {
    if (!state.folder) return;
    state.folder = "";
    renderFolderFilterMeta();
    void loadList();
  });
  nodes.folderRootBtn.addEventListener("click", () => {
    state.folder = "";
    renderFolderFilterMeta();
    renderFolderTree();
    void loadList();
  });
  nodes.folderSearchInput.addEventListener("input", () => {
    state.treeSearch = String(nodes.folderSearchInput.value || "").trim().toLowerCase();
    renderFolderTree();
  });

  nodes.selectAll.addEventListener("change", () => {
    if (nodes.selectAll.checked) {
      state.items.forEach((item) => state.selected.add(item.path));
    } else {
      state.selected.clear();
    }
    renderTable();
  });

  nodes.downloadSelectedBtn.addEventListener("click", () => void downloadSelectedAsZip());
  nodes.deleteSelectedBtn.addEventListener("click", () => void deleteSelected());
  nodes.previewToggleBtn.addEventListener("click", () => {
    const hasPreview = state.previewMode === "image" || state.previewMode === "pdf" || state.previewMode === "text";
    if (!hasPreview) return;
    state.previewCollapsed = !state.previewCollapsed;
    renderPreviewVisibility();
  });

  nodes.copyLinkBtn.addEventListener("click", async () => {
    const url = nodes.qrLink.dataset.url || "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("下载链接已复制");
    } catch (_error) {
      setStatus("复制失败，请手动复制", true);
    }
  });
  nodes.closeQrBtn.addEventListener("click", () => nodes.qrDialog.close());
}

async function loadInfo() {
  try {
    const data = await requestJson("/api/files/info");
    state.root = data.root || "";
    nodes.shareRoot.textContent = state.root || "-";
    const userLabel = data.user?.email ? `${data.user.email} (${data.user.role})` : data.user?.role || "已登录";
    nodes.currentUser.textContent = userLabel;
  } catch (error) {
    handleRequestError(error, "读取文件管理信息失败");
  }
}

async function loadTree() {
  try {
    const data = await requestJson("/api/files/tree?maxNodes=6000");
    state.tree = data.tree || null;
    if (state.folder && !treeContainsPath(state.tree, state.folder)) {
      state.folder = "";
      renderFolderFilterMeta();
      void loadList();
    }
    renderFolderTree();
    if (data.tree?.stats?.truncated) {
      setStatus(`文件夹树过大，已按上限 ${data.tree.stats.maxNodes} 截断`, true);
    }
  } catch (error) {
    handleRequestError(error, "读取文件夹树失败");
  }
}

function renderFolderTree() {
  nodes.folderTree.innerHTML = "";
  nodes.folderRootBtn.classList.toggle("active", !state.folder);
  const sourceNodes = state.tree && Array.isArray(state.tree.children) ? state.tree.children : [];
  const visibleNodes = filterFolderNodes(sourceNodes, state.treeSearch);

  if (!visibleNodes.length) {
    const empty = document.createElement("div");
    empty.className = "folder-empty";
    empty.textContent = state.treeSearch ? "没有匹配的扩展目录" : "暂无扩展目录";
    nodes.folderTree.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleNodes.forEach((node) => {
    fragment.appendChild(renderFolderNode(node, 0));
  });
  nodes.folderTree.appendChild(fragment);
}

function filterFolderNodes(nodes, keyword) {
  if (!Array.isArray(nodes) || !nodes.length) return [];
  const token = String(keyword || "").trim().toLowerCase();
  if (!token) return nodes;
  return nodes
    .map((node) => {
      const children = filterFolderNodes(Array.isArray(node.children) ? node.children : [], token);
      const haystack = `${node.name || ""} ${node.path || ""}`.toLowerCase();
      if (!haystack.includes(token) && !children.length) return null;
      return {
        ...node,
        children
      };
    })
    .filter(Boolean);
}

function renderFolderNode(node, level) {
  const wrapper = document.createElement("div");
  wrapper.className = "folder-node-wrap";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "folder-node";
  button.style.paddingLeft = `${0.55 + Math.min(level, 8) * 0.95}rem`;
  button.dataset.path = node.path || "";
  if (state.folder === node.path) button.classList.add("active");
  button.textContent = `${node.name || "(目录)"} (${Number(node.fileCount || 0)})`;
  button.title = node.path || "全部文件";
  button.addEventListener("click", () => {
    state.folder = node.path || "";
    renderFolderFilterMeta();
    renderFolderTree();
    void loadList();
  });
  wrapper.appendChild(button);

  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => {
      wrapper.appendChild(renderFolderNode(child, level + 1));
    });
  }

  return wrapper;
}

function treeContainsPath(node, path) {
  if (!node || !path) return false;
  if (node.path === path) return true;
  if (!Array.isArray(node.children)) return false;
  return node.children.some((child) => treeContainsPath(child, path));
}

function renderFolderFilterMeta() {
  nodes.currentFolderLabel.textContent = state.folder || "全部文件";
}

async function loadList() {
  try {
    const query = new URLSearchParams();
    if (state.searchText) query.set("q", state.searchText);
    if (state.category) query.set("category", state.category);
    if (state.folder) query.set("folder", state.folder);
    query.set("limit", "5000");

    const data = await requestJson(`/api/files/list?${query.toString()}`);
    state.items = Array.isArray(data.items) ? data.items : [];
    state.categories = Array.isArray(data.categories) ? data.categories : [];
    state.stats = data.stats || { matchedCount: 0, totalSize: 0 };
    state.root = data.root || state.root;

    const selected = new Set();
    state.items.forEach((item) => {
      if (state.selected.has(item.path)) selected.add(item.path);
    });
    state.selected = selected;
    if (state.previewPath && !state.items.some((item) => item.path === state.previewPath)) {
      resetPreview();
    }

    renderCategoryOptions();
    renderSummary();
    renderFolderFilterMeta();
    renderTable();
    setStatus(
      state.stats.truncated
        ? `已加载 ${state.items.length} 条（总匹配 ${state.stats.matchedCount} 条，结果已截断）`
        : `已加载 ${state.items.length} 条文件`
    );
  } catch (error) {
    handleRequestError(error, "读取文件列表失败");
  }
}

function renderCategoryOptions() {
  const previous = state.category;
  nodes.categorySelect.innerHTML = "";
  nodes.categorySelect.appendChild(new Option("全部扩展名", ""));
  state.categories.forEach((item) => {
    const name = String(item.name || "").trim();
    if (!name) return;
    nodes.categorySelect.appendChild(new Option(`${name} (${Number(item.count || 0)})`, name));
  });
  nodes.categorySelect.value = previous;
}

function renderSummary() {
  nodes.shareRoot.textContent = state.root || "-";
  nodes.totalCount.textContent = String(state.stats.matchedCount || 0);
  nodes.totalSize.textContent = formatBytes(Number(state.stats.totalSize || 0));
}

function renderTable() {
  nodes.tableBody.innerHTML = "";
  if (!state.items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "当前筛选条件下暂无文件";
    row.appendChild(cell);
    nodes.tableBody.appendChild(row);
    nodes.selectAll.checked = false;
    return;
  }

  state.items.forEach((item) => {
    const row = document.createElement("tr");

    const checkCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(item.path);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selected.add(item.path);
      else state.selected.delete(item.path);
      updateSelectAllState();
    });
    checkCell.appendChild(checkbox);
    row.appendChild(checkCell);

    const nameCell = document.createElement("td");
    const fileMain = document.createElement("div");
    fileMain.className = "file-main";
    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = item.name || "(未命名)";
    const pathNode = document.createElement("div");
    pathNode.className = "file-path";
    pathNode.textContent = item.path || "";
    fileMain.appendChild(name);
    fileMain.appendChild(pathNode);
    nameCell.appendChild(fileMain);
    row.appendChild(nameCell);

    const categoryCell = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${item.category || "other"}${item.ext ? ` · .${item.ext}` : ""}`;
    categoryCell.appendChild(chip);
    row.appendChild(categoryCell);

    const sizeCell = document.createElement("td");
    sizeCell.textContent = formatBytes(Number(item.size || 0));
    row.appendChild(sizeCell);

    const timeCell = document.createElement("td");
    timeCell.textContent = formatDateTime(item.mtime);
    row.appendChild(timeCell);

    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";

    const previewType = resolvePreviewType(item);
    const previewBtn = makeActionButton("预览", "btn-ghost", () => void previewItem(item));
    if (previewType === "none") previewBtn.disabled = true;
    actions.appendChild(previewBtn);

    actions.appendChild(
      makeActionButton("下载", "btn-ghost", () => {
        void downloadItemReliably(item);
      })
    );
    actions.appendChild(
      makeActionButton("永久链", "btn-accent", () => {
        void openShareQr(item, "permanent");
      })
    );
    actions.appendChild(
      makeActionButton("一次链", "btn-ghost", () => {
        void openShareQr(item, "one_time");
      })
    );
    actions.appendChild(
      makeActionButton("重命名", "btn-ghost", () => {
        void renameItem(item);
      })
    );
    actions.appendChild(
      makeActionButton("删除", "btn-danger", () => {
        void deleteByPaths([item.path]);
      })
    );

    actionCell.appendChild(actions);
    row.appendChild(actionCell);
    nodes.tableBody.appendChild(row);
  });

  updateSelectAllState();
}

function makeActionButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-sm ${className}`;
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function updateSelectAllState() {
  if (!state.items.length) {
    nodes.selectAll.checked = false;
    return;
  }
  const selectedCount = state.items.filter((item) => state.selected.has(item.path)).length;
  nodes.selectAll.checked = selectedCount > 0 && selectedCount === state.items.length;
}

async function renameItem(item) {
  const newName = window.prompt("输入新的文件名：", item.name || "");
  if (!newName || newName === item.name) return;
  try {
    await requestJson("/api/files/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path, newName })
    });
    state.selected.delete(item.path);
    setStatus("重命名成功");
    await Promise.all([loadTree(), loadList()]);
  } catch (error) {
    handleRequestError(error, "重命名失败");
  }
}

async function deleteSelected() {
  const paths = Array.from(state.selected);
  if (!paths.length) {
    setStatus("请先勾选要删除的文件", true);
    return;
  }
  await deleteByPaths(paths);
}

async function deleteByPaths(paths) {
  const list = Array.from(new Set(paths.filter(Boolean)));
  if (!list.length) return;
  const ok = window.confirm(`确认删除 ${list.length} 个文件？此操作不可恢复。`);
  if (!ok) return;
  try {
    const data = await requestJson("/api/files/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: list })
    });
    (data.deleted || []).forEach((path) => state.selected.delete(path));
    if (Array.isArray(data.failed) && data.failed.length) {
      setStatus(`已删除 ${data.deleted.length} 个，失败 ${data.failed.length} 个`, true);
    } else {
      setStatus(`已删除 ${data.deleted.length} 个文件`);
    }
    await Promise.all([loadTree(), loadList()]);
  } catch (error) {
    handleRequestError(error, "删除文件失败");
  }
}

async function downloadSelectedAsZip() {
  const paths = Array.from(state.selected);
  if (!paths.length) {
    setStatus("请先勾选要打包的文件", true);
    return;
  }
  try {
    setStatus(`正在打包 ${paths.length} 个文件...`);
    const resp = await fetchWithRetry("/api/files/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paths,
        name: `share-${new Date().toISOString().slice(0, 10)}`
      })
    });
    if (!resp.ok) {
      const data = await readMaybeJson(resp);
      throw makeRequestError(resp.status, data?.error || "打包失败", data?.login);
    }
    const blob = await resp.blob();
    const name = parseDownloadFileName(resp.headers.get("content-disposition")) || "share.zip";
    triggerBlobDownload(blob, name);
    setStatus("打包下载已开始");
  } catch (error) {
    handleRequestError(error, "打包下载失败");
  }
}

async function downloadItemReliably(item) {
  const url = String(item?.downloadUrl || "").trim();
  if (!url) {
    setStatus("下载链接为空", true);
    return;
  }
  const expectedSize = Math.max(0, Number(item?.size || 0));
  const fallbackName = String(item?.name || "download.bin").trim() || "download.bin";

  try {
    if (!expectedSize || expectedSize <= downloadChunkBytes) {
      setStatus(`正在下载：${fallbackName}`);
      const full = await fetchBlobWithRetry(url);
      const fileName = full.fileName || fallbackName;
      triggerBlobDownload(full.blob, fileName);
      setStatus(`下载已开始：${fileName}`);
      return;
    }

    if (expectedSize > downloadReliableMaxMergeBytes) {
      window.open(url, "_blank", "noopener,noreferrer");
      setStatus("文件较大，已切换浏览器直接下载（避免内存占用过高）");
      return;
    }

    const totalChunks = Math.ceil(expectedSize / downloadChunkBytes);
    const blobs = [];
    let downloadedBytes = 0;
    let resolvedName = fallbackName;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * downloadChunkBytes;
      const end = Math.min(expectedSize - 1, start + downloadChunkBytes - 1);
      const chunk = await fetchRangeBlobWithRetry(url, start, end);
      if (chunk.fileName) resolvedName = chunk.fileName;
      if (chunk.status === 200 && chunkIndex === 0) {
        triggerBlobDownload(chunk.blob, resolvedName);
        setStatus(`下载已开始：${resolvedName}`);
        return;
      }

      const expectedChunkSize = end - start + 1;
      if (chunk.blob.size !== expectedChunkSize) {
        throw new Error(`分片大小不一致：第 ${chunkIndex + 1}/${totalChunks} 片`);
      }
      blobs.push(chunk.blob);
      downloadedBytes += chunk.blob.size;
      const percent = Math.min(100, Math.round((downloadedBytes / expectedSize) * 100));
      setStatus(`下载中 ${chunkIndex + 1}/${totalChunks}（${percent}%）`);
    }

    const merged = new Blob(blobs, { type: String(item?.mime || "application/octet-stream") });
    triggerBlobDownload(merged, resolvedName);
    setStatus(`下载已开始：${resolvedName}`);
  } catch (error) {
    handleRequestError(error, "下载失败");
  }
}

async function fetchRangeBlobWithRetry(url, start, end) {
  let lastError = null;
  for (let attempt = 1; attempt <= downloadRetryMaxAttempts; attempt += 1) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Range: `bytes=${start}-${end}`
        }
      });
      if (!resp.ok) {
        const data = await readMaybeJson(resp);
        throw makeRequestError(resp.status, data?.error || `下载失败（${resp.status}）`, data?.login);
      }
      const blob = await resp.blob();
      return {
        status: resp.status,
        blob,
        fileName: parseDownloadFileName(resp.headers.get("content-disposition")) || ""
      };
    } catch (error) {
      lastError = error;
      if (!isRetriableDownloadError(error) || attempt >= downloadRetryMaxAttempts) break;
      await wait(downloadRetryDelaysMs[Math.min(attempt - 1, downloadRetryDelaysMs.length - 1)]);
    }
  }
  throw lastError || new Error("下载失败");
}

async function fetchBlobWithRetry(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= downloadRetryMaxAttempts; attempt += 1) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!resp.ok) {
        const data = await readMaybeJson(resp);
        throw makeRequestError(resp.status, data?.error || `下载失败（${resp.status}）`, data?.login);
      }
      const blob = await resp.blob();
      return {
        blob,
        fileName: parseDownloadFileName(resp.headers.get("content-disposition")) || ""
      };
    } catch (error) {
      lastError = error;
      if (!isRetriableDownloadError(error) || attempt >= downloadRetryMaxAttempts) break;
      await wait(downloadRetryDelaysMs[Math.min(attempt - 1, downloadRetryDelaysMs.length - 1)]);
    }
  }
  throw lastError || new Error("下载失败");
}

function isRetriableDownloadError(error) {
  const status = Number(error?.status || 0);
  if (!status) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

async function fetchWithRetry(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= downloadRetryMaxAttempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt >= downloadRetryMaxAttempts) break;
      await wait(downloadRetryDelaysMs[Math.min(attempt - 1, downloadRetryDelaysMs.length - 1)]);
    }
  }
  throw lastError || new Error("网络连接失败");
}

async function previewItem(item) {
  const previewType = resolvePreviewType(item);
  if (previewType === "none") {
    setStatus("该文件类型暂不支持在线预览", true);
    return;
  }
  state.previewPath = item.path || "";
  state.previewCollapsed = false;
  state.previewMode = "loading";
  state.previewEmptyMessage = "正在加载预览...";
  renderPreviewVisibility();
  nodes.previewMeta.textContent = `正在加载：${item.path}`;

  if (previewType === "image") {
    const previewUrl = `/api/files/preview?path=${encodeURIComponent(item.path)}&t=${Date.now()}`;
    nodes.previewImage.onload = () => {
      state.previewMode = "image";
      nodes.previewMeta.textContent = `${item.path} · 图片`;
      renderPreviewVisibility();
      setStatus("图片预览已加载");
    };
    nodes.previewImage.onerror = () => {
      resetPreview("图片预览失败");
      setStatus("图片预览失败", true);
    };
    nodes.previewImage.src = previewUrl;
    return;
  }

  if (previewType === "pdf") {
    const previewUrl = `/api/files/preview?path=${encodeURIComponent(item.path)}&t=${Date.now()}`;
    nodes.previewPdf.onload = () => {
      state.previewMode = "pdf";
      nodes.previewMeta.textContent = `${item.path} · PDF`;
      renderPreviewVisibility();
      setStatus("PDF 预览已加载");
    };
    nodes.previewPdf.onerror = () => {
      resetPreview("PDF 预览失败");
      setStatus("PDF 预览失败", true);
    };
    nodes.previewPdf.src = previewUrl;
    return;
  }

  try {
    const data = await requestJson(`/api/files/preview?path=${encodeURIComponent(item.path)}`);
    state.previewMode = "text";
    nodes.previewText.textContent = String(data.content || "");
    nodes.previewMeta.textContent = `${item.path} · 文本${data.truncated ? "（已截断）" : ""}`;
    renderPreviewVisibility();
    setStatus(`文本预览已加载${data.truncated ? "（已截断）" : ""}`);
  } catch (error) {
    handleRequestError(error, "文本预览失败");
    resetPreview("文本预览失败");
  }
}

function resolvePreviewType(item) {
  const declared = String(item?.previewType || "").trim().toLowerCase();
  if (declared === "image" || declared === "text" || declared === "pdf") return declared;
  const ext = String(item?.ext || "").trim().toLowerCase();
  if (imagePreviewExts.has(ext)) return "image";
  if (pdfPreviewExts.has(ext)) return "pdf";
  if (textPreviewExts.has(ext)) return "text";
  const mime = String(item?.mime || "").trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || mime.includes("json")) return "text";
  if (mime.startsWith("image/")) return "image";
  return "none";
}

function resetPreview(message = "未选择文件") {
  state.previewPath = "";
  state.previewMode = "empty";
  state.previewCollapsed = false;
  state.previewEmptyMessage = "点击表格中的“预览”查看 PDF、图片或文本。";
  nodes.previewMeta.textContent = message;
  nodes.previewText.textContent = "";
  nodes.previewImage.removeAttribute("src");
  nodes.previewPdf.removeAttribute("src");
  renderPreviewVisibility();
}

function hidePreviewPanels() {
  nodes.previewImageWrap.hidden = true;
  nodes.previewPdfWrap.hidden = true;
  nodes.previewTextWrap.hidden = true;
}

function renderPreviewVisibility() {
  hidePreviewPanels();
  nodes.previewEmpty.hidden = true;

  if (state.previewCollapsed) {
    nodes.previewEmpty.textContent = "预览已折叠，点击“展开预览”查看。";
    nodes.previewEmpty.hidden = false;
    refreshPreviewToggleButton();
    return;
  }

  if (state.previewMode === "image") {
    nodes.previewImageWrap.hidden = false;
    refreshPreviewToggleButton();
    return;
  }
  if (state.previewMode === "pdf") {
    nodes.previewPdfWrap.hidden = false;
    refreshPreviewToggleButton();
    return;
  }
  if (state.previewMode === "text") {
    nodes.previewTextWrap.hidden = false;
    refreshPreviewToggleButton();
    return;
  }

  nodes.previewEmpty.textContent = state.previewEmptyMessage || "点击表格中的“预览”查看 PDF、图片或文本。";
  nodes.previewEmpty.hidden = false;
  refreshPreviewToggleButton();
}

function refreshPreviewToggleButton() {
  const hasPreview = state.previewMode === "image" || state.previewMode === "pdf" || state.previewMode === "text";
  nodes.previewToggleBtn.disabled = !hasPreview;
  nodes.previewToggleBtn.textContent = state.previewCollapsed ? "展开预览" : "折叠预览";
}

async function openShareQr(item, mode) {
  const filePath = String(item?.path || "").trim();
  if (!filePath) {
    setStatus("文件路径为空，无法生成分享链接", true);
    return;
  }
  try {
    const data = await requestJson("/api/files/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, mode })
    });
    const rawLink = String(data?.share?.url || "").trim();
    if (!rawLink) {
      throw new Error("服务端未返回分享链接");
    }
    const link = new URL(rawLink, window.location.origin).toString();
    nodes.qrImage.src = `/api/auth/qr.svg?text=${encodeURIComponent(link)}`;
    nodes.qrLink.textContent = link;
    nodes.qrLink.dataset.url = link;
    nodes.qrDialog.showModal();
    setStatus(mode === "one_time" ? "一次性链接已生成（首次下载后失效）" : "永久链接已生成");
  } catch (error) {
    handleRequestError(error, "生成分享链接失败");
  }
}

function setStatus(message, isError = false) {
  nodes.status.textContent = `状态：${message}`;
  nodes.status.style.color = isError ? "#b42323" : "";
}

function handleRequestError(error, fallback) {
  if (error?.status === 401 && error?.login) {
    window.location.href = error.login;
    return;
  }
  setStatus(error?.message || fallback, true);
}

async function requestJson(url, options = {}) {
  const resp = await fetch(url, options);
  const data = await readMaybeJson(resp);
  if (!resp.ok) {
    throw makeRequestError(resp.status, data?.error || `请求失败（${resp.status}）`, data?.login);
  }
  return data || {};
}

async function readMaybeJson(resp) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { error: text };
  }
}

function makeRequestError(status, message, login) {
  const error = new Error(message || "请求失败");
  error.status = status;
  error.login = login || "";
  return error;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "download.bin";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseDownloadFileName(contentDisposition) {
  const value = String(contentDisposition || "");
  if (!value) return "";
  const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch (_error) {
      return utfMatch[1];
    }
  }
  const plainMatch = value.match(/filename=\"?([^\";]+)\"?/i);
  return plainMatch?.[1] || "";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}
