const state = {
  maxUploadBytes: 0,
  chunkBytes: 8 * 1024 * 1024,
  root: "",
  results: [],
  dragDepth: 0,
  uploadProgress: {
    active: false,
    totalFiles: 0,
    totalBytes: 0,
    completedBytes: 0,
    currentLoadedBytes: 0
  }
};
const uploadRetryMaxAttempts = 4;
const uploadRetryDelaysMs = [800, 1600, 2800];

const nodes = {
  currentUser: document.getElementById("current-user"),
  shareRoot: document.getElementById("share-root"),
  uploadLimit: document.getElementById("upload-limit"),
  dropZone: document.getElementById("drop-zone"),
  dropHint: document.getElementById("drop-hint"),
  uploadInput: document.getElementById("upload-input"),
  status: document.getElementById("status"),
  uploadProgressPanel: document.getElementById("upload-progress-panel"),
  progressLabel: document.getElementById("progress-label"),
  progressPercent: document.getElementById("progress-percent"),
  progressFill: document.getElementById("progress-fill"),
  progressDetail: document.getElementById("progress-detail"),
  resultBody: document.getElementById("result-body"),
  clearResultBtn: document.getElementById("clear-result-btn")
};

init();

async function init() {
  bindEvents();
  await loadInfo();
  renderResults();
}

function bindEvents() {
  nodes.uploadInput.addEventListener("change", async () => {
    const files = Array.from(nodes.uploadInput.files || []);
    if (!files.length) return;
    await uploadFiles(files);
    nodes.uploadInput.value = "";
  });

  nodes.dropZone.addEventListener("click", () => nodes.uploadInput.click());
  nodes.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      nodes.uploadInput.click();
    }
  });
  nodes.dropZone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    state.dragDepth += 1;
    nodes.dropZone.classList.add("drag-over");
  });
  nodes.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  nodes.dropZone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) nodes.dropZone.classList.remove("drag-over");
  });
  nodes.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    state.dragDepth = 0;
    nodes.dropZone.classList.remove("drag-over");
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    void uploadFiles(files);
  });
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => {
    if (event.target !== nodes.dropZone && !nodes.dropZone.contains(event.target)) {
      event.preventDefault();
    }
  });

  nodes.clearResultBtn.addEventListener("click", () => {
    state.results = [];
    renderResults();
    setStatus("上传记录已清空");
  });
}

async function loadInfo() {
  try {
    const data = await requestJson("/api/files/info");
    state.root = data.root || "";
    state.maxUploadBytes = Number(data.maxUploadBytes || 0);
    state.chunkBytes = Math.max(256 * 1024, Number(data.chunkUpload?.chunkBytes || state.chunkBytes));
    nodes.shareRoot.textContent = state.root || "-";
    nodes.uploadLimit.textContent = "不限制（分片上传）";
    const userLabel = data.user?.email ? `${data.user.email} (${data.user.role})` : data.user?.role || "已登录";
    nodes.currentUser.textContent = userLabel;
    nodes.dropHint.textContent = `支持分片上传，默认分片大小 ${formatBytes(state.chunkBytes)}。可自动重试分片，提升大文件上传成功率。`;
  } catch (error) {
    handleRequestError(error, "读取上传配置失败");
  }
}

async function uploadFiles(files) {
  let success = 0;
  let failed = 0;
  initUploadProgress(files);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const fileSize = Number(file.size || 0);
    const fileIndex = index + 1;

    setStatus(`上传中 ${fileIndex}/${files.length}：${file.name}`);
    updateUploadProgress({
      fileName: file.name,
      fileIndex,
      totalFiles: files.length,
      loadedBytes: 0
    });
    try {
      const data = await uploadSingleFileWithRetry(file, {
        index: fileIndex,
        total: files.length,
        onProgress: ({ loadedBytes }) => {
          updateUploadProgress({
            fileName: file.name,
            fileIndex,
            totalFiles: files.length,
            loadedBytes
          });
        }
      });
      success += 1;
      pushResult({
        name: file.name,
        size: fileSize,
        ok: true,
        message: "上传成功",
        path: data.file?.path || ""
      });
    } catch (error) {
      failed += 1;
      pushResult({
        name: file.name,
        size: fileSize,
        ok: false,
        message: error?.message || "上传失败"
      });
    } finally {
      finishCurrentFileProgress(fileSize);
    }
  }

  renderResults();
  completeUploadProgress();
  if (failed) {
    setStatus(`上传完成：成功 ${success} 个，失败 ${failed} 个`, true);
  } else {
    setStatus(`上传完成：成功 ${success} 个`);
  }
}

async function uploadSingleFileWithRetry(file, meta = {}) {
  const totalBytes = Math.max(0, Number(file?.size || 0));
  const startPayload = {
    name: String(file?.name || "upload.bin"),
    size: totalBytes,
    chunkBytes: state.chunkBytes
  };
  const startData = await requestJsonWithRetry("/api/files/upload/chunk/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(startPayload)
  });
  const uploadId = String(startData?.uploadId || "").trim();
  const chunkBytes = Math.max(256 * 1024, Number(startData?.chunkBytes || state.chunkBytes));
  const totalChunks = Math.max(1, Number(startData?.totalChunks || Math.ceil(totalBytes / chunkBytes)));
  if (!uploadId) {
    throw new Error("分片上传初始化失败：缺少 uploadId");
  }

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * chunkBytes;
    const end = Math.min(totalBytes, start + chunkBytes);
    const chunkBlob = file.slice(start, end);
    await uploadChunkWithRetry(uploadId, chunkIndex, totalChunks, chunkBlob, {
      onProgress: (loaded) => {
        if (typeof meta.onProgress === "function") {
          meta.onProgress({
            loadedBytes: Math.min(totalBytes, start + Math.max(0, Number(loaded || 0))),
            totalBytes
          });
        }
      },
      fileName: file.name,
      fileIndex: meta.index || 1,
      fileTotal: meta.total || 1
    });
  }

  const finishData = await requestJsonWithRetry("/api/files/upload/chunk/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId })
  });
  if (!finishData?.file?.path) {
    throw new Error("服务端未返回文件路径（可能被登录页或网关拦截）");
  }
  return finishData;
}

async function uploadChunkWithRetry(uploadId, chunkIndex, totalChunks, chunkBlob, meta = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= uploadRetryMaxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        setStatus(
          `重试分片(${attempt}/${uploadRetryMaxAttempts}) 文件${meta.fileIndex || 1}/${meta.fileTotal || 1} 第 ${chunkIndex + 1}/${totalChunks} 片`
        );
      }
      await requestChunkPartWithProgress(
        `/api/files/upload/chunk/part?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}`,
        chunkBlob,
        (loaded) => {
          if (typeof meta.onProgress === "function") meta.onProgress(loaded);
        }
      );
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableUploadError(error) || attempt >= uploadRetryMaxAttempts) {
        break;
      }
      await wait(uploadRetryDelaysMs[Math.min(attempt - 1, uploadRetryDelaysMs.length - 1)]);
    }
  }
  const message = String(lastError?.message || "分片上传失败");
  throw new Error(`上传失败（第 ${chunkIndex + 1}/${totalChunks} 片，已重试 ${uploadRetryMaxAttempts - 1} 次）：${message}`);
}

function isRetriableUploadError(error) {
  const status = Number(error?.status || 0);
  if (!status) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function pushResult(item) {
  state.results.unshift({
    name: String(item.name || ""),
    size: Number(item.size || 0),
    ok: !!item.ok,
    message: String(item.message || ""),
    path: String(item.path || ""),
    ts: Date.now()
  });
  if (state.results.length > 300) {
    state.results = state.results.slice(0, 300);
  }
}

function renderResults() {
  nodes.resultBody.innerHTML = "";
  if (!state.results.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "暂无上传记录";
    row.appendChild(cell);
    nodes.resultBody.appendChild(row);
    return;
  }

  state.results.forEach((item) => {
    const row = document.createElement("tr");
    row.appendChild(makeCell(item.name || "(未命名)"));
    row.appendChild(makeCell(formatBytes(item.size)));

    const statusCell = document.createElement("td");
    const statusText = document.createElement("span");
    statusText.className = item.ok ? "status-ok" : "status-error";
    statusText.textContent = item.ok ? "成功" : "失败";
    statusCell.appendChild(statusText);
    if (item.message) {
      const detail = document.createElement("div");
      detail.textContent = ` · ${item.message}`;
      detail.style.display = "inline";
      statusCell.appendChild(detail);
    }
    row.appendChild(statusCell);

    const pathCell = document.createElement("td");
    pathCell.className = "path-cell";
    if (item.path) {
      const link = document.createElement("a");
      link.href = "./files.html";
      link.textContent = item.path;
      link.style.color = "#245a9a";
      pathCell.appendChild(link);
    } else {
      pathCell.textContent = "-";
    }
    row.appendChild(pathCell);

    nodes.resultBody.appendChild(row);
  });
}

function makeCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
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

function requestChunkPartWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.responseType = "text";
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.timeout = 120000;

    xhr.upload.onprogress = (event) => {
      const loadedBytes = Number(event.loaded || 0);
      const totalBytes = event.lengthComputable ? Number(event.total || 0) : Number(file?.size || 0);
      if (typeof onProgress === "function") {
        onProgress(loadedBytes, totalBytes);
      }
    };

    xhr.onerror = () => reject(makeRequestError(0, "网络连接失败"));
    xhr.ontimeout = () => reject(makeRequestError(408, "上传超时"));
    xhr.onabort = () => reject(makeRequestError(499, "上传已取消"));
    xhr.onload = () => {
      const text = String(xhr.responseText || "").trim();
      const data = parseJsonSafe(text);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(makeRequestError(xhr.status, data?.error || `请求失败（${xhr.status}）`, data?.login));
        return;
      }
      resolve(data || {});
    };

    xhr.send(file);
  });
}

async function requestJson(url, options = {}) {
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (error) {
    throw makeRequestError(0, error?.message || "网络连接失败");
  }
  const data = await readMaybeJson(resp);
  if (!resp.ok) {
    throw makeRequestError(resp.status, data?.error || `请求失败（${resp.status}）`, data?.login);
  }
  return data || {};
}

async function requestJsonWithRetry(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= uploadRetryMaxAttempts; attempt += 1) {
    try {
      return await requestJson(url, options);
    } catch (error) {
      lastError = error;
      if (!isRetriableUploadError(error) || attempt >= uploadRetryMaxAttempts) {
        break;
      }
      await wait(uploadRetryDelaysMs[Math.min(attempt - 1, uploadRetryDelaysMs.length - 1)]);
    }
  }
  throw lastError || new Error("请求失败");
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

function parseJsonSafe(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (_error) {
    return { error: source };
  }
}

function makeRequestError(status, message, login) {
  const error = new Error(message || "请求失败");
  error.status = status;
  error.login = login || "";
  return error;
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

function initUploadProgress(files) {
  const list = Array.isArray(files) ? files : [];
  const totalBytes = list.reduce((sum, file) => sum + Math.max(0, Number(file?.size || 0)), 0);
  state.uploadProgress = {
    active: list.length > 0,
    totalFiles: list.length,
    totalBytes,
    completedBytes: 0,
    currentLoadedBytes: 0
  };
  nodes.uploadProgressPanel.hidden = !list.length;
  nodes.progressFill.style.width = "0%";
  nodes.progressPercent.textContent = "0%";
  nodes.progressLabel.textContent = "上传进度";
  nodes.progressDetail.textContent = `0 B / ${formatBytes(totalBytes)}`;
}

function updateUploadProgress({ fileName, fileIndex, totalFiles, loadedBytes }) {
  if (!state.uploadProgress.active) return;
  state.uploadProgress.currentLoadedBytes = Math.max(0, Number(loadedBytes || 0));
  const uploaded = Math.min(
    state.uploadProgress.totalBytes,
    state.uploadProgress.completedBytes + state.uploadProgress.currentLoadedBytes
  );
  const total = Math.max(0, state.uploadProgress.totalBytes);
  const percent = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 100;
  nodes.progressLabel.textContent = `正在上传 ${fileIndex || 1}/${totalFiles || state.uploadProgress.totalFiles}：${fileName || "文件"}`;
  nodes.progressPercent.textContent = `${percent}%`;
  nodes.progressFill.style.width = `${percent}%`;
  nodes.progressDetail.textContent = `${formatBytes(uploaded)} / ${formatBytes(total)}`;
}

function finishCurrentFileProgress(fileSize) {
  if (!state.uploadProgress.active) return;
  state.uploadProgress.completedBytes = Math.min(
    state.uploadProgress.totalBytes,
    state.uploadProgress.completedBytes + Math.max(0, Number(fileSize || 0))
  );
  state.uploadProgress.currentLoadedBytes = 0;
  const total = Math.max(0, state.uploadProgress.totalBytes);
  const percent = total > 0 ? Math.min(100, Math.round((state.uploadProgress.completedBytes / total) * 100)) : 100;
  nodes.progressPercent.textContent = `${percent}%`;
  nodes.progressFill.style.width = `${percent}%`;
  nodes.progressDetail.textContent = `${formatBytes(state.uploadProgress.completedBytes)} / ${formatBytes(total)}`;
}

function completeUploadProgress() {
  if (!state.uploadProgress.active) return;
  nodes.progressLabel.textContent = "上传完成";
  nodes.progressPercent.textContent = "100%";
  nodes.progressFill.style.width = "100%";
  nodes.progressDetail.textContent = `${formatBytes(state.uploadProgress.totalBytes)} / ${formatBytes(state.uploadProgress.totalBytes)}`;
  setTimeout(() => {
    nodes.uploadProgressPanel.hidden = true;
  }, 1200);
  state.uploadProgress.active = false;
}
