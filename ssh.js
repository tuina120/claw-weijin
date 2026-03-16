const STORAGE_KEY = "openclaw_ssh_tool_v3";
const REGION_TAGS = ["香港", "日本", "美国", "新加坡", "韩国", "欧洲", "台湾"];
const ENV_TAGS = ["生产", "测试", "预发", "开发"];
const PRESET_GROUPS = [
  {
    title: "系统巡检",
    items: [
      { title: "主机名 + 运行时长", desc: "确认在线与负载", command: "hostname && echo '---' && uptime" },
      { title: "CPU / 内存 / 磁盘", desc: "适合做日常健康巡检", command: "echo '[load]' && uptime && echo '\n[df]' && df -h && echo '\n[mem]' && free -m" },
      { title: "Top 进程", desc: "快速看资源占用", command: "ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%cpu | head -n 15" }
    ]
  },
  {
    title: "网络与安全",
    items: [
      { title: "监听端口", desc: "排查服务是否监听", command: "ss -lntup" },
      { title: "防火墙状态", desc: "查看 ufw / iptables", command: "(ufw status verbose 2>/dev/null || true) && echo '\n---\n' && (iptables -L -n 2>/dev/null | head -n 80 || true)" },
      { title: "最近登录记录", desc: "看异常登录痕迹", command: "last -a | head -n 20" }
    ]
  },
  {
    title: "服务与日志",
    items: [
      { title: "失败服务", desc: "systemd 失败单元", command: "systemctl --failed --no-pager" },
      { title: "最近错误日志", desc: "journalctl 错误级别", command: "journalctl -p err -n 120 --no-pager" },
      { title: "Nginx 状态", desc: "Web 服务基本检查", command: "systemctl status nginx --no-pager -n 40 || service nginx status || true" }
    ]
  },
  {
    title: "容器与部署",
    items: [
      { title: "Docker 容器", desc: "查看容器运行情况", command: "docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null || echo 'docker not found'" },
      { title: "Docker 资源占用", desc: "查看镜像与卷", command: "docker system df 2>/dev/null || echo 'docker not found'" },
      { title: "待升级软件包", desc: "升级前先看范围", command: "apt update >/dev/null 2>&1 && apt list --upgradable 2>/dev/null | sed -n '1,80p'" }
    ]
  }
];

const nodes = {
  reloadBtn: document.getElementById("ssh-reload-btn"),
  saveBtn: document.getElementById("ssh-save-btn"),
  configPath: document.getElementById("ssh-config-path"),
  binaryStatus: document.getElementById("ssh-binary-status"),
  tokenWrap: document.getElementById("ssh-token-wrap"),
  token: document.getElementById("ssh-token"),
  defaultConnectTimeout: document.getElementById("ssh-default-connect-timeout"),
  defaultCommandTimeout: document.getElementById("ssh-default-command-timeout"),
  search: document.getElementById("ssh-search-input"),
  groupFilters: document.getElementById("ssh-group-filters"),
  selectAllBtn: document.getElementById("ssh-select-all-btn"),
  clearSelectBtn: document.getElementById("ssh-clear-select-btn"),
  newHostBtn: document.getElementById("ssh-new-host-btn"),
  hostSummary: document.getElementById("ssh-host-summary"),
  hostGroups: document.getElementById("ssh-host-groups"),
  hostId: document.getElementById("ssh-host-id"),
  hostName: document.getElementById("ssh-host-name"),
  hostHost: document.getElementById("ssh-host-host"),
  hostUser: document.getElementById("ssh-host-user"),
  hostAuthMode: document.getElementById("ssh-host-auth-mode"),
  hostPort: document.getElementById("ssh-host-port"),
  hostIdentityFile: document.getElementById("ssh-host-identity-file"),
  hostPrivateKeyText: document.getElementById("ssh-host-private-key-text"),
  hostPublicKeyText: document.getElementById("ssh-host-public-key-text"),
  hostPassword: document.getElementById("ssh-host-password"),
  hostPasswordToggle: document.getElementById("ssh-host-password-toggle"),
  hostSessionPassword: document.getElementById("ssh-host-session-password"),
  hostSessionPasswordToggle: document.getElementById("ssh-host-session-password-toggle"),
  hostTags: document.getElementById("ssh-host-tags"),
  hostNotes: document.getElementById("ssh-host-notes"),
  hostEnabled: document.getElementById("ssh-host-enabled"),
  testHostBtn: document.getElementById("ssh-test-host-btn"),
  checkHostKeyBtn: document.getElementById("ssh-check-host-key-btn"),
  distributeHostKeyBtn: document.getElementById("ssh-distribute-host-key-btn"),
  distributeSelectedHostKeyBtn: document.getElementById("ssh-distribute-selected-host-key-btn"),
  saveHostBtn: document.getElementById("ssh-save-host-btn"),
  deleteHostBtn: document.getElementById("ssh-delete-host-btn"),
  importText: document.getElementById("ssh-import-text"),
  importBtn: document.getElementById("ssh-import-btn"),
  presetGroups: document.getElementById("ssh-preset-groups"),
  concurrency: document.getElementById("ssh-concurrency"),
  runConnectTimeout: document.getElementById("ssh-run-connect-timeout"),
  runCommandTimeout: document.getElementById("ssh-run-command-timeout"),
  commandInput: document.getElementById("ssh-command-input"),
  uploadRemotePath: document.getElementById("ssh-upload-remote-path"),
  uploadFile: document.getElementById("ssh-upload-file"),
  uploadFileName: document.getElementById("ssh-upload-file-name"),
  uploadBtn: document.getElementById("ssh-upload-btn"),
  downloadRemotePath: document.getElementById("ssh-download-remote-path"),
  downloadBtn: document.getElementById("ssh-download-btn"),
  downloadHint: document.getElementById("ssh-download-hint"),
  transferStatus: document.getElementById("ssh-transfer-status"),
  remotePath: document.getElementById("ssh-remote-path"),
  remoteRefreshBtn: document.getElementById("ssh-remote-refresh-btn"),
  remoteUpBtn: document.getElementById("ssh-remote-up-btn"),
  remoteUseUploadBtn: document.getElementById("ssh-remote-use-upload-btn"),
  remoteNewFolderName: document.getElementById("ssh-remote-new-folder-name"),
  remoteNewFolderBtn: document.getElementById("ssh-remote-new-folder-btn"),
  remoteNewFileName: document.getElementById("ssh-remote-new-file-name"),
  remoteNewFileBtn: document.getElementById("ssh-remote-new-file-btn"),
  remoteSelectAllBtn: document.getElementById("ssh-remote-select-all-btn"),
  remoteClearSelectBtn: document.getElementById("ssh-remote-clear-select-btn"),
  remoteDownloadSelectedBtn: document.getElementById("ssh-remote-download-selected-btn"),
  remoteArchiveSelectedBtn: document.getElementById("ssh-remote-archive-selected-btn"),
  remoteDeleteSelectedBtn: document.getElementById("ssh-remote-delete-selected-btn"),
  remoteArchiveName: document.getElementById("ssh-remote-archive-name"),
  remoteAutoRename: document.getElementById("ssh-remote-auto-rename"),
  remoteMoveTarget: document.getElementById("ssh-remote-move-target"),
  remoteMoveSelectedBtn: document.getElementById("ssh-remote-move-selected-btn"),
  remoteCopyTarget: document.getElementById("ssh-remote-copy-target"),
  remoteCopySelectedBtn: document.getElementById("ssh-remote-copy-selected-btn"),
  remoteFilesStatus: document.getElementById("ssh-remote-files-status"),
  remoteFilesMeta: document.getElementById("ssh-remote-files-meta"),
  remoteFiles: document.getElementById("ssh-remote-files"),
  remoteEditorStatus: document.getElementById("ssh-remote-editor-status"),
  remoteEditorPath: document.getElementById("ssh-remote-editor-path"),
  remoteEditorText: document.getElementById("ssh-remote-editor-text"),
  remoteEditorSearch: document.getElementById("ssh-remote-editor-search"),
  remoteEditorReplace: document.getElementById("ssh-remote-editor-replace"),
  remoteEditorRegex: document.getElementById("ssh-remote-editor-regex"),
  remoteEditorCaseSensitive: document.getElementById("ssh-remote-editor-case-sensitive"),
  remoteEditorWholeWord: document.getElementById("ssh-remote-editor-whole-word"),
  remoteEditorMatchStatus: document.getElementById("ssh-remote-editor-match-status"),
  remoteEditorFindNextBtn: document.getElementById("ssh-remote-editor-find-next-btn"),
  remoteEditorReplaceBtn: document.getElementById("ssh-remote-editor-replace-btn"),
  remoteEditorReplaceAllBtn: document.getElementById("ssh-remote-editor-replace-all-btn"),
  remoteEditorReloadBtn: document.getElementById("ssh-remote-editor-reload-btn"),
  remoteEditorSaveBtn: document.getElementById("ssh-remote-editor-save-btn"),
  remoteEditorCloseBtn: document.getElementById("ssh-remote-editor-close-btn"),
  publicKeyPath: document.getElementById("ssh-public-key-path"),
  publicKeyText: document.getElementById("ssh-public-key-text"),
  loadPublicKeyBtn: document.getElementById("ssh-load-public-key-btn"),
  distributeKeyBtn: document.getElementById("ssh-distribute-key-btn"),
  keyStatus: document.getElementById("ssh-key-status"),
  runBtn: document.getElementById("ssh-run-btn"),
  copyFailedIpsBtn: document.getElementById("ssh-copy-failed-ips-btn"),
  copyFailedDetailsBtn: document.getElementById("ssh-copy-failed-details-btn"),
  exportFailedTxtBtn: document.getElementById("ssh-export-failed-txt-btn"),
  exportFailedMdBtn: document.getElementById("ssh-export-failed-md-btn"),
  rerunFailedBtn: document.getElementById("ssh-rerun-failed-btn"),
  rerunTimeoutBtn: document.getElementById("ssh-rerun-timeout-btn"),
  clearResultsBtn: document.getElementById("ssh-clear-results-btn"),
  exportJsonBtn: document.getElementById("ssh-export-json-btn"),
  exportCsvBtn: document.getElementById("ssh-export-csv-btn"),
  exportMdBtn: document.getElementById("ssh-export-md-btn"),
  failOnlyToggle: document.getElementById("ssh-fail-only-toggle"),
  statusText: document.getElementById("ssh-status-text"),
  resultSummary: document.getElementById("ssh-result-summary"),
  summaryCards: document.getElementById("ssh-summary-cards"),
  summaryRegion: document.getElementById("ssh-summary-region"),
  summaryEnv: document.getElementById("ssh-summary-env"),
  results: document.getElementById("ssh-results")
};

const state = {
  config: createEmptyConfig(),
  selectedIds: new Set(),
  activeHostId: "",
  activeFilter: "all",
  sshAvailable: false,
  scpAvailable: false,
  tokenRequired: false,
  configPath: "",
  results: [],
  running: false,
  transferRunning: false,
  keyRunning: false,
  uploadFile: null,
  lastAction: "命令执行",
  failOnly: false,
  sessionPasswords: {},
  pendingPrivateKeys: {},
  lastReplay: null,
  lastRetryCount: 0,
  remoteSelections: new Set(),
  remoteFiles: {
    hostId: "",
    cwd: "",
    parent: "",
    entries: [],
    loading: false
  },
  remoteEditor: {
    hostId: "",
    path: "",
    content: "",
    originalContent: "",
    size: 0,
    mtimeSec: 0,
    loading: false,
    saving: false
  }
};

init();

function init() {
  restoreState();
  wireEvents();
  renderPresetGroups();
  renderAll();
  void loadConfig();
}

function createEmptyConfig() {
  return {
    version: 1,
    updatedAt: "",
    defaults: {
      connectTimeoutSec: 8,
      commandTimeoutMs: 20000
    },
    hosts: []
  };
}

function wireEvents() {
  nodes.reloadBtn.addEventListener("click", () => void loadConfig(true));
  nodes.saveBtn.addEventListener("click", () => void saveConfig());
  nodes.newHostBtn.addEventListener("click", () => {
    startNewHost();
    renderHostEditor();
    renderTransferHints();
  });
  nodes.testHostBtn.addEventListener("click", () => void testActiveHostConnection());
  nodes.checkHostKeyBtn.addEventListener("click", () => void checkHostPublicKey());
  nodes.distributeHostKeyBtn.addEventListener("click", () => void distributeHostPublicKey());
  nodes.distributeSelectedHostKeyBtn.addEventListener("click", () => void distributeSelectedFromHostEditor());
  nodes.saveHostBtn.addEventListener("click", () => {
    try {
      upsertHostFromForm();
      renderAll();
      setStatus("状态：当前主机已加入待保存列表");
    } catch (error) {
      setStatus(`状态：${error.message}`);
    }
  });
  nodes.deleteHostBtn.addEventListener("click", () => {
    removeActiveHost();
    renderAll();
  });
  nodes.importBtn.addEventListener("click", () => {
    try {
      importHosts();
    } catch (error) {
      setStatus(`状态：导入失败：${error.message}`);
    }
  });
  nodes.search.addEventListener("input", () => {
    saveState();
    renderGroupFilters();
    renderHostGroups();
  });
  nodes.selectAllBtn.addEventListener("click", () => {
    getVisibleHosts().forEach((host) => state.selectedIds.add(host.id));
    saveState();
    renderHostGroups();
  });
  nodes.clearSelectBtn.addEventListener("click", () => {
    state.selectedIds.clear();
    saveState();
    renderHostGroups();
  });
  nodes.defaultConnectTimeout.addEventListener("change", applyDefaultsFromInputs);
  nodes.defaultCommandTimeout.addEventListener("change", applyDefaultsFromInputs);
  nodes.hostPasswordToggle.addEventListener("click", () => togglePasswordInput(nodes.hostPassword, nodes.hostPasswordToggle));
  nodes.hostSessionPasswordToggle.addEventListener("click", () => togglePasswordInput(nodes.hostSessionPassword, nodes.hostSessionPasswordToggle));
  nodes.hostSessionPassword.addEventListener("input", () => {
    const hostId = String(nodes.hostId.value || "").trim();
    if (!hostId) return;
    const value = String(nodes.hostSessionPassword.value || "");
    if (value) state.sessionPasswords[hostId] = value;
    else delete state.sessionPasswords[hostId];
  });
  nodes.token.addEventListener("input", saveState);
  nodes.concurrency.addEventListener("change", saveState);
  nodes.runConnectTimeout.addEventListener("change", saveState);
  nodes.runCommandTimeout.addEventListener("change", saveState);
  nodes.commandInput.addEventListener("input", saveState);
  nodes.uploadRemotePath.addEventListener("input", saveState);
  nodes.downloadRemotePath.addEventListener("input", saveState);
  nodes.remotePath.addEventListener("change", () => void loadRemoteFiles(nodes.remotePath.value.trim() || "~"));
  nodes.remoteRefreshBtn.addEventListener("click", () => void loadRemoteFiles(nodes.remotePath.value.trim() || state.remoteFiles.cwd || "~", { force: true }));
  nodes.remoteUpBtn.addEventListener("click", () => {
    const target = String(state.remoteFiles.parent || "").trim() || "~";
    void loadRemoteFiles(target, { force: true });
  });
  nodes.remoteUseUploadBtn.addEventListener("click", () => {
    const targetDir = ensureTrailingSlash(state.remoteFiles.cwd || nodes.remotePath.value || "~");
    nodes.uploadRemotePath.value = targetDir;
    saveState();
    setStatus(`状态：上传目标已切换到 ${targetDir}`);
  });
  nodes.remoteNewFolderBtn.addEventListener("click", () => void createRemoteFolder());
  nodes.remoteNewFolderName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void createRemoteFolder();
    }
  });
  nodes.remoteNewFileBtn.addEventListener("click", () => void createRemoteTextFile());
  nodes.remoteNewFileName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void createRemoteTextFile();
    }
  });
  nodes.remoteSelectAllBtn.addEventListener("click", () => {
    state.remoteFiles.entries.forEach((entry) => {
      state.remoteSelections.add(joinRemotePath(state.remoteFiles.cwd || "~", entry.name));
    });
    renderRemoteFiles();
  });
  nodes.remoteClearSelectBtn.addEventListener("click", () => {
    state.remoteSelections.clear();
    renderRemoteFiles();
  });
  nodes.remoteDownloadSelectedBtn.addEventListener("click", () => void downloadSelectedRemoteEntries());
  nodes.remoteArchiveSelectedBtn.addEventListener("click", () => void downloadSelectedRemoteArchive());
  nodes.remoteDeleteSelectedBtn.addEventListener("click", () => void deleteSelectedRemoteEntries());
  nodes.remoteArchiveName.addEventListener("input", saveState);
  nodes.remoteAutoRename.addEventListener("change", saveState);
  nodes.remoteMoveTarget.addEventListener("input", saveState);
  nodes.remoteMoveSelectedBtn.addEventListener("click", () => void moveSelectedRemoteEntries());
  nodes.remoteCopyTarget.addEventListener("input", saveState);
  nodes.remoteCopySelectedBtn.addEventListener("click", () => void copySelectedRemoteEntries());
  nodes.remoteEditorText.addEventListener("input", () => {
    state.remoteEditor.content = String(nodes.remoteEditorText.value || "");
    renderRemoteEditor();
  });
  nodes.remoteEditorSearch.addEventListener("input", () => renderRemoteEditor());
  nodes.remoteEditorRegex.addEventListener("change", () => renderRemoteEditor());
  nodes.remoteEditorCaseSensitive.addEventListener("change", () => renderRemoteEditor());
  nodes.remoteEditorWholeWord.addEventListener("change", () => renderRemoteEditor());
  nodes.remoteEditorSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findNextInRemoteEditor();
    }
  });
  nodes.remoteEditorReplace.addEventListener("input", () => renderRemoteEditor());
  nodes.remoteEditorFindNextBtn.addEventListener("click", () => findNextInRemoteEditor());
  nodes.remoteEditorReplaceBtn.addEventListener("click", () => replaceCurrentInRemoteEditor());
  nodes.remoteEditorReplaceAllBtn.addEventListener("click", () => replaceAllInRemoteEditor());
  nodes.remoteEditorReloadBtn.addEventListener("click", () => void reloadRemoteEditor());
  nodes.remoteEditorSaveBtn.addEventListener("click", () => void saveRemoteTextFile());
  nodes.remoteEditorCloseBtn.addEventListener("click", () => {
    if (!confirmRemoteEditorDiscard()) return;
    resetRemoteEditor();
    renderRemoteEditor();
  });
  nodes.publicKeyPath.addEventListener("input", saveState);
  nodes.publicKeyText.addEventListener("input", saveState);
  nodes.uploadFile.addEventListener("change", handleUploadFileChange);
  nodes.uploadBtn.addEventListener("click", () => void uploadFileToHosts());
  nodes.downloadBtn.addEventListener("click", () => void downloadFileFromHost());
  nodes.loadPublicKeyBtn.addEventListener("click", () => void loadPublicKey());
  nodes.distributeKeyBtn.addEventListener("click", () => void distributePublicKey());
  nodes.clearResultsBtn.addEventListener("click", () => {
    state.results = [];
    renderResults();
    renderSummary();
    setStatus("状态：结果已清空");
  });
  nodes.copyFailedIpsBtn.addEventListener("click", () => void copyFailedIps());
  nodes.copyFailedDetailsBtn.addEventListener("click", () => void copyFailedDetails());
  nodes.exportFailedTxtBtn.addEventListener("click", () => exportFailedDetails("txt"));
  nodes.exportFailedMdBtn.addEventListener("click", () => exportFailedDetails("md"));
  nodes.rerunFailedBtn.addEventListener("click", () => void rerunFailedHosts());
  nodes.rerunTimeoutBtn.addEventListener("click", () => void rerunTimedOutHosts());
  nodes.exportJsonBtn.addEventListener("click", () => exportResults("json"));
  nodes.exportCsvBtn.addEventListener("click", () => exportResults("csv"));
  nodes.exportMdBtn.addEventListener("click", () => exportResults("md"));
  nodes.failOnlyToggle.addEventListener("change", () => {
    state.failOnly = !!nodes.failOnlyToggle.checked;
    saveState();
    renderResults();
  });
  nodes.runBtn.addEventListener("click", () => void runCommand());
}

async function loadConfig(isManual = false) {
  try {
    const response = await fetch("/api/ssh/config", { headers: buildAuthHeaders() });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `读取失败（HTTP ${response.status}）`);
    state.config = normalizeClientConfig(payload.config);
    state.sshAvailable = !!payload.sshAvailable;
    state.scpAvailable = !!payload.scpAvailable;
    state.tokenRequired = !!payload.tokenRequired;
    state.configPath = String(payload.path || "");
    syncSelectionWithHosts();
    ensureActiveHost();
    renderAll();
    void loadRemoteFiles("~", { force: true });
    if (isManual) setStatus("状态：SSH 配置已刷新");
  } catch (error) {
    setStatus(`状态：读取 SSH 配置失败：${error.message}`);
  }
}

async function saveConfig() {
  try {
    applyDefaultsFromInputs();
    const response = await fetch("/api/ssh/config", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ config: state.config, privateKeys: state.pendingPrivateKeys })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `保存失败（HTTP ${response.status}）`);
    state.config = normalizeClientConfig(payload.config);
    state.pendingPrivateKeys = {};
    state.sshAvailable = !!payload.sshAvailable;
    state.scpAvailable = !!payload.scpAvailable;
    state.tokenRequired = !!payload.tokenRequired;
    state.configPath = String(payload.path || state.configPath || "");
    syncSelectionWithHosts();
    ensureActiveHost();
    renderAll();
    setStatus(`状态：已保存 ${state.config.hosts.length} 台主机`);
  } catch (error) {
    setStatus(`状态：保存 SSH 配置失败：${error.message}`);
  }
}

function normalizeClientConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = source.defaults && typeof source.defaults === "object" ? source.defaults : {};
  const hosts = Array.isArray(source.hosts)
    ? source.hosts.map((item) => normalizeClientHost(item)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    : [];
  return {
    version: 1,
    updatedAt: String(source.updatedAt || ""),
    defaults: {
      connectTimeoutSec: clampInt(defaults.connectTimeoutSec, 8, 1, 60),
      commandTimeoutMs: clampInt(defaults.commandTimeoutMs, 20000, 1000, 600000)
    },
    hosts
  };
}

function normalizeClientHost(input) {
  if (!input || typeof input !== "object") return null;
  const host = String(input.host || "").trim();
  if (!host) return null;
  const tags = normalizeTags(input.tags);
  const notes = String(input.notes || "").trim();
  const authMode = normalizeAuthMode(input.authMode, input.password, input.identityFile);
  return {
    id: String(input.id || createTempId()).trim(),
    name: String(input.name || host).trim(),
    host,
    user: String(input.user || "root").trim() || "root",
    port: clampInt(input.port, 22, 1, 65535),
    authMode,
    identityFile: String(input.identityFile || "").trim(),
    password: String(input.password || "").trim(),
    tags,
    notes,
    enabled: input.enabled !== false,
    group: resolveHostGrouping({ name: input.name, host, notes, tags })
  };
}

function normalizeAuthMode(rawMode, password, identityFile) {
  const value = String(rawMode || "").trim().toLowerCase();
  if (value === "key" || value === "password" || value === "auto") return value;
  if (String(password || "").trim() && String(identityFile || "").trim()) return "auto";
  if (String(password || "").trim()) return "password";
  return "key";
}

function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(/[\n,]/g);
  const out = [];
  const seen = new Set();
  list.forEach((item) => {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function resolveHostGrouping(host) {
  const haystack = [host.name, host.host, host.notes, ...(host.tags || [])].join(" ");
  const region = REGION_TAGS.find((tag) => haystack.includes(tag)) || "未分地区";
  const env = ENV_TAGS.find((tag) => haystack.includes(tag)) || "未分环境";
  return { region, env, key: `${region}|${env}`, label: `${region} / ${env}` };
}

function renderAll() {
  renderMeta();
  renderGroupFilters();
  renderHostGroups();
  renderHostEditor();
  renderTransferHints();
  renderPresetGroups();
  renderResults();
  renderSummary();
  renderRemoteFiles();
  renderRemoteEditor();
}

function renderMeta() {
  nodes.configPath.textContent = state.configPath || "-";
  nodes.binaryStatus.textContent = state.sshAvailable && state.scpAvailable ? "ssh / scp 已就绪" : state.sshAvailable ? "ssh 已就绪，scp 不可用" : "ssh 不可用";
  nodes.tokenWrap.classList.toggle("hidden", !state.tokenRequired);
  nodes.defaultConnectTimeout.value = String(state.config.defaults.connectTimeoutSec || 8);
  nodes.defaultCommandTimeout.value = String(state.config.defaults.commandTimeoutMs || 20000);
  if (!nodes.runConnectTimeout.value) nodes.runConnectTimeout.value = String(state.config.defaults.connectTimeoutSec || 8);
  if (!nodes.runCommandTimeout.value) nodes.runCommandTimeout.value = String(state.config.defaults.commandTimeoutMs || 20000);
}

function renderGroupFilters() {
  const counts = buildFilterCounts();
  const items = [{ key: "all", label: `全部 (${state.config.hosts.length})` }, ...counts];
  nodes.groupFilters.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-chip${state.activeFilter === item.key ? " active" : ""}`;
    button.textContent = item.label;
    button.addEventListener("click", () => {
      state.activeFilter = item.key;
      saveState();
      renderGroupFilters();
      renderHostGroups();
    });
    nodes.groupFilters.appendChild(button);
  });
}

function buildFilterCounts() {
  const buckets = new Map();
  state.config.hosts.forEach((host) => {
    [host.group.region, host.group.env].forEach((tag) => {
      if (!tag || tag.startsWith("未分")) return;
      buckets.set(tag, (buckets.get(tag) || 0) + 1);
    });
  });
  return Array.from(buckets.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([key, count]) => ({ key, label: `${key} (${count})` }));
}

function renderHostGroups() {
  const hosts = getVisibleHosts();
  nodes.hostGroups.innerHTML = "";
  nodes.hostSummary.textContent = `主机 ${state.config.hosts.length} 台，已选 ${state.selectedIds.size} 台，当前显示 ${hosts.length} 台`;
  if (!hosts.length) {
    nodes.hostGroups.innerHTML = `<div class="empty-state">没有匹配的主机。你可以换筛选，或者先新增主机。</div>`;
    return;
  }
  const grouped = new Map();
  hosts.forEach((host) => {
    if (!grouped.has(host.group.key)) grouped.set(host.group.key, { label: host.group.label, items: [] });
    grouped.get(host.group.key).items.push(host);
  });
  Array.from(grouped.values()).sort((a, b) => a.label.localeCompare(b.label, "zh-CN")).forEach((group) => {
    const section = document.createElement("section");
    section.className = "group-section";
    const head = document.createElement("div");
    head.className = "group-head";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = group.label;
    const meta = document.createElement("div");
    meta.className = "group-meta";
    meta.textContent = `${group.items.length} 台`;
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);
    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "btn btn-ghost small";
    selectBtn.textContent = "全选本组";
    selectBtn.addEventListener("click", () => {
      group.items.forEach((host) => state.selectedIds.add(host.id));
      saveState();
      renderHostGroups();
    });
    head.appendChild(titleWrap);
    head.appendChild(selectBtn);
    const hostList = document.createElement("div");
    hostList.className = "group-hosts";
    group.items.forEach((host) => hostList.appendChild(renderHostCard(host)));
    section.appendChild(head);
    section.appendChild(hostList);
    nodes.hostGroups.appendChild(section);
  });
}

function renderHostCard(host) {
  const item = document.createElement("div");
  item.className = `host-item${host.id === state.activeHostId ? " active" : ""}${host.enabled ? "" : " disabled"}`;
  const top = document.createElement("div");
  top.className = "host-top";
  const check = document.createElement("label");
  check.className = "host-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedIds.has(host.id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selectedIds.add(host.id);
    else state.selectedIds.delete(host.id);
    saveState();
    renderHostGroups();
  });
  const main = document.createElement("div");
  main.className = "host-main";
  main.innerHTML = `<div class="host-name"></div><div class="host-target"></div>`;
  main.querySelector(".host-name").textContent = host.name;
  main.querySelector(".host-target").textContent = `${host.user}@${host.host}:${host.port}  ${formatAuthModeLabel(host.authMode)}`;
  if (host.notes) {
    const note = document.createElement("div");
    note.className = "host-note";
    note.textContent = host.notes;
    main.appendChild(note);
  }
  check.appendChild(checkbox);
  check.appendChild(main);
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn btn-ghost small";
  editBtn.textContent = "编辑";
  editBtn.addEventListener("click", () => {
    state.activeHostId = host.id;
    saveState();
    renderHostGroups();
    renderHostEditor();
    renderTransferHints();
    void loadRemoteFiles(state.remoteFiles.hostId === host.id ? state.remoteFiles.cwd || "~" : "~", { force: true });
  });
  top.appendChild(check);
  top.appendChild(editBtn);
  item.appendChild(top);
  if (host.tags.length) {
    const tags = document.createElement("div");
    tags.className = "host-tags";
    host.tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "host-tag";
      chip.textContent = tag;
      tags.appendChild(chip);
    });
    item.appendChild(tags);
  }
  item.addEventListener("dblclick", () => {
    state.activeHostId = host.id;
    saveState();
    renderHostGroups();
    renderHostEditor();
    renderTransferHints();
    void loadRemoteFiles(state.remoteFiles.hostId === host.id ? state.remoteFiles.cwd || "~" : "~", { force: true });
  });
  return item;
}

function renderHostEditor() {
  const host = getActiveHost();
  nodes.hostId.value = host?.id || "";
  nodes.hostName.value = host?.name || "";
  nodes.hostHost.value = host?.host || "";
  nodes.hostUser.value = host?.user || "root";
  nodes.hostAuthMode.value = host?.authMode || "key";
  nodes.hostPort.value = String(host?.port || 22);
  nodes.hostIdentityFile.value = host?.identityFile || "";
  nodes.hostPrivateKeyText.value = host ? state.pendingPrivateKeys[host.id] || "" : "";
  nodes.hostPublicKeyText.value = "";
  nodes.hostPassword.value = host?.password || "";
  nodes.hostSessionPassword.value = host ? state.sessionPasswords[host.id] || "" : "";
  nodes.hostPassword.type = "password";
  nodes.hostSessionPassword.type = "password";
  nodes.hostPasswordToggle.textContent = "显示";
  nodes.hostSessionPasswordToggle.textContent = "显示";
  nodes.hostTags.value = host?.tags?.join(", ") || "";
  nodes.hostNotes.value = host?.notes || "";
  nodes.hostEnabled.checked = host ? host.enabled !== false : true;
  nodes.deleteHostBtn.disabled = !host;
  nodes.testHostBtn.disabled = false;
  nodes.checkHostKeyBtn.disabled = !host;
  nodes.distributeHostKeyBtn.disabled = !host;
  nodes.distributeSelectedHostKeyBtn.disabled = !state.selectedIds.size;
}

function renderTransferHints() {
  const activeHost = getActiveHost();
  nodes.downloadHint.textContent = activeHost ? `当前下载主机：${activeHost.name}（${activeHost.user}@${activeHost.host}:${activeHost.port}）` : "下载只支持当前编辑中的一台主机。";
  nodes.uploadFileName.textContent = state.uploadFile ? `已选文件：${state.uploadFile.name}` : "未选择文件";
  nodes.transferStatus.textContent = state.scpAvailable ? "上传到已选主机，下载从当前编辑主机拉取。" : "scp 不可用，暂时无法使用上传下载。";
  nodes.keyStatus.textContent = "把本机公钥一次性写入多台服务器的 ~/.ssh/authorized_keys。";
  if (!String(nodes.uploadRemotePath.value || "").trim() && state.remoteFiles.cwd) {
    nodes.uploadRemotePath.value = ensureTrailingSlash(state.remoteFiles.cwd);
  }
}

function renderPresetGroups() {
  nodes.presetGroups.innerHTML = "";
  PRESET_GROUPS.forEach((group) => {
    const wrap = document.createElement("section");
    wrap.className = "preset-group";
    const head = document.createElement("div");
    head.className = "section-head";
    const title = document.createElement("h3");
    title.textContent = group.title;
    head.appendChild(title);
    wrap.appendChild(head);
    const list = document.createElement("div");
    list.className = "preset-list";
    group.items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset-item";
      const titleEl = document.createElement("div");
      titleEl.className = "preset-title";
      titleEl.textContent = item.title;
      const descEl = document.createElement("div");
      descEl.className = "section-tip";
      descEl.textContent = item.desc;
      const cmdEl = document.createElement("pre");
      cmdEl.className = "preset-command";
      cmdEl.textContent = item.command;
      button.appendChild(titleEl);
      button.appendChild(descEl);
      button.appendChild(cmdEl);
      button.addEventListener("click", () => {
        nodes.commandInput.value = item.command;
        saveState();
        setStatus(`状态：已填入命令“${item.title}”`);
      });
      list.appendChild(button);
    });
    wrap.appendChild(list);
    nodes.presetGroups.appendChild(wrap);
  });
}

function renderResults() {
  nodes.results.innerHTML = "";
  nodes.failOnlyToggle.checked = !!state.failOnly;
  const failedItems = state.results.filter((item) => !item.ok && !item.skipped);
  const timedOutItems = failedItems.filter((item) => item.timedOut);
  nodes.copyFailedIpsBtn.disabled = !failedItems.length;
  nodes.copyFailedDetailsBtn.disabled = !failedItems.length;
  nodes.exportFailedTxtBtn.disabled = !failedItems.length;
  nodes.exportFailedMdBtn.disabled = !failedItems.length;
  nodes.rerunFailedBtn.disabled = !failedItems.length || !state.lastReplay || state.lastReplay.actionName !== state.lastAction;
  nodes.rerunTimeoutBtn.disabled = !timedOutItems.length || !state.lastReplay || state.lastReplay.actionName !== state.lastAction;
  if (!state.results.length) {
    nodes.resultSummary.textContent = "暂无执行记录";
    nodes.results.innerHTML = `<div class="empty-state">执行结果、上传结果、下载结果、公钥分发结果都会显示在这里。</div>`;
    return;
  }
  const okCount = state.results.filter((item) => item.ok).length;
  const failCount = state.results.filter((item) => !item.ok && !item.skipped).length;
  const skipCount = state.results.filter((item) => item.skipped).length;
  const visibleResults = state.failOnly
    ? state.results.filter((item) => !item.ok && !item.skipped)
    : state.results;
  const timeoutCount = failedItems.filter((item) => item.timedOut).length;
  const retryText = state.lastRetryCount > 0 ? `，已重试 ${state.lastRetryCount} 次` : "";
  const timeoutText = timeoutCount > 0 ? `，其中超时 ${timeoutCount} 台` : "";
  nodes.resultSummary.textContent = `${state.lastAction}：成功 ${okCount} 台，失败 ${failCount} 台，跳过 ${skipCount} 台${timeoutText}${retryText}${state.failOnly ? "，当前仅显示失败主机" : ""}`;
  if (!visibleResults.length) {
    nodes.results.innerHTML = `<div class="empty-state">当前筛选下没有结果。</div>`;
    return;
  }
  visibleResults.forEach((item) => {
    const statusClass = item.skipped ? "skip" : item.ok ? "ok" : "fail";
    const card = document.createElement("article");
    card.className = `result-card ${statusClass}`;
    const top = document.createElement("div");
    top.className = "result-top";
    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "result-name";
    name.textContent = item.name || item.host || "未命名主机";
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = buildResultMeta(item);
    left.appendChild(name);
    left.appendChild(meta);
    const badge = document.createElement("span");
    badge.className = `status-badge ${statusClass}`;
    badge.textContent = item.skipped ? "已跳过" : item.ok ? "成功" : "失败";
    top.appendChild(left);
    top.appendChild(badge);
    card.appendChild(top);
    if (item.stdout) card.appendChild(renderResultBlock("标准输出", item.stdout));
    if (item.stderr) card.appendChild(renderResultBlock("标准错误", item.stderr));
    if (!item.stdout && !item.stderr) card.appendChild(renderResultBlock("输出", "无输出"));
    nodes.results.appendChild(card);
  });
}

function renderSummary() {
  nodes.summaryCards.innerHTML = "";
  nodes.summaryRegion.innerHTML = "";
  nodes.summaryEnv.innerHTML = "";
  const summary = buildSummary();
  [
    { label: "总目标", value: summary.total },
    { label: "成功", value: summary.ok },
    { label: "失败", value: summary.fail },
    { label: "跳过", value: summary.skip }
  ].forEach((item) => {
    const card = document.createElement("div");
    card.className = "summary-card";
    card.innerHTML = `<div class="summary-card-label">${item.label}</div><div class="summary-card-value">${item.value}</div>`;
    nodes.summaryCards.appendChild(card);
  });
  renderSummaryList(nodes.summaryRegion, summary.byRegion, "暂无地区汇总");
  renderSummaryList(nodes.summaryEnv, summary.byEnv, "暂无环境汇总");
}

function renderRemoteFiles() {
  const activeHost = getActiveHost();
  nodes.remoteFiles.innerHTML = "";
  if (!activeHost) {
    nodes.remoteFilesStatus.textContent = "请先选择当前编辑主机。";
    nodes.remoteFilesMeta.textContent = "没有活动主机，无法浏览远程目录。";
    nodes.remoteNewFolderBtn.disabled = true;
    nodes.remoteNewFileBtn.disabled = true;
    nodes.remoteSelectAllBtn.disabled = true;
    nodes.remoteClearSelectBtn.disabled = true;
    nodes.remoteDeleteSelectedBtn.disabled = true;
    return;
  }
  nodes.remoteNewFolderBtn.disabled = false;
  nodes.remoteNewFileBtn.disabled = false;
  nodes.remoteFilesStatus.textContent = state.remoteFiles.loading
    ? `正在读取 ${activeHost.name} 的目录...`
    : "浏览当前编辑主机的远程目录，支持新建文件夹、重命名、删除和文本在线编辑。";
  const visiblePaths = new Set(state.remoteFiles.entries.map((entry) => joinRemotePath(state.remoteFiles.cwd || "~", entry.name)));
  state.remoteSelections = new Set(Array.from(state.remoteSelections).filter((remotePath) => visiblePaths.has(remotePath)));
  nodes.remoteSelectAllBtn.disabled = !state.remoteFiles.entries.length || state.remoteFiles.loading;
  nodes.remoteClearSelectBtn.disabled = !state.remoteSelections.size;
  nodes.remoteDownloadSelectedBtn.disabled = !state.remoteSelections.size || state.remoteFiles.loading;
  nodes.remoteArchiveSelectedBtn.disabled = !state.remoteSelections.size || state.remoteFiles.loading;
  nodes.remoteDeleteSelectedBtn.disabled = !state.remoteSelections.size || state.remoteFiles.loading;
  nodes.remoteMoveSelectedBtn.disabled = !state.remoteSelections.size || state.remoteFiles.loading;
  nodes.remoteCopySelectedBtn.disabled = !state.remoteSelections.size || state.remoteFiles.loading;
  nodes.remoteFilesMeta.textContent = state.remoteFiles.cwd
    ? `当前主机：${activeHost.name}  当前目录：${state.remoteFiles.cwd}  已选 ${state.remoteSelections.size} 项`
    : `当前主机：${activeHost.name}`;
  nodes.remotePath.value = state.remoteFiles.cwd || nodes.remotePath.value || "~";

  if (state.remoteFiles.loading) {
    nodes.remoteFiles.innerHTML = `<div class="empty-state">目录加载中...</div>`;
    return;
  }
  if (!state.remoteFiles.entries.length) {
    nodes.remoteFiles.innerHTML = `<div class="empty-state">该目录为空，或者暂时没有可显示的文件。</div>`;
    return;
  }

  state.remoteFiles.entries.forEach((entry) => {
    const remotePath = joinRemotePath(state.remoteFiles.cwd || "~", entry.name);
    const item = document.createElement("div");
    item.className = "remote-file-item";
    const main = document.createElement("div");
    main.className = "remote-file-main";
    const head = document.createElement("label");
    head.className = "remote-file-head";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.remoteSelections.has(remotePath);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.remoteSelections.add(remotePath);
      else state.remoteSelections.delete(remotePath);
      renderRemoteFiles();
    });
    const name = document.createElement("div");
    name.className = `remote-file-name ${entry.kind}`;
    name.textContent = entry.kind === "dir" ? `${entry.name}/` : entry.name;
    head.appendChild(checkbox);
    head.appendChild(name);
    const meta = document.createElement("div");
    meta.className = "remote-file-meta";
    meta.textContent = `${entry.kind}  ${formatBytes(entry.size || 0)}  ${formatEpoch(entry.mtimeSec)}`;
    main.appendChild(head);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "remote-file-actions";
    if (entry.kind === "dir") {
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn btn-ghost small";
      openBtn.textContent = "进入";
      openBtn.addEventListener("click", () => {
        void loadRemoteFiles(remotePath, { force: true });
      });
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "btn btn-ghost small";
      renameBtn.textContent = "重命名";
      renameBtn.addEventListener("click", () => void renameRemoteEntry(entry));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-danger small";
      deleteBtn.textContent = "删除";
      deleteBtn.addEventListener("click", () => void deleteRemoteEntry(entry));
      actions.appendChild(openBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
    } else {
      const previewBtn = document.createElement("button");
      previewBtn.type = "button";
      previewBtn.className = "btn btn-ghost small";
      previewBtn.textContent = "预览编辑";
      previewBtn.addEventListener("click", () => void openRemoteTextFile(remotePath));
      const fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.className = "btn btn-ghost small";
      fillBtn.textContent = "填入下载";
      fillBtn.addEventListener("click", () => {
        nodes.downloadRemotePath.value = remotePath;
        saveState();
        setStatus(`状态：已填入下载路径 ${nodes.downloadRemotePath.value}`);
      });
      const downloadBtn = document.createElement("button");
      downloadBtn.type = "button";
      downloadBtn.className = "btn btn-accent small";
      downloadBtn.textContent = "下载";
      downloadBtn.addEventListener("click", () => {
        nodes.downloadRemotePath.value = remotePath;
        saveState();
        void downloadFileFromHost();
      });
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "btn btn-ghost small";
      renameBtn.textContent = "重命名";
      renameBtn.addEventListener("click", () => void renameRemoteEntry(entry));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-danger small";
      deleteBtn.textContent = "删除";
      deleteBtn.addEventListener("click", () => void deleteRemoteEntry(entry));
      actions.appendChild(previewBtn);
      actions.appendChild(fillBtn);
      actions.appendChild(downloadBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
    }

    item.appendChild(main);
    item.appendChild(actions);
    nodes.remoteFiles.appendChild(item);
  });
}

function renderRemoteEditor() {
  const editor = state.remoteEditor;
  const opened = !!editor.path;
  const dirty = editor.content !== editor.originalContent;
  const searchTerm = String(nodes.remoteEditorSearch.value || "");
  const matchInfo = getRemoteEditorMatchInfo();
  nodes.remoteEditorPath.value = editor.path || "";
  if (nodes.remoteEditorText.value !== editor.content) {
    nodes.remoteEditorText.value = editor.content || "";
  }
  nodes.remoteEditorText.disabled = !opened || editor.loading || editor.saving;
  nodes.remoteEditorSearch.disabled = !opened || editor.loading || editor.saving;
  nodes.remoteEditorReplace.disabled = !opened || editor.loading || editor.saving;
  nodes.remoteEditorRegex.disabled = !opened || editor.loading || editor.saving;
  nodes.remoteEditorCaseSensitive.disabled = !opened || editor.loading || editor.saving;
  nodes.remoteEditorWholeWord.disabled = !opened || editor.loading || editor.saving;
  nodes.remoteEditorFindNextBtn.disabled = !opened || editor.loading || editor.saving || !searchTerm;
  nodes.remoteEditorReplaceBtn.disabled = !opened || editor.loading || editor.saving || !searchTerm;
  nodes.remoteEditorReplaceAllBtn.disabled = !opened || editor.loading || editor.saving || !searchTerm;
  nodes.remoteEditorReloadBtn.disabled = !opened || editor.loading || editor.saving;
  nodes.remoteEditorSaveBtn.disabled = !opened || editor.loading || editor.saving || !dirty;
  nodes.remoteEditorCloseBtn.disabled = !opened || editor.loading || editor.saving;
  nodes.remoteEditorMatchStatus.textContent = !opened
    ? "当前没有匹配统计。"
    : !searchTerm
      ? "请输入搜索词后，会显示匹配数量和当前位置。"
      : matchInfo.error
        ? `正则错误：${matchInfo.error}`
      : matchInfo.total
        ? `匹配 ${matchInfo.total} 处，当前 ${matchInfo.currentIndex || 1}/${matchInfo.total}`
        : `未找到“${searchTerm}”`;
  if (!opened) {
    nodes.remoteEditorStatus.textContent = "点击文件列表里的“预览编辑”即可在线查看和保存 UTF-8 文本文件。";
    return;
  }
  if (editor.loading) {
    nodes.remoteEditorStatus.textContent = `正在读取 ${editor.path} ...`;
    return;
  }
  if (editor.saving) {
    nodes.remoteEditorStatus.textContent = `正在保存 ${editor.path} ...`;
    return;
  }
  const suffix = dirty ? "，有未保存修改" : "，内容已同步";
  nodes.remoteEditorStatus.textContent = `${editor.path}  ${formatBytes(editor.size || 0)}  ${formatEpoch(editor.mtimeSec)}${suffix}`;
}

function buildSummary() {
  const hostMap = new Map(state.config.hosts.map((host) => [host.id, host]));
  const summary = {
    total: state.results.length,
    ok: 0,
    fail: 0,
    skip: 0,
    byRegion: new Map(),
    byEnv: new Map()
  };
  state.results.forEach((result) => {
    if (result.skipped) summary.skip += 1;
    else if (result.ok) summary.ok += 1;
    else summary.fail += 1;
    const host = hostMap.get(result.id);
    const region = host?.group?.region || "未知地区";
    const env = host?.group?.env || "未知环境";
    incrementSummaryBucket(summary.byRegion, region, result);
    incrementSummaryBucket(summary.byEnv, env, result);
  });
  return summary;
}

function incrementSummaryBucket(map, key, result) {
  const bucket = map.get(key) || { total: 0, ok: 0, fail: 0, skip: 0 };
  bucket.total += 1;
  if (result.skipped) bucket.skip += 1;
  else if (result.ok) bucket.ok += 1;
  else bucket.fail += 1;
  map.set(key, bucket);
}

function renderSummaryList(container, map, emptyText) {
  if (!map.size) {
    container.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }
  Array.from(map.entries())
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], "zh-CN"))
    .forEach(([name, bucket]) => {
      const item = document.createElement("div");
      item.className = "summary-item";
      item.innerHTML = `
        <span class="summary-item-name">${escapeHtml(name)}</span>
        <span class="summary-item-meta">${bucket.total} 台 / 成功 ${bucket.ok} / 失败 ${bucket.fail} / 跳过 ${bucket.skip}</span>
      `;
      container.appendChild(item);
    });
}

function buildResultMeta(item) {
  const bits = [`${item.host || "-"}`, `exit=${item.exitCode ?? "?"}`, `${item.durationMs || 0}ms`];
  if (item.timedOut) bits.push("超时");
  if (item.direction === "upload" && item.remotePath) bits.push(`上传到 ${item.remotePath}`);
  if (item.direction === "download" && item.remotePath) bits.push(`下载 ${item.remotePath}`);
  if (item.action === "distribute_key") bits.push(`分发 ${item.keyType || "公钥"}`);
  if (item.action === "distribute_key") bits.push(item.authVerified ? "免密已验证" : "免密未通过");
  if (item.action === "check_public_key" && item.keyType) bits.push(`类型 ${item.keyType}`);
  if (item.action === "check_public_key" && item.keyComment) bits.push(`注释 ${item.keyComment}`);
  if (item.action === "check_public_key" && item.authFilePath) bits.push(`文件 ${item.authFilePath}`);
  if (item.action === "check_public_key" && Number.isFinite(Number(item.authorizedKeysLineCount))) bits.push(`共 ${Number(item.authorizedKeysLineCount)} 行`);
  if (item.action && item.action.startsWith("file_") && item.remotePath) bits.push(`路径 ${item.remotePath}`);
  if ((item.action === "file_rename" || item.action === "file_copy") && item.newRemotePath) bits.push(`新路径 ${item.newRemotePath}`);
  if (item.action === "write_text" && item.remotePath) bits.push(`已保存 ${item.remotePath}`);
  return bits.join("  ");
}

function renderResultBlock(title, text) {
  const wrap = document.createElement("div");
  wrap.className = "result-block";
  const heading = document.createElement("div");
  heading.className = "result-block-title";
  heading.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = String(text || "");
  wrap.appendChild(heading);
  wrap.appendChild(pre);
  return wrap;
}

function getVisibleHosts() {
  const keyword = String(nodes.search.value || "").trim().toLowerCase();
  return state.config.hosts.filter((host) => {
    const haystack = [host.name, host.host, host.user, host.notes, host.group.region, host.group.env, ...(host.tags || [])].join(" ").toLowerCase();
    const keywordOk = !keyword || haystack.includes(keyword);
    const filterOk = state.activeFilter === "all" || host.group.region === state.activeFilter || host.group.env === state.activeFilter;
    return keywordOk && filterOk;
  });
}

function getActiveHost() {
  return state.config.hosts.find((item) => item.id === state.activeHostId) || null;
}

function ensureActiveHost() {
  if (state.config.hosts.some((item) => item.id === state.activeHostId)) return;
  state.activeHostId = state.config.hosts[0]?.id || "";
  saveState();
}

function syncSelectionWithHosts() {
  const hostIds = new Set(state.config.hosts.map((item) => item.id));
  state.selectedIds = new Set(Array.from(state.selectedIds).filter((id) => hostIds.has(id)));
  Object.keys(state.sessionPasswords).forEach((id) => {
    if (!hostIds.has(id)) delete state.sessionPasswords[id];
  });
  Object.keys(state.pendingPrivateKeys).forEach((id) => {
    if (!hostIds.has(id)) delete state.pendingPrivateKeys[id];
  });
  saveState();
}

function startNewHost() {
  state.activeHostId = "";
  nodes.hostId.value = "";
  nodes.hostName.value = "";
  nodes.hostHost.value = "";
  nodes.hostUser.value = "root";
  nodes.hostAuthMode.value = "key";
  nodes.hostPort.value = "22";
  nodes.hostIdentityFile.value = "";
  nodes.hostPrivateKeyText.value = "";
  nodes.hostPublicKeyText.value = "";
  nodes.hostPassword.value = "";
  nodes.hostSessionPassword.value = "";
  nodes.hostTags.value = "";
  nodes.hostNotes.value = "";
  nodes.hostEnabled.checked = true;
  saveState();
}

function upsertHostFromForm() {
  const entry = buildHostDraftFromForm({ requireName: true, requireHost: true });
  const index = state.config.hosts.findIndex((item) => item.id === entry.id);
  if (index >= 0) state.config.hosts[index] = entry;
  else state.config.hosts.push(entry);
  state.config.hosts.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  state.activeHostId = entry.id;
  state.selectedIds.add(entry.id);
  const sessionPassword = String(nodes.hostSessionPassword.value || "");
  if (sessionPassword) state.sessionPasswords[entry.id] = sessionPassword;
  else delete state.sessionPasswords[entry.id];
  const privateKeyText = String(nodes.hostPrivateKeyText.value || "").trim();
  if (privateKeyText) state.pendingPrivateKeys[entry.id] = privateKeyText;
  else delete state.pendingPrivateKeys[entry.id];
  nodes.hostId.value = entry.id;
  saveState();
}

function removeActiveHost() {
  if (!state.activeHostId) return setStatus("状态：当前没有可删除的主机");
  const target = getActiveHost();
  state.config.hosts = state.config.hosts.filter((item) => item.id !== state.activeHostId);
  state.selectedIds.delete(state.activeHostId);
  delete state.sessionPasswords[state.activeHostId];
  delete state.pendingPrivateKeys[state.activeHostId];
  state.activeHostId = state.config.hosts[0]?.id || "";
  saveState();
  setStatus(`状态：已从待保存列表移除 ${target?.name || "主机"}`);
  void loadRemoteFiles("~", { force: true });
}

function importHosts() {
  const text = String(nodes.importText.value || "").trim();
  if (!text) throw new Error("请先粘贴导入内容");
  const imported = [];
  text.split(/\r?\n/g).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.startsWith("//")).forEach((line) => {
    const parts = line.includes("|") ? line.split("|") : line.split(/\t/g);
    const values = parts.map((part) => String(part || "").trim());
    const entry = normalizeClientHost({
      id: createTempId(),
      name: values[0] || values[1],
      host: values[1] || values[0],
      user: values[2] || "root",
      port: clampInt(values[3], 22, 1, 65535),
      identityFile: values[4] || "",
      authMode: "key",
      password: "",
      tags: values[5] || "",
      notes: values[6] || "",
      enabled: true
    });
    if (entry) imported.push(entry);
  });
  if (!imported.length) throw new Error("没有解析到有效主机");
  state.config.hosts.push(...imported);
  state.config.hosts = dedupeHosts(state.config.hosts).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  imported.forEach((item) => state.selectedIds.add(item.id));
  state.activeHostId = imported[0].id;
  nodes.importText.value = "";
  saveState();
  renderAll();
  void loadRemoteFiles("~", { force: true });
  setStatus(`状态：已导入 ${imported.length} 台主机，记得点击“保存全部”`);
}

function buildHostDraftFromForm(options = {}) {
  const requireName = options.requireName !== false;
  const requireHost = options.requireHost !== false;
  const hostId = String(nodes.hostId.value || "").trim() || createTempId();
  const name = String(nodes.hostName.value || "").trim();
  const host = String(nodes.hostHost.value || "").trim();
  if (requireName && !name) throw new Error("主机名称不能为空");
  if (requireHost && !host) throw new Error("主机地址不能为空");
  return normalizeClientHost({
    id: hostId,
    name: name || host || "未命名主机",
    host,
    user: String(nodes.hostUser.value || "root").trim() || "root",
    authMode: String(nodes.hostAuthMode.value || "key").trim(),
    port: clampInt(nodes.hostPort.value, 22, 1, 65535),
    identityFile: String(nodes.hostIdentityFile.value || "").trim(),
    password: String(nodes.hostPassword.value || ""),
    tags: String(nodes.hostTags.value || "").trim(),
    notes: String(nodes.hostNotes.value || "").trim(),
    enabled: !!nodes.hostEnabled.checked
  });
}

async function testActiveHostConnection() {
  if (state.running) return;
  let draft;
  try {
    draft = buildHostDraftFromForm({ requireName: false, requireHost: true });
  } catch (error) {
    setStatus(`状态：${error.message}`);
    return;
  }
  const sessionPassword = String(nodes.hostSessionPassword.value || "");
  const privateKeyText = String(nodes.hostPrivateKeyText.value || "").trim();
  state.running = true;
  updateBusyButtons();
  setStatus(`状态：正在测试 ${draft.user}@${draft.host}:${draft.port} 的 SSH 连通性...`);
  try {
    state.lastRetryCount = 0;
    const response = await fetch("/api/ssh/test", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        host: draft,
        sessionPassword,
        privateKeyText,
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `测试失败（HTTP ${response.status}）`);
    state.lastAction = "SSH 连通性测试";
    state.results = payload.result ? [payload.result] : [];
    renderResults();
    renderSummary();
    setStatus(payload.result?.ok ? "状态：SSH 连通性测试成功" : `状态：SSH 连通性测试失败：${payload.result?.stderr || "未知错误"}`);
  } catch (error) {
    setStatus(`状态：SSH 连通性测试失败：${error.message}`);
  } finally {
    state.running = false;
    updateBusyButtons();
  }
}

async function distributeHostPublicKey() {
  if (state.keyRunning) return;
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前主机");
  const publicKey = String(nodes.hostPublicKeyText.value || "").trim();
  if (!publicKey) return setStatus("状态：请先粘贴公钥内容");
  if (!/^ssh-(ed25519|rsa|dss)\s+/i.test(publicKey) && !/^ecdsa-[^\s]+\s+/i.test(publicKey)) {
    return setStatus("状态：公钥格式不正确，应为 ssh-ed25519 / ssh-rsa 这类一整行内容");
  }
  if (!window.confirm(`确认把这条公钥写入 ${host.name} 的 ~/.ssh/authorized_keys 吗？`)) return;
  state.keyRunning = true;
  updateBusyButtons();
  setStatus(`状态：正在把公钥写入 ${host.name} ...`);
  try {
    state.lastRetryCount = 0;
    const response = await fetch("/api/ssh/distribute-key", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostIds: [host.id],
        publicKey,
        sessionPasswords: buildSessionPasswords([host.id]),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `写入失败（HTTP ${response.status}）`);
    state.lastAction = "当前主机公钥写入";
    state.results = Array.isArray(payload.results) ? payload.results : [];
    renderResults();
    renderSummary();
    setStatus(payload.ok ? `状态：公钥已写入 ${host.name}` : `状态：公钥写入完成，但存在失败：${host.name}`);
  } catch (error) {
    setStatus(`状态：公钥写入失败：${error.message}`);
  } finally {
    state.keyRunning = false;
    updateBusyButtons();
  }
}

async function distributeSelectedFromHostEditor() {
  if (state.keyRunning) return;
  const hostIds = Array.from(state.selectedIds);
  if (!hostIds.length) return setStatus("状态：请先选择至少一台主机");
  const publicKey = String(nodes.hostPublicKeyText.value || "").trim();
  if (!publicKey) return setStatus("状态：请先粘贴公钥内容");
  if (!/^ssh-(ed25519|rsa|dss)\s+/i.test(publicKey) && !/^ecdsa-[^\s]+\s+/i.test(publicKey)) {
    return setStatus("状态：公钥格式不正确，应为 ssh-ed25519 / ssh-rsa 这类一整行内容");
  }
  if (!window.confirm(`确认把这条公钥写入已选 ${hostIds.length} 台主机的 ~/.ssh/authorized_keys 吗？`)) return;
  state.keyRunning = true;
  updateBusyButtons();
  setStatus(`状态：正在把公钥写入已选 ${hostIds.length} 台主机 ...`);
  try {
    state.lastRetryCount = 0;
    const response = await fetch("/api/ssh/distribute-key", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostIds,
        publicKey,
        sessionPasswords: buildSessionPasswords(hostIds),
        concurrency: clampInt(nodes.concurrency.value, 4, 1, 12),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `写入失败（HTTP ${response.status}）`);
    state.lastAction = "已选主机公钥写入";
    state.results = Array.isArray(payload.results) ? payload.results : [];
    state.lastReplay = {
      baseActionName: state.lastAction,
      actionName: state.lastAction,
      endpoint: "/api/ssh/distribute-key",
      body: {
        publicKey,
        concurrency: clampInt(nodes.concurrency.value, 4, 1, 12),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      },
      keyAction: true,
      focusFailuresOnPartial: true,
      busyText: (count) => `状态：正在只重试失败的 ${count} 台主机公钥写入...`,
      doneText: (nextPayload) => `状态：失败主机公钥重试完成，成功 ${nextPayload.okCount || 0} 台，失败 ${nextPayload.failCount || 0} 台${Number(nextPayload.failCount || 0) > 0 ? "，仍仅显示失败主机" : ""}`
    };
    if (Number(payload.failCount || 0) > 0) {
      state.failOnly = true;
      saveState();
    }
    renderResults();
    renderSummary();
    setStatus(payload.ok ? `状态：公钥已写入已选 ${hostIds.length} 台主机` : `状态：公钥写入完成，部分主机失败，已自动切到只看失败主机`);
  } catch (error) {
    setStatus(`状态：批量公钥写入失败：${error.message}`);
  } finally {
    state.keyRunning = false;
    updateBusyButtons();
  }
}

async function checkHostPublicKey() {
  if (state.keyRunning) return;
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前主机");
  const publicKey = String(nodes.hostPublicKeyText.value || "").trim();
  if (!publicKey) return setStatus("状态：请先粘贴公钥内容");
  if (!/^ssh-(ed25519|rsa|dss)\s+/i.test(publicKey) && !/^ecdsa-[^\s]+\s+/i.test(publicKey)) {
    return setStatus("状态：公钥格式不正确，应为 ssh-ed25519 / ssh-rsa 这类一整行内容");
  }
  state.keyRunning = true;
  updateBusyButtons();
  setStatus(`状态：正在检测 ${host.name} 是否已存在这条公钥...`);
  try {
    state.lastRetryCount = 0;
    const response = await fetch("/api/ssh/check-public-key", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: host.id,
        publicKey,
        sessionPasswords: buildSessionPasswords([host.id]),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `检测失败（HTTP ${response.status}）`);
    state.lastAction = "当前主机公钥检测";
    state.results = payload.result ? [payload.result] : [];
    renderResults();
    renderSummary();
    const lineInfo = `，${payload.authFilePath || "~/.ssh/authorized_keys"}，共 ${Number(payload.authorizedKeysLineCount || 0)} 行`;
    const keyMeta = [payload.keyType ? `类型 ${payload.keyType}` : "", payload.keyComment ? `注释 ${payload.keyComment}` : ""].filter(Boolean).join("，");
    const metaSuffix = keyMeta ? `，${keyMeta}` : "";
    setStatus(payload.exists ? `状态：${host.name} 已存在这条公钥${lineInfo}${metaSuffix}` : `状态：${host.name} 还没有这条公钥${lineInfo}${metaSuffix}`);
  } catch (error) {
    setStatus(`状态：公钥检测失败：${error.message}`);
  } finally {
    state.keyRunning = false;
    updateBusyButtons();
  }
}

async function copyFailedIps() {
  const failedItems = state.results.filter((item) => !item.ok && !item.skipped);
  if (!failedItems.length) return setStatus("状态：当前没有失败主机可复制");
  const text = Array.from(new Set(failedItems.map((item) => String(item.host || "").trim()).filter(Boolean))).join("\n");
  await copyTextToClipboard(text, `状态：已复制 ${failedItems.length} 台失败主机的 IP`);
}

async function copyFailedDetails() {
  const failedItems = state.results.filter((item) => !item.ok && !item.skipped);
  if (!failedItems.length) return setStatus("状态：当前没有失败详情可复制");
  const text = buildFailedDetailsText(failedItems);
  await copyTextToClipboard(text, `状态：已复制 ${failedItems.length} 台失败主机的详情`);
}

async function rerunFailedHosts() {
  await rerunResultSubset({
    filter: (item) => !item.ok && !item.skipped,
    emptyText: "状态：当前没有失败主机可重试",
    retrySuffix: "失败重试"
  });
}

async function rerunTimedOutHosts() {
  await rerunResultSubset({
    filter: (item) => !item.ok && !item.skipped && item.timedOut,
    emptyText: "状态：当前没有超时主机可重试",
    retrySuffix: "超时重试"
  });
}

async function copyTextToClipboard(text, successMessage) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "readonly");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setStatus(successMessage);
  } catch (error) {
    setStatus(`状态：复制失败信息失败：${error.message || "浏览器拒绝复制"}`);
  }
}

async function exportFailedDetails(type) {
  const failedItems = state.results.filter((item) => !item.ok && !item.skipped);
  if (!failedItems.length) return setStatus("状态：当前没有失败详情可导出");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let blob;
  let fileName;
  if (type === "md") {
    blob = new Blob([buildFailedDetailsMarkdown(failedItems)], { type: "text/markdown;charset=utf-8" });
    fileName = `ssh-failed-details-${stamp}.md`;
  } else {
    blob = new Blob([buildFailedDetailsText(failedItems)], { type: "text/plain;charset=utf-8" });
    fileName = `ssh-failed-details-${stamp}.txt`;
  }
  triggerBlobDownload(blob, fileName);
  setStatus(`状态：已导出 ${fileName}`);
}

function buildFailedDetailsText(items) {
  return items
    .map((item) => {
      const reason = String(item.stderr || item.stdout || "未知失败").trim();
      return [
        `主机：${item.name || item.host || "未命名主机"}`,
        `地址：${item.host || "-"}`,
        `退出码：${item.exitCode ?? "?"}`,
        `是否超时：${item.timedOut ? "是" : "否"}`,
        `原因：${reason}`
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildFailedDetailsMarkdown(items) {
  const lines = ["# SSH 失败详情", ""];
  items.forEach((item) => {
    const reason = String(item.stderr || item.stdout || "未知失败").trim();
    lines.push(`## ${item.name || item.host || "未命名主机"}`);
    lines.push(`- 地址: ${item.host || "-"}`);
    lines.push(`- 退出码: ${item.exitCode ?? "-"}`);
    lines.push(`- 是否超时: ${item.timedOut ? "是" : "否"}`);
    lines.push("");
    lines.push("```text");
    lines.push(reason || "未知失败");
    lines.push("```");
    lines.push("");
  });
  return lines.join("\n");
}

async function rerunResultSubset({ filter, emptyText, retrySuffix }) {
  const retryItems = state.results.filter((item) => typeof filter === "function" ? filter(item) : false);
  if (!retryItems.length) return setStatus(emptyText);
  if (!state.lastReplay || state.lastReplay.actionName !== state.lastAction) {
    return setStatus("状态：当前结果不支持失败主机重试");
  }
  const retryHostIds = Array.from(new Set(retryItems.map((item) => String(item.id || "").trim()).filter(Boolean)));
  if (!retryHostIds.length) return setStatus("状态：结果里没有有效主机 ID，无法重试");
  const replay = state.lastReplay;
  const baseActionName = replay.baseActionName || replay.actionName.replace(/（.*重试）$/, "");
  const retryActionName = `${baseActionName}（${retrySuffix}）`;
  state.lastAction = retryActionName;
  state.lastRetryCount = Number(replay.retryCount || 0) + 1;
  await runJsonAction({
    endpoint: replay.endpoint,
    body: {
      ...(replay.body || {}),
      hostIds: retryHostIds
    },
    transfer: !!replay.transfer,
    keyAction: !!replay.keyAction,
    focusFailuresOnPartial: !!replay.focusFailuresOnPartial,
    busyText: typeof replay.busyText === "function" ? replay.busyText : () => String(replay.busyText || ""),
    doneText: replay.doneText,
    replay: {
      ...replay,
      baseActionName,
      actionName: retryActionName,
      retryCount: state.lastRetryCount
    }
  });
}

function dedupeHosts(list) {
  const out = [];
  const seen = new Set();
  list.forEach((item) => {
    const key = `${item.user}@${item.host}:${item.port}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function applyDefaultsFromInputs() {
  state.config.defaults.connectTimeoutSec = clampInt(nodes.defaultConnectTimeout.value, 8, 1, 60);
  state.config.defaults.commandTimeoutMs = clampInt(nodes.defaultCommandTimeout.value, 20000, 1000, 600000);
  if (!String(nodes.runConnectTimeout.value || "").trim()) nodes.runConnectTimeout.value = String(state.config.defaults.connectTimeoutSec);
  if (!String(nodes.runCommandTimeout.value || "").trim()) nodes.runCommandTimeout.value = String(state.config.defaults.commandTimeoutMs);
  saveState();
}

async function runCommand() {
  if (state.running) return;
  const hostIds = Array.from(state.selectedIds);
  const command = String(nodes.commandInput.value || "").trim();
  if (!hostIds.length) return setStatus("状态：请先选择至少一台主机");
  if (!command) return setStatus("状态：请输入要执行的命令");
  state.lastAction = "命令执行";
  state.lastRetryCount = 0;
  await runJsonAction({
    endpoint: "/api/ssh/run",
    body: {
      hostIds,
      command,
      concurrency: clampInt(nodes.concurrency.value, 4, 1, 12),
      connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
      timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
    },
    busyText: `状态：正在对 ${hostIds.length} 台主机执行命令...`,
    doneText: (payload) => `状态：执行完成，成功 ${payload.okCount || 0} 台，失败 ${payload.failCount || 0} 台${Number(payload.failCount || 0) > 0 ? "，可直接重试失败主机" : ""}`,
    replay: {
      baseActionName: state.lastAction,
      actionName: state.lastAction,
      endpoint: "/api/ssh/run",
      body: {
        command,
        concurrency: clampInt(nodes.concurrency.value, 4, 1, 12),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      },
      busyText: (count) => `状态：正在只重试失败的 ${count} 台主机命令执行...`,
      doneText: (payload) => `状态：失败主机重试完成，成功 ${payload.okCount || 0} 台，失败 ${payload.failCount || 0} 台`
    }
  });
}

async function uploadFileToHosts() {
  if (state.transferRunning) return;
  if (!state.scpAvailable) return setStatus("状态：scp 不可用，无法上传");
  if (!state.uploadFile) return setStatus("状态：请先选择上传文件");
  const hostIds = Array.from(state.selectedIds);
  if (!hostIds.length) return setStatus("状态：请先选择至少一台主机");
  const remotePath = String(nodes.uploadRemotePath.value || "").trim() || ensureTrailingSlash(state.remoteFiles.cwd || "~");
  if (!remotePath) return setStatus("状态：请填写远程目标路径");
  const buffer = await state.uploadFile.arrayBuffer();
  state.lastAction = "文件上传";
  await runJsonAction({
    endpoint: "/api/ssh/upload",
    body: {
      hostIds,
      remotePath,
      fileName: state.uploadFile.name,
      contentBase64: arrayBufferToBase64(buffer),
      concurrency: Math.min(clampInt(nodes.concurrency.value, 4, 1, 12), 4),
      connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
      timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
    },
    transfer: true,
    busyText: `状态：正在上传 ${state.uploadFile.name} 到 ${hostIds.length} 台主机...`,
    doneText: (payload) => `状态：上传完成，成功 ${payload.okCount || 0} 台，失败 ${payload.failCount || 0} 台`
  });
}

async function downloadFileFromHost() {
  if (state.transferRunning) return;
  if (!state.scpAvailable) return setStatus("状态：scp 不可用，无法下载");
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前下载主机");
  const remotePath = String(nodes.downloadRemotePath.value || "").trim();
  if (!remotePath) return setStatus("状态：请填写远程文件路径");
  state.transferRunning = true;
  updateBusyButtons();
  setStatus(`状态：正在从 ${host.name} 下载文件...`);
  try {
    const response = await fetch("/api/ssh/download", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: host.id,
        remotePath,
        sessionPasswords: buildSessionPasswords([host.id]),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const contentType = String(response.headers.get("content-type") || "");
    if (!response.ok || contentType.includes("application/json")) {
      const payload = await parseJsonResponse(response);
      throw new Error(payload.error || `下载失败（HTTP ${response.status}）`);
    }
    const blob = await response.blob();
    const fileName = parseDownloadFileName(response.headers.get("content-disposition")) || `${host.name}-download.bin`;
    triggerBlobDownload(blob, fileName);
    state.lastAction = "文件下载";
    state.results = [{ id: host.id, name: host.name, host: host.host, ok: true, exitCode: 0, signal: null, durationMs: 0, timedOut: false, direction: "download", remotePath, stdout: `浏览器已接收文件：${fileName}`, stderr: "" }];
    renderResults();
    renderSummary();
    setStatus(`状态：下载完成，文件已保存为 ${fileName}`);
  } catch (error) {
    setStatus(`状态：下载失败：${error.message}`);
  } finally {
    state.transferRunning = false;
    updateBusyButtons();
  }
}

async function loadRemoteFiles(targetPath, options = {}) {
  const activeHost = getActiveHost();
  if (!activeHost) {
    state.remoteFiles = {
      hostId: "",
      cwd: "",
      parent: "",
      entries: [],
      loading: false
    };
    resetRemoteEditor();
    renderRemoteFiles();
    renderRemoteEditor();
    return;
  }

  const requestedPath = String(targetPath || "~").trim() || "~";
  const hostChanged = state.remoteFiles.hostId !== activeHost.id;
  if (hostChanged) resetRemoteEditor();
  if (!options.force && !hostChanged && state.remoteFiles.cwd === requestedPath && state.remoteFiles.entries.length) {
    renderRemoteFiles();
    return;
  }

  state.remoteFiles.loading = true;
  state.remoteFiles.hostId = activeHost.id;
  renderRemoteFiles();
  try {
    const response = await fetch("/api/ssh/files/list", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: activeHost.id,
        path: requestedPath,
        sessionPasswords: buildSessionPasswords([activeHost.id]),
        showHidden: true,
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `目录读取失败（HTTP ${response.status}）`);
    state.remoteFiles = {
      hostId: activeHost.id,
      cwd: String(payload.cwd || requestedPath || "~"),
      parent: String(payload.parent || "").trim(),
      entries: Array.isArray(payload.entries) ? payload.entries : [],
      loading: false
    };
    nodes.remotePath.value = state.remoteFiles.cwd;
    if (!String(nodes.uploadRemotePath.value || "").trim()) {
      nodes.uploadRemotePath.value = ensureTrailingSlash(state.remoteFiles.cwd);
    }
    renderRemoteFiles();
    renderRemoteEditor();
  } catch (error) {
    state.remoteFiles.loading = false;
    state.remoteFiles.entries = [];
    renderRemoteFiles();
    setStatus(`状态：远程目录读取失败：${error.message}`);
  }
}

async function createRemoteFolder() {
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  const folderName = String(nodes.remoteNewFolderName.value || "").trim();
  if (!folderName) return setStatus("状态：请输入新文件夹名称");
  if (/[\\/]/.test(folderName)) return setStatus("状态：新文件夹名称不能包含 / 或 \\");
  const remotePath = joinRemotePath(state.remoteFiles.cwd || "~", folderName);
  await runRemoteFileAction({
    action: "mkdir",
    path: remotePath,
    busyText: `状态：正在创建远程文件夹 ${remotePath} ...`,
    successText: `状态：已创建远程文件夹 ${remotePath}`,
    afterSuccess: async () => {
      nodes.remoteNewFolderName.value = "";
      await loadRemoteFiles(state.remoteFiles.cwd || "~", { force: true });
    }
  });
}

async function createRemoteTextFile() {
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  const fileName = String(nodes.remoteNewFileName.value || "").trim();
  if (!fileName) return setStatus("状态：请输入新文本文件名称");
  if (/[\\/]/.test(fileName)) return setStatus("状态：文件名称不能包含 / 或 \\");
  const remotePath = joinRemotePath(state.remoteFiles.cwd || "~", fileName);
  setStatus(`状态：正在创建空白文本文件 ${remotePath} ...`);
  try {
    const response = await fetch("/api/ssh/files/write-text", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: host.id,
        path: remotePath,
        content: "",
        sessionPasswords: buildSessionPasswords([host.id]),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `创建失败（HTTP ${response.status}）`);
    state.lastAction = "远程文本新建";
    state.results = payload.result ? [payload.result] : [];
    renderResults();
    renderSummary();
    nodes.remoteNewFileName.value = "";
    await loadRemoteFiles(state.remoteFiles.cwd || "~", { force: true });
    await openRemoteTextFile(String(payload.path || remotePath));
    setStatus(`状态：已创建空白文本文件 ${String(payload.path || remotePath)}`);
  } catch (error) {
    setStatus(`状态：创建空白文本文件失败：${error.message}`);
  }
}

async function renameRemoteEntry(entry) {
  const currentPath = joinRemotePath(state.remoteFiles.cwd || "~", entry.name);
  const nextName = window.prompt("请输入新的名称", entry.name);
  if (nextName == null) return;
  const trimmed = String(nextName || "").trim();
  if (!trimmed) return setStatus("状态：重命名已取消，名称不能为空");
  if (trimmed === entry.name) return;
  if (/[\\/]/.test(trimmed)) return setStatus("状态：新名称不能包含 / 或 \\");
  const nextPath = joinRemotePath(state.remoteFiles.cwd || "~", trimmed);
  await runRemoteFileAction({
    action: "rename",
    path: currentPath,
    newPath: nextPath,
    busyText: `状态：正在把 ${entry.name} 重命名为 ${trimmed} ...`,
    successText: `状态：已重命名为 ${trimmed}`,
    afterSuccess: async () => {
      if (state.remoteEditor.path === currentPath) {
        state.remoteEditor.path = nextPath;
      }
      await loadRemoteFiles(state.remoteFiles.cwd || "~", { force: true });
      renderRemoteEditor();
    }
  });
}

async function deleteRemoteEntry(entry) {
  const targetPath = joinRemotePath(state.remoteFiles.cwd || "~", entry.name);
  const tip = entry.kind === "dir" ? "该目录及其内容会一起删除" : "该文件会被删除";
  if (!window.confirm(`确认删除 ${targetPath} 吗？\n${tip}`)) return;
  await runRemoteFileAction({
    action: "delete",
    path: targetPath,
    busyText: `状态：正在删除 ${targetPath} ...`,
    successText: `状态：已删除 ${targetPath}`,
    afterSuccess: async () => {
      if (state.remoteEditor.path === targetPath) resetRemoteEditor();
      await loadRemoteFiles(state.remoteFiles.cwd || "~", { force: true });
      renderRemoteEditor();
    }
  });
}

async function deleteSelectedRemoteEntries() {
  const targets = Array.from(state.remoteSelections);
  if (!targets.length) return setStatus("状态：请先勾选要删除的远程文件或目录");
  const preview = targets.slice(0, 5).join("\n");
  const suffix = targets.length > 5 ? `\n... 另外还有 ${targets.length - 5} 项` : "";
  if (!window.confirm(`确认删除已选的 ${targets.length} 项吗？\n${preview}${suffix}`)) return;
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  setStatus(`状态：正在删除已选 ${targets.length} 项...`);
  const sessionPasswords = buildSessionPasswords([host.id]);
  const results = [];
  let failCount = 0;
  for (const remotePath of targets) {
    try {
      const response = await fetch("/api/ssh/files/action", {
        method: "POST",
        headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: host.id,
          action: "delete",
          path: remotePath,
          sessionPasswords,
          connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
          timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
        })
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `删除失败（HTTP ${response.status}）`);
      if (payload.result) results.push(payload.result);
      if (state.remoteEditor.path === remotePath) resetRemoteEditor();
      state.remoteSelections.delete(remotePath);
    } catch (error) {
      failCount += 1;
      results.push({
        id: host.id,
        name: remotePath.split("/").pop() || remotePath,
        host: host.host,
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        action: "file_delete",
        remotePath,
        stdout: "",
        stderr: error.message
      });
    }
  }
  state.lastAction = "远程多选删除";
  state.results = results;
  renderResults();
  renderSummary();
  await loadRemoteFiles(state.remoteFiles.cwd || "~", { force: true });
  renderRemoteEditor();
  setStatus(`状态：多选删除完成，成功 ${targets.length - failCount} 项，失败 ${failCount} 项`);
}

async function downloadSelectedRemoteEntries() {
  if (state.transferRunning) return;
  if (!state.scpAvailable) return setStatus("状态：scp 不可用，无法下载");
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  const targets = Array.from(state.remoteSelections);
  if (!targets.length) return setStatus("状态：请先勾选要下载的远程文件");
  const entryMap = new Map(state.remoteFiles.entries.map((entry) => [joinRemotePath(state.remoteFiles.cwd || "~", entry.name), entry]));
  const fileTargets = targets.filter((remotePath) => {
    const entry = entryMap.get(remotePath);
    return entry && entry.kind !== "dir";
  });
  const skippedDirs = targets.length - fileTargets.length;
  if (!fileTargets.length) return setStatus("状态：当前选择里没有可下载的文件");
  state.transferRunning = true;
  updateBusyButtons();
  const results = [];
  let okCount = 0;
  let failCount = 0;
  try {
    for (const remotePath of fileTargets) {
      setStatus(`状态：正在批量下载 ${remotePath} ...`);
      const response = await fetch("/api/ssh/download", {
        method: "POST",
        headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: host.id,
          remotePath,
          sessionPasswords: buildSessionPasswords([host.id]),
          connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
          timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
        })
      });
      const contentType = String(response.headers.get("content-type") || "");
      if (!response.ok || contentType.includes("application/json")) {
        const payload = await parseJsonResponse(response);
        failCount += 1;
        results.push({
          id: host.id,
          name: remotePath.split("/").pop() || remotePath,
          host: host.host,
          ok: false,
          exitCode: null,
          signal: null,
          durationMs: 0,
          timedOut: false,
          direction: "download",
          remotePath,
          stdout: "",
          stderr: payload.error || `下载失败（HTTP ${response.status}）`
        });
        continue;
      }
      const blob = await response.blob();
      const fileName = parseDownloadFileName(response.headers.get("content-disposition")) || `${host.name}-download.bin`;
      triggerBlobDownload(blob, fileName);
      okCount += 1;
      results.push({
        id: host.id,
        name: remotePath.split("/").pop() || remotePath,
        host: host.host,
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 0,
        timedOut: false,
        direction: "download",
        remotePath,
        stdout: `浏览器已接收文件：${fileName}`,
        stderr: ""
      });
      await delay(120);
    }
    state.lastAction = "远程多选下载";
    state.results = results;
    renderResults();
    renderSummary();
    const skipText = skippedDirs > 0 ? `，跳过目录 ${skippedDirs} 项` : "";
    setStatus(`状态：多选下载完成，成功 ${okCount} 项，失败 ${failCount} 项${skipText}`);
  } catch (error) {
    setStatus(`状态：多选下载失败：${error.message}`);
  } finally {
    state.transferRunning = false;
    updateBusyButtons();
  }
}

async function moveSelectedRemoteEntries() {
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  const targets = Array.from(state.remoteSelections);
  if (!targets.length) return setStatus("状态：请先勾选要移动的远程文件或目录");
  const targetDir = String(nodes.remoteMoveTarget.value || "").trim();
  if (!targetDir) return setStatus("状态：请先填写目标目录");
  if (/[\\\r\n]/.test(targetDir)) return setStatus("状态：目标目录格式不正确");
  const collisionStrategy = nodes.remoteAutoRename.checked ? "rename" : "error";
  const preview = targets.slice(0, 5).map((remotePath) => `${remotePath} -> ${joinRemotePath(targetDir, remotePath.split("/").pop() || "")}`).join("\n");
  const suffix = targets.length > 5 ? `\n... 另外还有 ${targets.length - 5} 项` : "";
  const renameHint = collisionStrategy === "rename" ? "\n同名时会自动改名，例如：file (1).txt" : "";
  if (!window.confirm(`确认把已选 ${targets.length} 项移动到 ${targetDir} 吗？\n${preview}${suffix}${renameHint}`)) return;
  const results = [];
  let failCount = 0;
  for (const remotePath of targets) {
    const nextPath = joinRemotePath(targetDir, remotePath.split("/").pop() || "");
    try {
      const response = await fetch("/api/ssh/files/action", {
        method: "POST",
        headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: host.id,
          action: "rename",
          path: remotePath,
          newPath: nextPath,
          collisionStrategy,
          sessionPasswords: buildSessionPasswords([host.id]),
          connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
          timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
        })
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `移动失败（HTTP ${response.status}）`);
      if (payload.result) results.push(payload.result);
      if (state.remoteEditor.path === remotePath) state.remoteEditor.path = String(payload.newPath || nextPath);
      state.remoteSelections.delete(remotePath);
    } catch (error) {
      failCount += 1;
      results.push({
        id: host.id,
        name: remotePath.split("/").pop() || remotePath,
        host: host.host,
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        action: "file_rename",
        remotePath,
        newRemotePath: nextPath,
        stdout: "",
        stderr: error.message
      });
    }
  }
  state.lastAction = "远程多选移动";
  state.results = results;
  renderResults();
  renderSummary();
  await loadRemoteFiles(state.remoteFiles.cwd || "~", { force: true });
  renderRemoteEditor();
  setStatus(`状态：多选移动完成，成功 ${targets.length - failCount} 项，失败 ${failCount} 项`);
}

async function copySelectedRemoteEntries() {
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  const targets = Array.from(state.remoteSelections);
  if (!targets.length) return setStatus("状态：请先勾选要复制的远程文件或目录");
  const targetDir = String(nodes.remoteCopyTarget.value || "").trim();
  if (!targetDir) return setStatus("状态：请先填写复制目标目录");
  if (/[\\\r\n]/.test(targetDir)) return setStatus("状态：复制目标目录格式不正确");
  const collisionStrategy = nodes.remoteAutoRename.checked ? "rename" : "error";
  const preview = targets.slice(0, 5).map((remotePath) => `${remotePath} -> ${joinRemotePath(targetDir, remotePath.split("/").pop() || "")}`).join("\n");
  const suffix = targets.length > 5 ? `\n... 另外还有 ${targets.length - 5} 项` : "";
  const renameHint = collisionStrategy === "rename" ? "\n同名时会自动改名，例如：file (1).txt" : "";
  if (!window.confirm(`确认把已选 ${targets.length} 项复制到 ${targetDir} 吗？\n${preview}${suffix}${renameHint}`)) return;
  const results = [];
  let failCount = 0;
  for (const remotePath of targets) {
    const nextPath = joinRemotePath(targetDir, remotePath.split("/").pop() || "");
    try {
      const response = await fetch("/api/ssh/files/action", {
        method: "POST",
        headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: host.id,
          action: "copy",
          path: remotePath,
          newPath: nextPath,
          collisionStrategy,
          sessionPasswords: buildSessionPasswords([host.id]),
          connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
          timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
        })
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `复制失败（HTTP ${response.status}）`);
      if (payload.result) results.push(payload.result);
    } catch (error) {
      failCount += 1;
      results.push({
        id: host.id,
        name: remotePath.split("/").pop() || remotePath,
        host: host.host,
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        action: "file_copy",
        remotePath,
        newRemotePath: nextPath,
        stdout: "",
        stderr: error.message
      });
    }
  }
  state.lastAction = "远程多选复制";
  state.results = results;
  renderResults();
  renderSummary();
  await loadRemoteFiles(state.remoteFiles.cwd || "~", { force: true });
  renderRemoteEditor();
  setStatus(`状态：多选复制完成，成功 ${targets.length - failCount} 项，失败 ${failCount} 项`);
}

async function downloadSelectedRemoteArchive() {
  if (state.transferRunning) return;
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  const remotePaths = Array.from(state.remoteSelections);
  if (!remotePaths.length) return setStatus("状态：请先勾选要打包下载的远程文件或目录");
  const archiveNameInput = sanitizeArchiveNameInput(nodes.remoteArchiveName.value);
  state.transferRunning = true;
  updateBusyButtons();
  setStatus(`状态：正在打包 ${remotePaths.length} 项并下载 ZIP ...`);
  try {
    const response = await fetch("/api/ssh/download-archive", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: host.id,
          remotePaths,
          name: archiveNameInput || `${host.name || host.host}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
          sessionPasswords: buildSessionPasswords([host.id]),
          connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
          timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
        })
    });
    const contentType = String(response.headers.get("content-type") || "");
    if (!response.ok || contentType.includes("application/json")) {
      const payload = await parseJsonResponse(response);
      throw new Error(payload.error || `ZIP 下载失败（HTTP ${response.status}）`);
    }
    const blob = await response.blob();
    const fileName = parseDownloadFileName(response.headers.get("content-disposition")) || `${host.name || host.host}-batch.zip`;
    triggerBlobDownload(blob, fileName);
    state.lastAction = "远程 ZIP 下载";
    state.results = [{
      id: host.id,
      name: host.name,
      host: host.host,
      ok: true,
      exitCode: 0,
      signal: null,
      durationMs: 0,
      timedOut: false,
      direction: "download",
      remotePath: `${remotePaths.length} 项`,
      stdout: `浏览器已接收 ZIP：${fileName}`,
      stderr: ""
    }];
    renderResults();
    renderSummary();
    setStatus(`状态：ZIP 打包下载完成，共 ${remotePaths.length} 项`);
  } catch (error) {
    setStatus(`状态：ZIP 打包下载失败：${error.message}`);
  } finally {
    state.transferRunning = false;
    updateBusyButtons();
  }
}

async function runRemoteFileAction({ action, path, newPath = "", busyText, successText, afterSuccess }) {
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  setStatus(busyText);
  try {
    const response = await fetch("/api/ssh/files/action", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: host.id,
        action,
        path,
        newPath,
        sessionPasswords: buildSessionPasswords([host.id]),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `远程文件操作失败（HTTP ${response.status}）`);
    state.lastAction = "远程文件操作";
    state.results = payload.result ? [payload.result] : [];
    renderResults();
    renderSummary();
    setStatus(successText);
    if (typeof afterSuccess === "function") await afterSuccess(payload);
  } catch (error) {
    setStatus(`状态：${error.message}`);
  }
}

async function openRemoteTextFile(remotePath) {
  if (!confirmRemoteEditorDiscard()) return;
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  state.remoteEditor = {
    hostId: host.id,
    path: remotePath,
    content: "",
    originalContent: "",
    size: 0,
    mtimeSec: 0,
    loading: true,
    saving: false
  };
  renderRemoteEditor();
  setStatus(`状态：正在读取远程文本 ${remotePath} ...`);
  try {
    const response = await fetch("/api/ssh/files/read-text", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: host.id,
        path: remotePath,
        sessionPasswords: buildSessionPasswords([host.id]),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `远程文本读取失败（HTTP ${response.status}）`);
    state.remoteEditor = {
      hostId: host.id,
      path: String(payload.path || remotePath),
      content: String(payload.content || ""),
      originalContent: String(payload.content || ""),
      size: Number(payload.size || 0),
      mtimeSec: Number(payload.mtimeSec || 0),
      loading: false,
      saving: false
    };
    renderRemoteEditor();
    setStatus(`状态：已打开远程文本 ${state.remoteEditor.path}`);
  } catch (error) {
    resetRemoteEditor();
    renderRemoteEditor();
    setStatus(`状态：远程文本读取失败：${error.message}`);
  }
}

async function reloadRemoteEditor() {
  if (!state.remoteEditor.path) return;
  if (!confirmRemoteEditorDiscard()) return;
  await openRemoteTextFile(state.remoteEditor.path);
}

async function saveRemoteTextFile() {
  const host = getActiveHost();
  if (!host) return setStatus("状态：请先选择当前编辑主机");
  if (!state.remoteEditor.path) return setStatus("状态：请先打开要保存的远程文本文件");
  if (state.remoteEditor.saving || state.remoteEditor.loading) return;
  state.remoteEditor.saving = true;
  renderRemoteEditor();
  setStatus(`状态：正在保存远程文本 ${state.remoteEditor.path} ...`);
  try {
    const content = String(nodes.remoteEditorText.value || "");
    const response = await fetch("/api/ssh/files/write-text", {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: host.id,
        path: state.remoteEditor.path,
        content,
        sessionPasswords: buildSessionPasswords([host.id]),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `远程文本保存失败（HTTP ${response.status}）`);
    state.remoteEditor.content = content;
    state.remoteEditor.originalContent = content;
    state.remoteEditor.size = Number(payload.size || new Blob([content]).size);
    state.remoteEditor.path = String(payload.path || state.remoteEditor.path);
    state.remoteEditor.mtimeSec = Math.floor(Date.now() / 1000);
    state.lastAction = "远程文本保存";
    state.results = payload.result ? [payload.result] : [];
    renderResults();
    renderSummary();
    setStatus(`状态：已保存 ${state.remoteEditor.path}`);
    renderRemoteEditor();
    await loadRemoteFiles(state.remoteFiles.cwd || "~", { force: true });
  } catch (error) {
    setStatus(`状态：远程文本保存失败：${error.message}`);
  } finally {
    state.remoteEditor.saving = false;
    renderRemoteEditor();
  }
}

function confirmRemoteEditorDiscard() {
  const dirty = state.remoteEditor.path && String(nodes.remoteEditorText.value || "") !== state.remoteEditor.originalContent;
  if (!dirty) return true;
  return window.confirm("当前远程文本有未保存修改，确认放弃吗？");
}

function findNextInRemoteEditor() {
  if (!state.remoteEditor.path) return setStatus("状态：请先打开一个远程文本文件");
  const searchTerm = String(nodes.remoteEditorSearch.value || "");
  if (!searchTerm) return setStatus("状态：请输入要搜索的文字");
  const matchInfo = getRemoteEditorMatchInfo();
  if (matchInfo.error) return setStatus(`状态：正则错误：${matchInfo.error}`);
  if (!matchInfo.total) return setStatus(`状态：未找到“${searchTerm}”`);
  const textarea = nodes.remoteEditorText;
  const startAt = Math.max(0, textarea.selectionEnd);
  let target = matchInfo.matches.find((item) => item.index >= startAt);
  if (!target) target = matchInfo.matches[0];
  const index = target.index;
  textarea.focus();
  textarea.setSelectionRange(index, index + target.length);
  const lineHeight = 22;
  textarea.scrollTop = Math.max(0, textarea.value.slice(0, index).split("\n").length - 2) * lineHeight;
  const currentInfo = getRemoteEditorMatchInfo();
  setStatus(`状态：已定位到“${searchTerm}” (${currentInfo.currentIndex || 1}/${currentInfo.total || 1})`);
  renderRemoteEditor();
}

function replaceCurrentInRemoteEditor() {
  if (!state.remoteEditor.path) return setStatus("状态：请先打开一个远程文本文件");
  const searchTerm = String(nodes.remoteEditorSearch.value || "");
  if (!searchTerm) return setStatus("状态：请输入要搜索的文字");
  const replaceValue = String(nodes.remoteEditorReplace.value || "");
  const textarea = nodes.remoteEditorText;
  const matchInfo = getRemoteEditorMatchInfo();
  if (matchInfo.error) return setStatus(`状态：正则错误：${matchInfo.error}`);
  if (!matchInfo.total) return setStatus(`状态：未找到“${searchTerm}”`);
  let start = Number(textarea.selectionStart || 0);
  let targetMatch = matchInfo.matches.find((item) => item.index === start);
  if (!targetMatch) {
    findNextInRemoteEditor();
    start = Number(textarea.selectionStart || 0);
    const refreshed = getRemoteEditorMatchInfo();
    targetMatch = refreshed.matches.find((item) => item.index === start);
    if (!targetMatch) return;
  }
  const currentText = String(textarea.value || "");
  const replacement = buildEditorReplaceCurrent(currentText, start, targetMatch.length, searchTerm, replaceValue);
  if (!replacement.ok) return setStatus(`状态：${replacement.error}`);
  const nextText = replacement.text;
  const end = replacement.end;
  textarea.value = nextText;
  textarea.focus();
  textarea.setSelectionRange(start, end);
  state.remoteEditor.content = nextText;
  renderRemoteEditor();
  const nextInfo = getRemoteEditorMatchInfo();
  setStatus(`状态：已替换当前“${searchTerm}”，剩余匹配 ${nextInfo.total}`);
}

function replaceAllInRemoteEditor() {
  if (!state.remoteEditor.path) return setStatus("状态：请先打开一个远程文本文件");
  const searchTerm = String(nodes.remoteEditorSearch.value || "");
  if (!searchTerm) return setStatus("状态：请输入要搜索的文字");
  const replaceValue = String(nodes.remoteEditorReplace.value || "");
  const text = String(nodes.remoteEditorText.value || "");
  const replacement = buildEditorReplaceAll(text, searchTerm, replaceValue);
  if (replacement.error) return setStatus(`状态：${replacement.error}`);
  if (replacement.count <= 0) return setStatus(`状态：未找到“${searchTerm}”`);
  const nextText = replacement.text;
  nodes.remoteEditorText.value = nextText;
  nodes.remoteEditorText.focus();
  state.remoteEditor.content = nextText;
  renderRemoteEditor();
  setStatus(`状态：已全部替换，共 ${replacement.count} 处`);
}

function getRemoteEditorMatchInfo() {
  const searchTerm = String(nodes.remoteEditorSearch.value || "");
  const text = String(nodes.remoteEditorText.value || "");
  const matches = [];
  if (!searchTerm) return { total: 0, currentIndex: 0, matches, error: "" };
  const regexInfo = buildEditorSearchRegex(searchTerm);
  if (!regexInfo.ok) return { total: 0, currentIndex: 0, matches: [], error: regexInfo.error };
  let found;
  while ((found = regexInfo.regex.exec(text)) !== null) {
    matches.push({ index: found.index, length: found[0].length });
    if (found[0] === "") regexInfo.regex.lastIndex += 1;
  }
  const selectionStart = Number(nodes.remoteEditorText.selectionStart || 0);
  let currentIndex = 0;
  if (matches.length) {
    currentIndex = matches.findIndex((item) => item.index === selectionStart) + 1;
    if (!currentIndex) {
      currentIndex = matches.findIndex((item) => item.index >= selectionStart) + 1;
      if (!currentIndex) currentIndex = matches.length;
    }
  }
  return { total: matches.length, currentIndex, matches, error: "" };
}

function buildEditorSearchRegex(searchTerm) {
  const useRegex = !!nodes.remoteEditorRegex.checked;
  const caseSensitive = !!nodes.remoteEditorCaseSensitive.checked;
  const wholeWord = !!nodes.remoteEditorWholeWord.checked;
  const flags = caseSensitive ? "g" : "gi";
  try {
    let patternSource = useRegex ? searchTerm : escapeRegex(searchTerm);
    if (wholeWord) {
      patternSource = `(?<![A-Za-z0-9_])(?:${patternSource})(?![A-Za-z0-9_])`;
    }
    return {
      ok: true,
      regex: new RegExp(patternSource, flags)
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "正则表达式无效"
    };
  }
}

function buildEditorReplaceCurrent(text, start, matchLength, searchTerm, replaceValue) {
  const regexInfo = buildEditorSearchRegex(searchTerm);
  if (!regexInfo.ok) return { ok: false, error: `正则错误：${regexInfo.error}` };
  regexInfo.regex.lastIndex = start;
  const match = regexInfo.regex.exec(text);
  if (!match || match.index !== start) return { ok: false, error: "当前选区不是有效匹配" };
  const replacement = match[0].replace(buildEditorSearchRegex(searchTerm).regex, replaceValue);
  return {
    ok: true,
    text: `${text.slice(0, start)}${replacement}${text.slice(start + matchLength)}`,
    end: start + replacement.length
  };
}

function buildEditorReplaceAll(text, searchTerm, replaceValue) {
  const regexInfo = buildEditorSearchRegex(searchTerm);
  if (!regexInfo.ok) return { count: 0, text, error: `正则错误：${regexInfo.error}` };
  let count = 0;
  const nextText = text.replace(regexInfo.regex, () => {
    count += 1;
    return replaceValue;
  });
  return { count, text: nextText, error: "" };
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function resetRemoteEditor() {
  state.remoteEditor = {
    hostId: "",
    path: "",
    content: "",
    originalContent: "",
    size: 0,
    mtimeSec: 0,
    loading: false,
    saving: false
  };
}

async function loadPublicKey() {
  if (state.keyRunning) return;
  state.keyRunning = true;
  updateBusyButtons();
  const pathValue = String(nodes.publicKeyPath.value || "").trim();
  setStatus("状态：正在读取本机公钥...");
  try {
    const query = pathValue ? `?path=${encodeURIComponent(pathValue)}` : "";
    const response = await fetch(`/api/ssh/public-key${query}`, { headers: buildAuthHeaders() });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `读取失败（HTTP ${response.status}）`);
    nodes.publicKeyText.value = String(payload.publicKey || "");
    if (payload.path) nodes.publicKeyPath.value = String(payload.path || "");
    saveState();
    setStatus(`状态：已读取公钥${payload.path ? `（${payload.path}）` : ""}`);
  } catch (error) {
    setStatus(`状态：读取公钥失败：${error.message}`);
  } finally {
    state.keyRunning = false;
    updateBusyButtons();
  }
}

async function distributePublicKey() {
  if (state.keyRunning) return;
  const hostIds = Array.from(state.selectedIds);
  if (!hostIds.length) return setStatus("状态：请先选择至少一台主机");
  const publicKey = String(nodes.publicKeyText.value || "").trim();
  const localPath = String(nodes.publicKeyPath.value || "").trim();
  if (!publicKey && !localPath) return setStatus("状态：请先读取本机公钥，或粘贴公钥内容");
  state.lastAction = "公钥分发";
  state.lastRetryCount = 0;
  await runJsonAction({
    endpoint: "/api/ssh/distribute-key",
    body: {
      hostIds,
      publicKey,
      localPath,
      concurrency: clampInt(nodes.concurrency.value, 4, 1, 12),
      connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
      timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
    },
    keyAction: true,
    busyText: `状态：正在向 ${hostIds.length} 台主机分发公钥...`,
    doneText: (payload) => `状态：公钥分发完成，成功 ${payload.okCount || 0} 台，失败 ${payload.failCount || 0} 台${Number(payload.failCount || 0) > 0 ? "，已自动切到只看失败主机" : ""}`,
    focusFailuresOnPartial: true,
    replay: {
      baseActionName: state.lastAction,
      actionName: state.lastAction,
      endpoint: "/api/ssh/distribute-key",
      body: {
        publicKey,
        localPath,
        concurrency: clampInt(nodes.concurrency.value, 4, 1, 12),
        connectTimeoutSec: clampInt(nodes.runConnectTimeout.value, state.config.defaults.connectTimeoutSec || 8, 1, 60),
        timeoutMs: clampInt(nodes.runCommandTimeout.value, state.config.defaults.commandTimeoutMs || 20000, 1000, 600000)
      },
      keyAction: true,
      focusFailuresOnPartial: true,
      busyText: (count) => `状态：正在只重试失败的 ${count} 台主机公钥分发...`,
      doneText: (payload) => `状态：失败主机公钥重试完成，成功 ${payload.okCount || 0} 台，失败 ${payload.failCount || 0} 台${Number(payload.failCount || 0) > 0 ? "，仍仅显示失败主机" : ""}`
    }
  });
}

async function runJsonAction({ endpoint, body, busyText, doneText, transfer = false, keyAction = false, focusFailuresOnPartial = false, replay = null }) {
  if (transfer) state.transferRunning = true;
  else if (keyAction) state.keyRunning = true;
  else state.running = true;
  updateBusyButtons();
  try {
    const requestBody = { ...(body || {}) };
    const targetIds = Array.isArray(requestBody.hostIds)
      ? requestBody.hostIds
      : requestBody.hostId
        ? [requestBody.hostId]
        : [];
    setStatus(typeof busyText === "function" ? busyText(targetIds.length) : busyText);
    saveState();
    const sessionPasswords = buildSessionPasswords(targetIds);
    if (Object.keys(sessionPasswords).length) requestBody.sessionPasswords = sessionPasswords;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `执行失败（HTTP ${response.status}）`);
    state.results = Array.isArray(payload.results) ? payload.results : [];
    state.lastReplay = replay
      ? {
          ...replay,
          baseActionName: replay.baseActionName || replay.actionName || state.lastAction,
          retryCount: Number(replay.retryCount || 0),
          actionName: replay.actionName || state.lastAction
        }
      : null;
    if (focusFailuresOnPartial && Number(payload.failCount || 0) > 0) {
      state.failOnly = true;
      saveState();
    }
    renderResults();
    renderSummary();
    setStatus(typeof doneText === "function" ? doneText(payload) : doneText);
  } catch (error) {
    setStatus(`状态：${error.message}`);
  } finally {
    if (transfer) state.transferRunning = false;
    else if (keyAction) state.keyRunning = false;
    else state.running = false;
    updateBusyButtons();
  }
}

function buildAuthHeaders() {
  const headers = {};
  const token = String(nodes.token.value || "").trim();
  if (token) headers["X-Terminal-Token"] = token;
  return headers;
}

function handleUploadFileChange() {
  state.uploadFile = nodes.uploadFile.files && nodes.uploadFile.files[0] ? nodes.uploadFile.files[0] : null;
  renderTransferHints();
}

function updateBusyButtons() {
  const failedItems = state.results.filter((item) => !item.ok && !item.skipped);
  const timedOutItems = failedItems.filter((item) => item.timedOut);
  nodes.runBtn.disabled = state.running;
  nodes.testHostBtn.disabled = state.running;
  nodes.uploadBtn.disabled = state.transferRunning;
  nodes.downloadBtn.disabled = state.transferRunning;
  nodes.loadPublicKeyBtn.disabled = state.keyRunning;
  nodes.distributeKeyBtn.disabled = state.keyRunning;
  nodes.checkHostKeyBtn.disabled = state.keyRunning || !getActiveHost();
  nodes.distributeHostKeyBtn.disabled = state.keyRunning || !getActiveHost();
  nodes.distributeSelectedHostKeyBtn.disabled = state.keyRunning || !state.selectedIds.size;
  nodes.copyFailedIpsBtn.disabled = state.running || state.transferRunning || state.keyRunning || !failedItems.length;
  nodes.copyFailedDetailsBtn.disabled = state.running || state.transferRunning || state.keyRunning || !failedItems.length;
  nodes.exportFailedTxtBtn.disabled = state.running || state.transferRunning || state.keyRunning || !failedItems.length;
  nodes.exportFailedMdBtn.disabled = state.running || state.transferRunning || state.keyRunning || !failedItems.length;
  nodes.rerunFailedBtn.disabled = state.running || state.transferRunning || state.keyRunning || !failedItems.length || !state.lastReplay || state.lastReplay.actionName !== state.lastAction;
  nodes.rerunTimeoutBtn.disabled = state.running || state.transferRunning || state.keyRunning || !timedOutItems.length || !state.lastReplay || state.lastReplay.actionName !== state.lastAction;
  nodes.runBtn.textContent = state.running ? "执行中..." : "执行到已选主机";
  nodes.testHostBtn.textContent = state.running ? "测试中..." : "测试 SSH 连通性";
  nodes.uploadBtn.textContent = state.transferRunning ? "上传中..." : "上传到已选主机";
  nodes.downloadBtn.textContent = state.transferRunning ? "下载中..." : "从当前主机下载";
  nodes.loadPublicKeyBtn.textContent = state.keyRunning ? "读取中..." : "读取本机公钥";
  nodes.distributeKeyBtn.textContent = state.keyRunning ? "分发中..." : "分发到已选主机";
  nodes.checkHostKeyBtn.textContent = state.keyRunning ? "检测中..." : "检测当前主机是否已有这条公钥";
  nodes.distributeHostKeyBtn.textContent = state.keyRunning ? "写入中..." : "把上方公钥写入当前主机";
  nodes.distributeSelectedHostKeyBtn.textContent = state.keyRunning ? "写入中..." : "把上方公钥写入已选主机";
  nodes.rerunFailedBtn.textContent = state.running || state.transferRunning || state.keyRunning ? "重试中..." : "重新只执行失败主机";
  nodes.rerunTimeoutBtn.textContent = state.running || state.transferRunning || state.keyRunning ? "重试中..." : "只重试超时主机";
}

function exportResults(type) {
  if (!state.results.length) return setStatus("状态：当前没有可导出的结果");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let blob;
  let fileName;
  if (type === "json") {
    blob = new Blob([JSON.stringify(state.results, null, 2)], { type: "application/json;charset=utf-8" });
    fileName = `ssh-results-${stamp}.json`;
  } else if (type === "csv") {
    const header = ["name", "host", "ok", "exitCode", "durationMs", "timedOut", "direction", "action", "remotePath", "stdout", "stderr"];
    const lines = [header.join(",")].concat(state.results.map((item) => header.map((key) => csvEscape(item[key])).join(",")));
    blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    fileName = `ssh-results-${stamp}.csv`;
  } else {
    const lines = ["# SSH 批量结果", ""];
    state.results.forEach((item) => {
      lines.push(`## ${item.name || item.host}`);
      lines.push(`- 主机: ${item.host || "-"}`);
      lines.push(`- 状态: ${item.ok ? "成功" : item.skipped ? "跳过" : "失败"}`);
      lines.push(`- exitCode: ${item.exitCode ?? "-"}`);
      lines.push(`- durationMs: ${item.durationMs || 0}`);
      if (item.direction) lines.push(`- 方向: ${item.direction}`);
      if (item.action) lines.push(`- 动作: ${item.action}`);
      if (item.remotePath) lines.push(`- 远程路径: ${item.remotePath}`);
      if (item.stdout) lines.push("\n```text\n" + item.stdout + "\n```");
      if (item.stderr) lines.push("\n```text\n" + item.stderr + "\n```");
      lines.push("");
    });
    blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    fileName = `ssh-results-${stamp}.md`;
  }
  triggerBlobDownload(blob, fileName);
  setStatus(`状态：已导出 ${fileName}`);
}

function setStatus(text) {
  nodes.statusText.textContent = String(text || "");
}

function saveState() {
  const payload = {
    token: String(nodes.token.value || ""),
    search: String(nodes.search.value || ""),
    command: String(nodes.commandInput.value || ""),
    uploadRemotePath: String(nodes.uploadRemotePath.value || ""),
    downloadRemotePath: String(nodes.downloadRemotePath.value || ""),
    remotePath: String(nodes.remotePath.value || ""),
    remoteArchiveName: String(nodes.remoteArchiveName.value || ""),
    remoteAutoRename: !!nodes.remoteAutoRename.checked,
    remoteMoveTarget: String(nodes.remoteMoveTarget.value || ""),
    remoteCopyTarget: String(nodes.remoteCopyTarget.value || ""),
    publicKeyPath: String(nodes.publicKeyPath.value || ""),
    publicKeyText: String(nodes.publicKeyText.value || ""),
    failOnly: !!state.failOnly,
    concurrency: String(nodes.concurrency.value || "4"),
    runConnectTimeout: String(nodes.runConnectTimeout.value || ""),
    runCommandTimeout: String(nodes.runCommandTimeout.value || ""),
    activeHostId: state.activeHostId,
    activeFilter: state.activeFilter,
    selectedIds: Array.from(state.selectedIds)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) || {};
    nodes.token.value = String(saved.token || "");
    nodes.search.value = String(saved.search || "");
    nodes.commandInput.value = String(saved.command || "");
    nodes.uploadRemotePath.value = String(saved.uploadRemotePath || "");
    nodes.downloadRemotePath.value = String(saved.downloadRemotePath || "");
    nodes.remotePath.value = String(saved.remotePath || "");
    nodes.remoteArchiveName.value = String(saved.remoteArchiveName || "");
    nodes.remoteAutoRename.checked = !!saved.remoteAutoRename;
    nodes.remoteMoveTarget.value = String(saved.remoteMoveTarget || "");
    nodes.remoteCopyTarget.value = String(saved.remoteCopyTarget || "");
    nodes.publicKeyPath.value = String(saved.publicKeyPath || "");
    nodes.publicKeyText.value = String(saved.publicKeyText || "");
    state.failOnly = !!saved.failOnly;
    nodes.concurrency.value = String(saved.concurrency || "4");
    nodes.runConnectTimeout.value = String(saved.runConnectTimeout || "");
    nodes.runCommandTimeout.value = String(saved.runCommandTimeout || "");
    state.activeHostId = String(saved.activeHostId || "");
    state.activeFilter = String(saved.activeFilter || "all");
    state.selectedIds = new Set(Array.isArray(saved.selectedIds) ? saved.selectedIds.map((item) => String(item || "")) : []);
  } catch (_error) {
    state.selectedIds = new Set();
  }
}

function createTempId() {
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeArchiveNameInput(value) {
  return String(value || "")
    .trim()
    .replace(/\.zip$/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function ensureTrailingSlash(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.endsWith("/") ? text : `${text}/`;
}

function joinRemotePath(basePath, name) {
  const base = String(basePath || "").trim() || "/";
  const safeName = String(name || "").replace(/^\/+/, "");
  if (base === "/") return `/${safeName}`;
  return `${base.replace(/\/+$/, "")}/${safeName}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function formatEpoch(value) {
  const sec = Number(value || 0);
  if (!Number.isFinite(sec) || sec <= 0) return "-";
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatAuthModeLabel(mode) {
  if (mode === "password") return "密码";
  if (mode === "auto") return "私钥+密码";
  return "私钥";
}

function togglePasswordInput(input, button) {
  const nextType = input.type === "password" ? "text" : "password";
  input.type = nextType;
  button.textContent = nextType === "password" ? "显示" : "隐藏";
}

function buildSessionPasswords(hostIds) {
  const ids = Array.isArray(hostIds) ? hostIds : [];
  const out = {};
  ids.forEach((hostId) => {
    const value = String(state.sessionPasswords[hostId] || "");
    if (value) out[hostId] = value;
  });
  return out;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseDownloadFileName(contentDisposition) {
  const raw = String(contentDisposition || "");
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = raw.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : "";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function parseJsonResponse(response) {
  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = `/login.html?next=${encodeURIComponent(next)}`;
    throw new Error("未登录：已跳转到登录页");
  }
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    const snippet = String(raw || "").slice(0, 160).replace(/\s+/g, " ").trim();
    throw new Error(`服务返回了非 JSON 响应（HTTP ${response.status}）。` + (snippet ? `返回片段：${snippet}` : "请确认本地服务已重启并使用最新代码。"));
  }
}
