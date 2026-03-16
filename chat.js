const CONFIG_STORAGE_KEY = "openclaw_model_console_v1";
const CONFIG_STORAGE_BACKUP_KEY = "openclaw_model_console_v1_backup";
const CHAT_STORAGE_KEY = "openclaw_chat_console_v1";
const SPLIT_STORAGE_KEY = "openclaw_chat_split_v1";
const REMOTE_CONFIG_API = "/api/models/config";
const CHAT_BUILD = "20260310-12";
const CHAT_SELECTION_COOKIE_KEY = "oc_chat_selection_v1";
const CHAT_SELECTION_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

const providerPresets = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic（Claude）", baseUrl: "https://api.anthropic.com/v1" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  azure_openai: {
    label: "Azure OpenAI（微软）",
    baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}"
  },
  custom: { label: "自定义", baseUrl: "" }
};

const TEXT_FILE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "yaml",
  "yml",
  "xml",
  "html",
  "css",
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "ini",
  "conf",
  "log",
  "env",
  "sql"
]);
const MAX_ATTACH_FILES = 6;
// Inline-attach limits (will be embedded into prompt for the model)
const MAX_ATTACH_FILE_BYTES = 1024 * 1024;
const MAX_ATTACH_FILE_CHARS = 12000;
const MAX_ATTACH_TOTAL_CHARS = 45000;
// Upload-to-library limits (stored on server and retrieved by query)
const MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_FILE_CHARS = 800000;
const PROJECTS_FALLBACK_ROOT = "/home/weijin/codex";
const NO_PROJECT_KEY = "__no_project__";

let profiles = [];
let projects = [];
let archivedProjects = [];
let archivedExpanded = false;
let activeProjectPath = "";
let history = [];
let historyByProject = {};
let sending = false;
let pendingAttachments = [];
let creatingProject = false;
let projectConfig = {
  defaultRoot: PROJECTS_FALLBACK_ROOT,
  allowedRoots: [PROJECTS_FALLBACK_ROOT]
};

const nodes = {
  provider: document.getElementById("provider"),
  model: document.getElementById("model"),
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  temperature: document.getElementById("temperature"),
  maxTokens: document.getElementById("maxTokens"),
  topP: document.getElementById("topP"),
  systemPrompt: document.getElementById("systemPrompt"),
  reloadProjectsBtn: document.getElementById("reload-projects-btn"),
  projectList: document.getElementById("project-list"),
  archivedToggleBtn: document.getElementById("archived-toggle-btn"),
  archivedProjectList: document.getElementById("archived-project-list"),
  activeProjectName: document.getElementById("active-project-name"),
  profileSelect: document.getElementById("profile-select"),
  reloadProfilesBtn: document.getElementById("reload-profiles-btn"),
  composerProfileSelect: document.getElementById("composer-profile-select"),
  composerModelSelect: document.getElementById("composer-model-select"),
  composerRefreshModelsBtn: document.getElementById("composer-refresh-models-btn"),
  newProjectBtn: document.getElementById("new-project-btn"),
  newProjectInlineBtn: document.getElementById("new-project-inline-btn"),
  newChatBtn: document.getElementById("new-chat-btn"),
  messages: document.getElementById("chat-messages"),
  scrollUpBtn: document.getElementById("scroll-up-btn"),
  scrollDownBtn: document.getElementById("scroll-down-btn"),
  addFileBtn: document.getElementById("add-file-btn"),
  fileInput: document.getElementById("file-input"),
  pendingFiles: document.getElementById("pending-files"),
  voiceModeBtn: document.getElementById("voice-mode-btn"),
  voiceInputBtn: document.getElementById("voice-input-btn"),
  voiceReadBtn: document.getElementById("voice-read-btn"),
  voiceStopBtn: document.getElementById("voice-stop-btn"),
  userInput: document.getElementById("user-input"),
  sendBtn: document.getElementById("send-btn"),
  status: document.getElementById("chat-status"),
  projectModal: document.getElementById("project-modal"),
  projectNameInput: document.getElementById("project-name-input"),
  projectParentInput: document.getElementById("project-parent-input"),
  projectTemplateSelect: document.getElementById("project-template-select"),
  projectModalStatus: document.getElementById("project-modal-status"),
  projectCreateBtn: document.getElementById("project-create-btn"),
  projectCancelBtn: document.getElementById("project-cancel-btn")
};

nodes.layout = document.getElementById("chat-layout");
nodes.sidebarPanel = document.getElementById("sidebar-panel");
nodes.splitter = document.getElementById("splitter");

function init() {
  installGlobalErrorHandlers();
  restoreChatSelectionFromCookie();
  renderProviderOptions();
  restoreChatState();
  void loadProfiles();
  loadProjectConfig();
  loadProjects();
  wireEvents();
  initVoiceTools();
  renderPendingAttachments();
  renderMessages();
  updateScrollButtons();
  autoResizeUserInput();
  updateComposerDensity();
  stopSpeaking();
  // 用于确认脚本是否成功加载（特别是云端/缓存环境）。
  setStatus(`状态：就绪（已加载 ${CHAT_BUILD}）`);
}

let speechRecognition = null;
let dictationActive = false;
let speakingActive = false;
let voiceModeEnabled = false;
let autoSpeakEnabled = false;
let composerDense = false;
let dictationOriginal = "";
let dictationFinal = "";
let dictationInterim = "";
let ttsPreferredVoiceName = "";
let ttsRate = 1;
let ttsPitch = 1;
let ttsVolume = 1;
let splitState = { sidebarWidth: 220, collapsed: false, lastExpandedWidth: 220 };
let lastSendFromVoiceInput = false;
let preferredProfileId = "";
let preferredModelId = "";
let preferredProjectPath = "";

init();

function wireEvents() {
  nodes.reloadProjectsBtn.addEventListener("click", () => loadProjects(true));
  nodes.archivedToggleBtn.addEventListener("click", toggleArchivedList);
  nodes.reloadProfilesBtn.addEventListener("click", () => void loadProfiles({ forceRemote: true, manual: true }));
  nodes.composerRefreshModelsBtn.addEventListener("click", () => void refreshComposerModelsFromApi());
  nodes.profileSelect.addEventListener("change", onProfileChange);
  nodes.composerProfileSelect.addEventListener("change", onProfileChange);
  nodes.composerModelSelect.addEventListener("change", onComposerModelChange);
  nodes.provider.addEventListener("change", onProviderChange);
  nodes.sendBtn.addEventListener("click", sendMessage);
  nodes.newProjectBtn.addEventListener("click", openProjectModal);
  nodes.newProjectInlineBtn.addEventListener("click", openProjectModal);
  nodes.newChatBtn.addEventListener("click", resetChat);
  nodes.scrollUpBtn.addEventListener("click", () => scrollMessagesBy(-1));
  nodes.scrollDownBtn.addEventListener("click", () => scrollMessagesBy(1));
  nodes.messages.addEventListener("scroll", updateScrollButtons);
  window.addEventListener("resize", () => {
    updateScrollButtons();
    updateComposerDensity();
  });
  nodes.addFileBtn.addEventListener("click", () => nodes.fileInput.click());
  nodes.fileInput.addEventListener("change", onFilesSelected);
  // 语音相关按钮是可选增强：避免浏览器缓存旧页面导致 JS 报错从而影响模型选择等核心逻辑。
  if (nodes.voiceModeBtn) nodes.voiceModeBtn.addEventListener("click", toggleVoiceMode);
  if (nodes.voiceInputBtn) {
    nodes.voiceInputBtn.addEventListener("click", toggleDictation);
    nodes.voiceInputBtn.addEventListener("pointerdown", (event) => {
      if (!voiceModeEnabled) return;
      event.preventDefault();
      startDictation({ ptt: true });
    });
    nodes.voiceInputBtn.addEventListener("pointerup", () => {
      if (!voiceModeEnabled) return;
      stopDictation({ autoSend: true });
    });
    nodes.voiceInputBtn.addEventListener("pointercancel", () => {
      if (!voiceModeEnabled) return;
      stopDictation({ autoSend: false });
    });
    nodes.voiceInputBtn.addEventListener("pointerleave", (event) => {
      if (!voiceModeEnabled) return;
      if (!dictationActive) return;
      // 鼠标按住拖出按钮区域时，也停掉。
      if (event && typeof event.buttons === "number" && event.buttons !== 1) return;
      stopDictation({ autoSend: true });
    });
  }
  if (nodes.voiceReadBtn) nodes.voiceReadBtn.addEventListener("click", speakLastAssistantMessage);
  if (nodes.voiceStopBtn) nodes.voiceStopBtn.addEventListener("click", stopAllVoice);
  nodes.projectCancelBtn.addEventListener("click", closeProjectModal);
  nodes.projectCreateBtn.addEventListener("click", createProjectFromModal);
  nodes.projectModal.addEventListener("click", (event) => {
    if (event.target === nodes.projectModal) closeProjectModal();
  });
  nodes.projectNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createProjectFromModal();
    }
  });

  [
    "model",
    "baseUrl",
    "apiKey",
    "temperature",
    "maxTokens",
    "topP",
    "systemPrompt"
  ].forEach((name) => {
    nodes[name].addEventListener("input", persistChatState);
  });

  nodes.userInput.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const key = String(event.key || "");
    if (key !== "Enter") return;

    // 默认 Enter 发送；Shift+Enter 换行。也兼容 Ctrl/Cmd+Enter。
    if (event.shiftKey) return;
    event.preventDefault();
    sendMessage();
  });
  nodes.userInput.addEventListener("input", () => {
    autoResizeUserInput();
  });
}

function updateComposerDensity() {
  const composer = document.querySelector(".composer");
  if (!composer) return;
  const dense = window.innerWidth < 1180;
  composerDense = dense;
  composer.classList.toggle("is-dense", dense);

  if (nodes.addFileBtn) nodes.addFileBtn.textContent = dense ? "文件" : "加入文件";
  if (nodes.newProjectInlineBtn) nodes.newProjectInlineBtn.textContent = dense ? "项目" : "新建项目";
  if (nodes.voiceModeBtn) nodes.voiceModeBtn.textContent = dense ? (voiceModeEnabled ? "语音开" : "语音") : "语音模式";
  if (nodes.voiceReadBtn) nodes.voiceReadBtn.textContent = dense ? (speakingActive ? "读…" : "朗读") : (speakingActive ? "朗读中" : "朗读");
  if (nodes.voiceStopBtn) nodes.voiceStopBtn.textContent = dense ? "停" : "停止";
  if (nodes.composerRefreshModelsBtn) nodes.composerRefreshModelsBtn.textContent = dense ? "刷" : "刷新";

  // 缩短“配置/模型”标签，给下拉框留空间
  const labels = composer.querySelectorAll(".inline-model-picker label");
  labels.forEach((label) => {
    const forId = String(label.getAttribute("for") || "");
    if (forId === "composer-profile-select") label.textContent = dense ? "配" : "配置";
    if (forId === "composer-model-select") label.textContent = dense ? "模" : "模型";
  });

  updateVoiceButtons();
}

function readSplitState() {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const w = Number(parsed.sidebarWidth);
    const collapsed = !!parsed.collapsed;
    const last = Number(parsed.lastExpandedWidth);
    return {
      sidebarWidth: Number.isFinite(w) ? w : 220,
      collapsed,
      lastExpandedWidth: Number.isFinite(last) ? last : 220
    };
  } catch (_error) {
    return null;
  }
}

function writeSplitState(next) {
  try {
    localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(next));
  } catch (_error) {
    // ignore
  }
}

function clampSidebarWidth(value) {
  const layout = nodes.layout;
  const total = layout ? layout.getBoundingClientRect().width : window.innerWidth;
  const min = 170;
  const max = Math.max(min, Math.floor(total * 0.45));
  const n = Number(value);
  if (!Number.isFinite(n)) return 220;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function applySplitState() {
  if (!nodes.layout || !nodes.sidebarPanel) return;
  const collapsed = !!splitState.collapsed;
  nodes.layout.classList.toggle("is-collapsed", collapsed);
  nodes.layout.style.setProperty("--sidebar-w", `${clampSidebarWidth(splitState.sidebarWidth)}px`);
}

function setCollapsed(value) {
  const next = !!value;
  if (!next) {
    const expanded = clampSidebarWidth(splitState.lastExpandedWidth || splitState.sidebarWidth || 220);
    splitState.sidebarWidth = expanded;
  } else {
    splitState.lastExpandedWidth = clampSidebarWidth(splitState.sidebarWidth || 220);
  }
  splitState.collapsed = next;
  applySplitState();
  writeSplitState(splitState);
}

function initSplitPane() {
  if (!nodes.layout || !nodes.sidebarPanel || !nodes.splitter) return;
  const saved = readSplitState();
  if (saved) splitState = { ...splitState, ...saved };

  // Auto clamp on resize so sidebar不会把主对话挤没
  window.addEventListener("resize", () => {
    splitState.sidebarWidth = clampSidebarWidth(splitState.sidebarWidth);
    splitState.lastExpandedWidth = clampSidebarWidth(splitState.lastExpandedWidth);
    applySplitState();
    writeSplitState(splitState);
  });

  applySplitState();

  const splitter = nodes.splitter;
  let dragging = false;
  let startX = 0;
  let startW = 0;

  const onMove = (event) => {
    if (!dragging) return;
    const x = event.clientX || 0;
    const dx = x - startX;
    const nextW = clampSidebarWidth(startW + dx);
    splitState.sidebarWidth = nextW;
    splitState.collapsed = false;
    splitState.lastExpandedWidth = nextW;
    applySplitState();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    writeSplitState(splitState);
  };

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    splitter.setPointerCapture(event.pointerId);
    dragging = true;
    startX = event.clientX || 0;
    startW = clampSidebarWidth(splitState.sidebarWidth);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  });
  splitter.addEventListener("pointermove", onMove);
  splitter.addEventListener("pointerup", onUp);
  splitter.addEventListener("pointercancel", onUp);
  splitter.addEventListener("dblclick", () => {
    setCollapsed(!splitState.collapsed);
  });
  splitter.addEventListener("keydown", (event) => {
    const key = String(event.key || "");
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      setCollapsed(!splitState.collapsed);
      return;
    }
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.shiftKey ? 40 : 16;
    const dir = key === "ArrowLeft" ? -1 : 1;
    const nextW = clampSidebarWidth((splitState.sidebarWidth || 220) + dir * delta);
    splitState.sidebarWidth = nextW;
    splitState.collapsed = false;
    splitState.lastExpandedWidth = nextW;
    applySplitState();
    writeSplitState(splitState);
  });
}

function parsePx(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const n = Number.parseFloat(raw.replace("px", ""));
  return Number.isFinite(n) ? n : 0;
}

function autoResizeUserInput() {
  const ta = nodes.userInput;
  if (!ta) return;
  try {
    const styles = window.getComputedStyle ? window.getComputedStyle(ta) : null;
    const minH = styles ? parsePx(styles.minHeight) : 0;
    const maxH = styles ? parsePx(styles.maxHeight) : 0;
    const max = maxH > 0 ? maxH : Infinity;
    const min = minH > 0 ? minH : 0;

    // Reset to natural height then clamp to CSS min/max.
    ta.style.height = "auto";
    const desired = Math.min(ta.scrollHeight || 0, max);
    const next = Math.max(desired, min);
    ta.style.height = `${Math.ceil(next)}px`;
    ta.style.overflowY = (ta.scrollHeight || 0) > max ? "auto" : "hidden";
  } catch (_error) {
    // ignore
  }
}

function initVoiceTools() {
  // TTS
  const canSpeak = typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance === "function";
  if (!canSpeak) {
    if (nodes.voiceReadBtn) {
      nodes.voiceReadBtn.disabled = true;
      nodes.voiceReadBtn.title = "当前浏览器不支持朗读（speechSynthesis）";
    }
  }
  if (canSpeak) {
    // 有些浏览器需要等 voiceschanged 才能拿到可用音色
    try {
      if (typeof window.speechSynthesis.addEventListener === "function") {
        window.speechSynthesis.addEventListener("voiceschanged", () => {});
      } else {
        window.speechSynthesis.onvoiceschanged = () => {};
      }
    } catch (_error) {
      // ignore
    }
  }

  // STT
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    if (nodes.voiceInputBtn) {
      nodes.voiceInputBtn.disabled = true;
      nodes.voiceInputBtn.title = "当前浏览器不支持语音识别（SpeechRecognition）";
    }
    return;
  }
  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(String(location.hostname || ""))) {
    if (nodes.voiceInputBtn) {
      nodes.voiceInputBtn.disabled = true;
      nodes.voiceInputBtn.title = "语音识别通常需要 HTTPS（localhost 例外）";
    }
    return;
  }

  speechRecognition = new SR();
  speechRecognition.lang = "zh-CN";
  speechRecognition.interimResults = true;
  speechRecognition.continuous = true;

  speechRecognition.onresult = (event) => {
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = String(result?.[0]?.transcript || "").trim();
      if (!text) continue;
      if (result.isFinal) {
        dictationFinal = [dictationFinal, text].filter(Boolean).join(" ").trim();
      } else {
        interimText += (interimText ? " " : "") + text;
      }
    }
    dictationInterim = interimText.trim();
    updateComposerFromDictation();

    if (dictationInterim) {
      setStatus(`状态：听写中… ${dictationInterim.slice(0, 30)}`);
    } else if (dictationFinal) {
      setStatus("状态：已听写一段语音");
    }
  };

  speechRecognition.onerror = (event) => {
    const code = String(event?.error || "unknown");
    dictationActive = false;
    updateVoiceButtons();
    setStatus(`状态：听写失败（${code}）`);
  };

  speechRecognition.onend = () => {
    if (!dictationActive) return;
    // 在非 PTT 模式下，部分浏览器会自动停止；这里做一次友好收尾。
    dictationInterim = "";
    updateComposerFromDictation();
    dictationActive = false;
    updateVoiceButtons();
    setStatus("状态：听写已停止");
  };

  updateVoiceButtons();
}

function updateVoiceButtons() {
  if (nodes.voiceModeBtn) {
    nodes.voiceModeBtn.classList.toggle("btn-toggle-on", voiceModeEnabled);
    if (composerDense) {
      nodes.voiceModeBtn.textContent = voiceModeEnabled ? "语音开" : "语音";
    } else {
      nodes.voiceModeBtn.textContent = "语音模式";
    }
  }
  if (nodes.voiceInputBtn) {
    if (composerDense) {
      nodes.voiceInputBtn.textContent = voiceModeEnabled
        ? (dictationActive ? "说…" : "说话")
        : (dictationActive ? "听…" : "听写");
    } else {
      nodes.voiceInputBtn.textContent = voiceModeEnabled
        ? (dictationActive ? "说话中" : "按住说话")
        : (dictationActive ? "听写中" : "听写");
    }
  }
  if (nodes.voiceReadBtn) {
    nodes.voiceReadBtn.textContent = composerDense ? (speakingActive ? "读…" : "朗读") : (speakingActive ? "朗读中" : "朗读");
  }
}

function toggleDictation() {
  if (!speechRecognition) {
    setStatus("状态：当前浏览器不支持语音识别");
    return;
  }
  if (voiceModeEnabled) {
    // 语音模式是“按住说话”，避免点击触发一闪而过
    setStatus("状态：语音模式下请按住“按住说话”按钮讲话");
    return;
  }
  if (dictationActive) {
    stopDictation();
    return;
  }
  startDictation({ ptt: false });
}

function startDictation(options) {
  const opts = options && typeof options === "object" ? options : {};
  try {
    dictationOriginal = String(nodes.userInput.value || "");
    dictationFinal = "";
    dictationInterim = "";
    dictationActive = true;
    updateVoiceButtons();
    setStatus(opts.ptt ? "状态：按住说话中…" : "状态：听写已开启，请开始说话");
    speechRecognition.continuous = !opts.ptt;
    speechRecognition.start();
  } catch (_error) {
    dictationActive = false;
    updateVoiceButtons();
    setStatus("状态：听写启动失败（可能需要允许麦克风权限）");
  }
}

function stopDictation(options) {
  const opts = options && typeof options === "object" ? options : {};
  dictationActive = false;
  updateVoiceButtons();
  try {
    speechRecognition.stop();
  } catch (_error) {
    // ignore
  }
  dictationInterim = "";
  updateComposerFromDictation();
  setStatus("状态：听写已停止");

  if (opts.autoSend && voiceModeEnabled) {
    const before = String(dictationOriginal || "").trim();
    const after = String(nodes.userInput.value || "").trim();
    if (after && after !== before) {
      // 给浏览器一点时间落地 textarea 更新，再自动发送
      window.setTimeout(() => {
        if (!sending) {
          lastSendFromVoiceInput = true;
          sendMessage();
        }
      }, 120);
    }
  }
}

function stopAllVoice() {
  stopSpeaking();
  if (dictationActive) stopDictation();
}

function updateComposerFromDictation() {
  if (!nodes.userInput) return;
  const base = String(dictationOriginal || "").trimEnd();
  const spoken = [dictationFinal, dictationInterim].filter(Boolean).join(" ").trim();
  const merged = base && spoken ? `${base} ${spoken}` : (base || spoken);
  nodes.userInput.value = merged;
  autoResizeUserInput();
  persistChatState();
}

function toggleVoiceMode() {
  voiceModeEnabled = !voiceModeEnabled;
  autoSpeakEnabled = voiceModeEnabled;
  if (dictationActive) stopDictation({ autoSend: false });
  stopSpeaking();
  updateVoiceButtons();
  persistChatState();
  setStatus(voiceModeEnabled ? "状态：语音模式已开启（按住说话自动发送，自动朗读回复）" : "状态：语音模式已关闭");
}

function speakLastAssistantMessage() {
  const msg = findLastAssistantMessage();
  if (!msg) {
    setStatus("状态：暂无可朗读的助手消息");
    return;
  }
  const text = extractSpeakText(msg.content);
  if (!text) {
    setStatus("状态：该消息没有可朗读的文本内容");
    return;
  }
  speakText(text);
}

function findLastAssistantMessage() {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item && item.role === "assistant" && !item.error) return item;
  }
  return null;
}

function extractSpeakText(content) {
  const blocks = parseMessageBlocks(String(content || ""));
  const texts = blocks
    .filter((b) => b.type === "text")
    .map((b) => String(b.text || "").trim())
    .filter(Boolean);
  const merged = texts.join("\n").trim();
  if (!merged) return "";
  return merged.length > 6000 ? `${merged.slice(0, 6000)}…` : merged;
}

function stopSpeaking() {
  speakingActive = false;
  updateVoiceButtons();
  try {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  } catch (_error) {
    // ignore
  }
}

function speakText(text) {
  const canSpeak = typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance === "function";
  if (!canSpeak) {
    setStatus("状态：当前浏览器不支持朗读");
    return;
  }
  stopSpeaking();

  const utter = new SpeechSynthesisUtterance(String(text || ""));
  utter.lang = "zh-CN";
  utter.rate = clampNumber(ttsRate, 1, 0.6, 1.4);
  utter.pitch = clampNumber(ttsPitch, 1, 0.6, 1.4);
  utter.volume = clampNumber(ttsVolume, 1, 0, 1);
  const preferred = pickBestChineseVoice(ttsPreferredVoiceName);
  if (preferred) utter.voice = preferred;

  utter.onstart = () => {
    speakingActive = true;
    updateVoiceButtons();
  };
  utter.onend = () => {
    speakingActive = false;
    updateVoiceButtons();
  };
  utter.onerror = () => {
    speakingActive = false;
    updateVoiceButtons();
  };

  window.speechSynthesis.speak(utter);
}

function pickBestChineseVoice(preferredName) {
  try {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const byName = String(preferredName || "").trim();
    if (byName) {
      const hit = voices.find((v) => v && v.name === byName);
      if (hit) return hit;
    }
    const zh = voices.filter((v) => String(v?.lang || "").toLowerCase().startsWith("zh"));
    if (!zh.length) return null;
    const score = (v) => {
      const name = String(v?.name || "").toLowerCase();
      let s = 0;
      if (name.includes("microsoft")) s += 6;
      if (name.includes("google")) s += 4;
      if (name.includes("xiaoxiao") || name.includes("xiaoyi") || name.includes("yunxi") || name.includes("yunyang")) s += 5;
      if (name.includes("zh-cn")) s += 2;
      return s;
    };
    return zh.sort((a, b) => score(b) - score(a))[0] || null;
  } catch (_error) {
    return null;
  }
}

function renderProviderOptions() {
  nodes.provider.innerHTML = "";
  Object.entries(providerPresets).forEach(([value, preset]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = preset.label;
    nodes.provider.appendChild(opt);
  });
}

async function loadProfiles() {
  const options = arguments && arguments[0] && typeof arguments[0] === "object" ? arguments[0] : {};
  const forceRemote = !!options.forceRemote;
  const manual = !!options.manual;

  profiles = readProfilesFromConfig();
  let remoteError = null;

  if (!profiles.length || forceRemote) {
    try {
      profiles = await fetchProfilesFromServer();
    } catch (error) {
      remoteError = error;
    }
  } else {
    // 有本地缓存时也做一次后台同步，避免“配置台已改，但对话页不更新”。
    void fetchProfilesFromServer()
      .then((remote) => {
        if (Array.isArray(remote) && remote.length) {
          profiles = remote;
          const previous = pickActiveProfileIndex();
          renderProfileOptions(nodes.profileSelect, profiles, "从配置台加载模型");
          renderProfileOptions(nodes.composerProfileSelect, profiles, "选择配置");
          const next = pickBestProfileIndex(previous, preferredProfileId);
          const activeProfile = next ? profiles[Number(next)] || null : null;
          renderComposerModelOptions(activeProfile, preferredModelId || nodes.model.value.trim());
          if (manual) setStatus(`状态：已从服务端刷新 ${profiles.length} 条模型配置`);
        }
      })
      .catch(() => {});
  }

  const previous = pickActiveProfileIndex();
  renderProfileOptions(nodes.profileSelect, profiles, "从配置台加载模型");
  renderProfileOptions(nodes.composerProfileSelect, profiles, "选择配置");
  const next = pickBestProfileIndex(previous, preferredProfileId);
  let activeProfile = null;
  if (next) {
    nodes.profileSelect.value = next;
    nodes.composerProfileSelect.value = next;
    const profile = profiles[Number(next)] || null;
    activeProfile = profile;
    if (shouldApplyProfileOnLoad(profile, previous)) {
      applyProfile(profile);
      persistChatState();
    }
  } else {
    nodes.profileSelect.value = "";
    nodes.composerProfileSelect.value = "";
    activeProfile = null;
  }
  renderComposerModelOptions(activeProfile, preferredModelId || nodes.model.value.trim());
  persistChatSelectionToCookie();
  if (!profiles.length && remoteError) {
    setStatus(`状态：模型配置加载失败：${remoteError.message || "未知错误"}（请先在配置台保存模型）`);
    return;
  }
  if (manual && forceRemote && remoteError) {
    setStatus(`状态：已加载 ${profiles.length} 条模型配置（服务端刷新失败：${remoteError.message || "未知错误"}）`);
    return;
  }
  setStatus(`状态：已加载 ${profiles.length} 条模型配置`);
}

async function fetchProfilesFromServer() {
  const response = await fetch(REMOTE_CONFIG_API, { method: "GET" });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || `读取模型配置失败（HTTP ${response.status}）`);
  }
  const state = payload && typeof payload === "object" ? payload.state : null;
  if (!state || !Array.isArray(state.models)) return [];
  const serialized = JSON.stringify(state);
  safeLocalStorageSetItem(CONFIG_STORAGE_KEY, serialized);
  safeLocalStorageSetItem(CONFIG_STORAGE_BACKUP_KEY, serialized);
  return state.models.filter((m) => m && typeof m === "object");
}

function renderProfileOptions(selectNode, list, placeholderText) {
  if (!selectNode) return;
  selectNode.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = list.length ? placeholderText : "未发现可用模型";
  selectNode.appendChild(placeholder);

  list.forEach((item, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = `${item.name || "未命名"} · ${item.model || "未填写模型"}`;
    selectNode.appendChild(opt);
  });
}

function pickActiveProfileIndex() {
  const fromHidden = String(nodes.profileSelect?.value || "").trim();
  if (fromHidden) return fromHidden;
  const fromComposer = String(nodes.composerProfileSelect?.value || "").trim();
  if (fromComposer) return fromComposer;
  return findMatchingProfileIndex(collectConfig());
}

function pickBestProfileIndex(candidate, preferredId) {
  const preferred = String(preferredId || "").trim();
  if (preferred) {
    const idx = profiles.findIndex((item) => String(item?.id || "").trim() === preferred);
    if (idx >= 0) return String(idx);
  }
  if (candidate && profiles[Number(candidate)]) return candidate;
  const match = findMatchingProfileIndex(collectConfig());
  if (match) return match;
  if (!profiles.length) return "";
  // 没有匹配时：默认选第一个配置，避免刷新后“需要重新选择”。
  return "0";
}

function findMatchingProfileIndex(config) {
  const provider = String(config?.provider || "").trim();
  const model = String(config?.model || "").trim();
  const baseUrl = String(config?.baseUrl || "").trim();
  const idx = profiles.findIndex(
    (item) =>
      String(item?.provider || "").trim() === provider &&
      String(item?.model || "").trim() === model &&
      String(item?.baseUrl || "").trim() === baseUrl
  );
  return idx >= 0 ? String(idx) : "";
}

async function loadProjects(isManual = false) {
  try {
    const response = await fetch("/api/projects/list");
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || `读取项目失败（HTTP ${response.status}）`);
    }
    const incoming = Array.isArray(payload.projects) ? payload.projects : [];
    const incomingArchived = Array.isArray(payload.archivedProjects) ? payload.archivedProjects : [];
    projects = incoming
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: String(item.name || "").trim() || "未命名项目",
        path: String(item.path || "").trim()
      }))
      .filter((item) => !!item.path);
    archivedProjects = incomingArchived
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: String(item.name || "").trim() || "未命名项目",
        path: String(item.path || "").trim()
      }))
      .filter((item) => !!item.path);
    renderProjectList();

    if (!projects.length) {
      setActiveProject("", { silent: true, preserveIfEmpty: false });
      if (isManual) setStatus("状态：当前没有可用项目（可从已归档恢复）");
      return;
    }

    const exists = projects.some((item) => item.path === activeProjectPath);
    if (!exists) {
      setActiveProject(projects[0].path, { silent: !isManual });
    } else {
      syncHistoryFromProject();
      renderProjectList();
      void syncHistoryFromServer(activeProjectPath, { silent: true });
    }
    if (isManual) {
      setStatus(`状态：已刷新项目，可用 ${projects.length} 个，归档 ${archivedProjects.length} 个`);
    }
  } catch (error) {
    renderProjectList();
    setStatus(`状态：项目列表加载失败：${error.message}`);
  }
}

function renderProjectList() {
  nodes.projectList.innerHTML = "";
  nodes.archivedProjectList.innerHTML = "";
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "project-empty";
    empty.textContent = "暂无可用项目。点击“新建项目”开始，或从下方恢复归档项目。";
    nodes.projectList.appendChild(empty);
  } else {
    projects.forEach((project) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `project-item${project.path === activeProjectPath ? " active" : ""}`;
      btn.addEventListener("click", () => setActiveProject(project.path));

      const name = document.createElement("span");
      name.className = "project-item-name";
      name.textContent = project.name;
      const p = document.createElement("span");
      p.className = "project-item-path";
      p.textContent = project.path;

      const actions = document.createElement("div");
      actions.className = "project-item-actions";
      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "project-action-btn";
      archiveBtn.textContent = "删除";
      archiveBtn.title = "仅归档，不会删除磁盘项目";
      archiveBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        archiveProject(project.path);
      });
      actions.appendChild(archiveBtn);

      btn.appendChild(name);
      btn.appendChild(p);
      btn.appendChild(actions);
      nodes.projectList.appendChild(btn);
    });
  }

  if (!archivedProjects.length) {
    const emptyArchived = document.createElement("div");
    emptyArchived.className = "project-empty";
    emptyArchived.textContent = "暂无归档项目";
    nodes.archivedProjectList.appendChild(emptyArchived);
  } else {
    archivedProjects.forEach((project) => {
      const item = document.createElement("div");
      item.className = "project-item";

      const name = document.createElement("span");
      name.className = "project-item-name";
      name.textContent = project.name;
      const p = document.createElement("span");
      p.className = "project-item-path";
      p.textContent = project.path;
      const actions = document.createElement("div");
      actions.className = "project-item-actions";
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "project-action-btn";
      restoreBtn.textContent = "恢复";
      restoreBtn.addEventListener("click", () => restoreProject(project.path));
      actions.appendChild(restoreBtn);

      item.appendChild(name);
      item.appendChild(p);
      item.appendChild(actions);
      nodes.archivedProjectList.appendChild(item);
    });
  }
  applyArchivedListVisibility();
  updateActiveProjectLabel();
}

function toggleArchivedList() {
  if (!archivedProjects.length) return;
  archivedExpanded = !archivedExpanded;
  applyArchivedListVisibility();
  persistChatState();
}

function applyArchivedListVisibility() {
  const count = archivedProjects.length;
  const text = archivedExpanded ? `收起归档项目（${count}）` : `展开归档项目（${count}）`;
  nodes.archivedToggleBtn.textContent = text;
  nodes.archivedToggleBtn.disabled = count === 0;
  if (count === 0) {
    archivedExpanded = false;
  }
  nodes.archivedProjectList.classList.toggle("is-collapsed", !archivedExpanded || count === 0);
}

async function archiveProject(projectPath) {
  try {
    const response = await fetch("/api/projects/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `归档失败（HTTP ${response.status}）`);
    if (activeProjectPath === projectPath) {
      setActiveProject("", { silent: true, preserveIfEmpty: false });
    }
    await loadProjects();
    setStatus(`状态：项目已归档 ${pathToName(projectPath)}`);
  } catch (error) {
    setStatus(`状态：归档失败：${error.message}`);
  }
}

async function restoreProject(projectPath) {
  try {
    const response = await fetch("/api/projects/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `恢复失败（HTTP ${response.status}）`);
    await loadProjects();
    setActiveProject(projectPath, { silent: true, preserveIfEmpty: false });
    setStatus(`状态：项目已恢复 ${pathToName(projectPath)}`);
  } catch (error) {
    setStatus(`状态：恢复失败：${error.message}`);
  }
}

function setActiveProject(projectPath, options = {}) {
  const nextPath = String(projectPath || "").trim();
  const preserveIfEmpty = options.preserveIfEmpty !== false;
  saveHistoryForActiveProject();
  if (!nextPath && preserveIfEmpty && activeProjectPath) return;
  activeProjectPath = nextPath;
  pendingAttachments = [];
  renderPendingAttachments();
  syncHistoryFromProject();
  renderProjectList();
  renderMessages();
  persistChatState();
  if (activeProjectPath) {
    void syncHistoryFromServer(activeProjectPath, { silent: true });
  }
  if (!options.silent) {
    const label = activeProjectPath ? pathToName(activeProjectPath) : "未选择项目";
    setStatus(`状态：已切换项目 ${label}`);
  }
}

function syncHistoryFromProject() {
  const key = getProjectHistoryKey(activeProjectPath);
  const items = Array.isArray(historyByProject[key]) ? historyByProject[key] : [];
  history = items.map((item) => ({ ...item }));
}

async function syncHistoryFromServer(projectPath, options = {}) {
  const target = String(projectPath || "").trim();
  if (!target) return;
  try {
    const response = await fetch(`/api/chat/history?projectPath=${encodeURIComponent(target)}`);
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || `读取备份失败（HTTP ${response.status}）`);
    }
    const list = Array.isArray(payload.messages) ? payload.messages.filter(isValidMsg) : [];
    const key = getProjectHistoryKey(target);
    const localList = Array.isArray(historyByProject[key]) ? historyByProject[key].filter(isValidMsg) : [];
    const merged = mergeHistoryMessages(localList, list);
    historyByProject[key] = merged;
    if (activeProjectPath === target) {
      history = merged.map((item) => ({ ...item }));
      renderMessages();
      persistChatState();
    }
    if (!options.silent) {
      setStatus(`状态：已同步备份对话 ${pathToName(target)}`);
    }
  } catch (_error) {
    // 备份读取失败时保留本地历史，不打断主流程
  }
}

function mergeHistoryMessages(localList, serverList) {
  const local = Array.isArray(localList) ? localList.filter(isValidMsg) : [];
  const server = Array.isArray(serverList) ? serverList.filter(isValidMsg) : [];
  if (!server.length) return local;
  if (!local.length) return server;

  const localSig = local.map((item) => `${item.role}:${item.content}`).join("\n");
  const serverSig = server.map((item) => `${item.role}:${item.content}`).join("\n");
  if (localSig === serverSig) return server;

  if (local.length > server.length) return local;
  return server;
}

function saveHistoryForActiveProject() {
  const key = getProjectHistoryKey(activeProjectPath);
  historyByProject[key] = history.map((item) => ({ ...item }));
}

function getProjectHistoryKey(projectPath) {
  return String(projectPath || "").trim() || NO_PROJECT_KEY;
}

function updateActiveProjectLabel() {
  nodes.activeProjectName.textContent = activeProjectPath ? pathToName(activeProjectPath) : "未选择";
}

function pathToName(projectPath) {
  const value = String(projectPath || "").trim();
  const parts = value.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "未命名项目";
}

function readProfilesFromConfig() {
  try {
    const raw = safeLocalStorageGetItem(CONFIG_STORAGE_KEY);
    const backupRaw = safeLocalStorageGetItem(CONFIG_STORAGE_BACKUP_KEY);
    const parsed = parseProfilesState(raw) || parseProfilesState(backupRaw);
    if (!parsed || !Array.isArray(parsed.models)) return [];
    return parsed.models.filter((m) => m && typeof m === "object");
  } catch (_error) {
    return [];
  }
}

function parseProfilesState(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function safeLocalStorageGetItem(key) {
  try {
    if (!window.localStorage) return "";
    return window.localStorage.getItem(key);
  } catch (_error) {
    return "";
  }
}

function safeLocalStorageSetItem(key, value) {
  try {
    if (!window.localStorage) return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch (_error) {
    return false;
  }
}

function restoreChatSelectionFromCookie() {
  const raw = safeCookieGet(CHAT_SELECTION_COOKIE_KEY);
  if (!raw) return;
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object") return;
    preferredProfileId = String(parsed.profileId || "").trim();
    preferredModelId = String(parsed.model || "").trim();
    preferredProjectPath = String(parsed.projectPath || "").trim();
  } catch (_error) {
    // ignore
  }
}

function persistChatSelectionToCookie() {
  try {
    const profile = getCurrentProfile();
    const profileId = String(profile?.id || "").trim();
    const model = String(nodes.model?.value || "").trim();
    const projectPath = String(activeProjectPath || "").trim();

    if (profileId) preferredProfileId = profileId;
    if (model) preferredModelId = model;
    if (projectPath) preferredProjectPath = projectPath;

    const payload = JSON.stringify({ profileId, model, projectPath });
    safeCookieSet(CHAT_SELECTION_COOKIE_KEY, encodeURIComponent(payload), {
      maxAgeSec: CHAT_SELECTION_COOKIE_MAX_AGE_SEC
    });
  } catch (_error) {
    // ignore
  }
}

function safeCookieGet(name) {
  try {
    const key = `${String(name || "").trim()}=`;
    const parts = String(document.cookie || "").split(";").map((item) => item.trim());
    for (const part of parts) {
      if (part.startsWith(key)) return part.slice(key.length);
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function safeCookieSet(name, value, options = {}) {
  try {
    const key = String(name || "").trim();
    if (!key) return false;
    const val = String(value || "");
    const maxAgeSec = Number(options.maxAgeSec);
    const pieces = [`${key}=${val}`, "Path=/", "SameSite=Lax"];
    if (Number.isFinite(maxAgeSec) && maxAgeSec > 0) {
      pieces.push(`Max-Age=${Math.floor(maxAgeSec)}`);
    }
    if (location && String(location.protocol) === "https:") {
      pieces.push("Secure");
    }
    document.cookie = pieces.join("; ");
    return true;
  } catch (_error) {
    return false;
  }
}

function installGlobalErrorHandlers() {
  try {
    window.addEventListener("error", (event) => {
      const message = String(event?.message || "脚本错误").trim();
      setStatus(`状态：页面脚本异常：${message}`);
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event?.reason;
      const message = String(reason?.message || reason || "unknown").trim();
      setStatus(`状态：页面脚本异常：${message}`);
    });
  } catch (_error) {
    // ignore
  }
}

function normalizeModelIdList(input) {
  const list = Array.isArray(input) ? input : [];
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

function onProfileChange() {
  const selected = String(this?.value || "").trim();
  if (!selected) return;
  const profile = profiles[Number(selected)];
  if (!profile) return;
  nodes.profileSelect.value = selected;
  nodes.composerProfileSelect.value = selected;
  applyProfile(profile);
  renderComposerModelOptions(profile, preferredModelId || nodes.model.value.trim());
  persistChatState();
  setStatus(`状态：已切换模型 ${profile.model || ""}`.trim());
}

function onComposerModelChange() {
  const selected = String(nodes.composerModelSelect.value || "").trim();
  if (!selected) return;
  nodes.model.value = selected;
  preferredModelId = selected;
  persistChatState();
  setStatus(`状态：已切换模型 ${selected}`);
}

async function refreshComposerModelsFromApi() {
  const config = collectConfig();
  if (!config.baseUrl) {
    setStatus("状态：当前模型缺少接口地址，请到配置台补充");
    return;
  }
  if (!config.apiKey && config.provider !== "ollama") {
    setStatus("状态：当前模型缺少 API 密钥，请到配置台补充");
    return;
  }

  setComposerRefreshLoading(true);
  try {
    const response = await fetch("/api/models/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || `拉取失败（HTTP ${response.status}）`);
    }
    const list = normalizeModelIdList(payload.models);
    const profile = getCurrentProfile();
    if (profile) {
      profile.availableModels = list.slice();
      await persistProfilesToConfigStorage();
    }
    renderComposerModelOptions(profile, config.model);
    setStatus(`状态：已更新可用模型 ${list.length} 个`);
  } catch (error) {
    setStatus(`状态：刷新模型失败：${error.message}`);
  } finally {
    setComposerRefreshLoading(false);
  }
}

function renderComposerModelOptions(profile, preferredModel) {
  const currentModel = String(preferredModel || "").trim() || nodes.model.value.trim();
  const availableList = normalizeModelIdList(profile?.availableModels);
  const list = availableList.slice();
  if (currentModel && !list.includes(currentModel)) {
    list.unshift(currentModel);
  }

  nodes.composerModelSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = list.length
    ? `选择模型（共 ${list.length} 个）`
    : "暂无模型（点“刷新”）";
  nodes.composerModelSelect.appendChild(placeholder);

  list.forEach((modelId) => {
    const opt = document.createElement("option");
    opt.value = modelId;
    opt.textContent = modelId;
    if (modelId === currentModel) {
      opt.selected = true;
    }
    nodes.composerModelSelect.appendChild(opt);
  });

  if (!list.length) {
    nodes.composerModelSelect.value = "";
    return;
  }
  nodes.composerModelSelect.value = list.includes(currentModel) ? currentModel : list[0];
  const selectedModel = String(nodes.composerModelSelect.value || "").trim();
  if (selectedModel && nodes.model.value.trim() !== selectedModel) {
    nodes.model.value = selectedModel;
  }
  if (preferredModelId && currentModel === preferredModelId && availableList.length && !availableList.includes(currentModel)) {
    setStatus(`状态：已恢复上次模型 ${currentModel}（不在可用列表，可能已下线；建议点“刷新”）`);
  }
}

function getCurrentProfile() {
  const idxText = String(nodes.composerProfileSelect.value || nodes.profileSelect.value || "").trim();
  if (!idxText) return null;
  const idx = Number(idxText);
  if (!Number.isInteger(idx) || idx < 0) return null;
  return profiles[idx] || null;
}

async function persistProfilesToConfigStorage() {
  const raw = safeLocalStorageGetItem(CONFIG_STORAGE_KEY);
  const backupRaw = safeLocalStorageGetItem(CONFIG_STORAGE_BACKUP_KEY);
  const parsed = parseProfilesState(raw) || parseProfilesState(backupRaw) || {};
  parsed.models = profiles;
  parsed.updatedAt = new Date().toISOString();
  if (!parsed.defaultModelId && profiles[0]?.id) {
    parsed.defaultModelId = profiles[0].id;
  }
  const serialized = JSON.stringify(parsed);
  safeLocalStorageSetItem(CONFIG_STORAGE_KEY, serialized);
  safeLocalStorageSetItem(CONFIG_STORAGE_BACKUP_KEY, serialized);
  try {
    await fetch(REMOTE_CONFIG_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: parsed })
    });
  } catch (_error) {
    // ignore sync error
  }
}

function setComposerRefreshLoading(loading) {
  nodes.composerRefreshModelsBtn.disabled = loading;
  nodes.composerRefreshModelsBtn.textContent = loading ? "刷新中..." : "刷新";
}

function shouldApplyProfileOnLoad(profile, previousProfileIndex) {
  if (!profile || typeof profile !== "object") return false;
  if (previousProfileIndex && profiles[Number(previousProfileIndex)]) return true;
  const current = collectConfig();
  const hasBase = String(current.baseUrl || "").trim();
  const hasModel = String(current.model || "").trim();
  return !hasBase || !hasModel;
}

function applyProfile(profile) {
  nodes.provider.value = profile.provider || "custom";
  nodes.model.value = profile.model || "";
  nodes.baseUrl.value = profile.baseUrl || "";
  nodes.apiKey.value = profile.apiKey || "";
  nodes.temperature.value = toDisplayNumber(profile.temperature, 0.7);
  nodes.maxTokens.value = toDisplayNumber(profile.maxTokens, 1024);
  nodes.topP.value = toDisplayNumber(profile.topP, 1);
}

function onProviderChange() {
  const preset = providerPresets[nodes.provider.value];
  if (!preset) return;
  if (!nodes.baseUrl.value.trim()) {
    nodes.baseUrl.value = preset.baseUrl;
  }
  persistChatState();
}

async function loadProjectConfig() {
  try {
    const response = await fetch("/api/projects/config");
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || `读取项目配置失败（HTTP ${response.status}）`);
    }
    projectConfig = normalizeProjectConfig(payload.config);
  } catch (_error) {
    projectConfig = normalizeProjectConfig(projectConfig);
  }
  nodes.projectParentInput.value = projectConfig.defaultRoot;
}

function normalizeProjectConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const defaultRoot = String(source.defaultRoot || "").trim() || PROJECTS_FALLBACK_ROOT;
  const list = Array.isArray(source.allowedRoots) ? source.allowedRoots : [];
  const allowedRoots = list.map((item) => String(item || "").trim()).filter(Boolean);
  if (!allowedRoots.length) {
    allowedRoots.push(defaultRoot);
  }
  return {
    defaultRoot,
    allowedRoots
  };
}

function openProjectModal() {
  nodes.projectNameInput.value = "";
  nodes.projectParentInput.value = projectConfig.defaultRoot || PROJECTS_FALLBACK_ROOT;
  nodes.projectTemplateSelect.value = "basic";
  setProjectModalStatus("填写后点击“创建项目”。");
  nodes.projectModal.classList.remove("hidden");
  nodes.projectModal.setAttribute("aria-hidden", "false");
  nodes.projectNameInput.focus();
}

function closeProjectModal(force = false) {
  if (creatingProject && !force) return;
  nodes.projectModal.classList.add("hidden");
  nodes.projectModal.setAttribute("aria-hidden", "true");
}

async function createProjectFromModal() {
  if (creatingProject) return;
  const name = nodes.projectNameInput.value.trim();
  const parentDir = nodes.projectParentInput.value.trim();
  const template = nodes.projectTemplateSelect.value;

  if (!name) {
    setProjectModalStatus("请先填写项目名称。", true);
    return;
  }

  creatingProject = true;
  nodes.projectCreateBtn.disabled = true;
  nodes.projectCreateBtn.textContent = "创建中...";
  setProjectModalStatus("正在创建项目，请稍候...");
  try {
    const response = await fetch("/api/projects/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentDir, template })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || `创建失败（HTTP ${response.status}）`);
    }

    const project = payload.project || {};
    await loadProjects();
    if (project.path) {
      setActiveProject(project.path, { silent: true, preserveIfEmpty: false });
    }
    appendProjectCreatedMessage(project);
    closeProjectModal(true);
    setStatus(`状态：项目已创建 ${project.path || ""}`);
  } catch (error) {
    setProjectModalStatus(`创建失败：${error.message}`, true);
  } finally {
    creatingProject = false;
    nodes.projectCreateBtn.disabled = false;
    nodes.projectCreateBtn.textContent = "创建项目";
  }
}

function appendProjectCreatedMessage(project) {
  const projectPath = String(project.path || "").trim();
  const template = String(project.template || "").trim() || "basic";
  const fileList = Array.isArray(project.createdFiles) ? project.createdFiles : [];

  const lines = [
    "项目创建成功。",
    projectPath ? `路径：\`${projectPath}\`` : "路径：未知",
    `模板：${template}`
  ];
  if (fileList.length) {
    lines.push(`已生成文件：${fileList.join("、")}`);
  }
  if (projectPath) {
    lines.push("", "可在终端执行：", "```bash", `cd ${shellQuote(projectPath)}`, "```");
  }

  history.push({ role: "assistant", content: lines.join("\n") });
  renderMessages();
  persistChatState();
}

function shellQuote(input) {
  return `'${String(input || "").replace(/'/g, "'\\''")}'`;
}

function setProjectModalStatus(text, isError = false) {
  nodes.projectModalStatus.textContent = String(text || "");
  nodes.projectModalStatus.classList.toggle("error", !!isError);
}

function resetChat() {
  history = [];
  pendingAttachments = [];
  renderPendingAttachments();
  renderMessages();
  persistChatState();
  setStatus(`状态：已清空项目对话 ${activeProjectPath ? pathToName(activeProjectPath) : ""}`.trim());
}

function renderMessages() {
  nodes.messages.innerHTML = "";
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    if (!activeProjectPath) {
      empty.textContent = "请先在左侧选择一个项目，然后开始对话。";
    } else {
      empty.textContent = `项目「${pathToName(activeProjectPath)}」还没有消息。先输入你的问题。`;
    }
    nodes.messages.appendChild(empty);
    updateScrollButtons();
    return;
  }

  history.forEach((msg) => {
    const block = document.createElement("div");
    block.className = `msg ${msg.role}${msg.error ? " error" : ""}`;
    const head = document.createElement("div");
    head.className = "msg-head";

    const role = document.createElement("div");
    role.className = "msg-role";
    role.textContent = msg.role === "user" ? "你" : "助手";
    head.appendChild(role);

    const content = document.createElement("div");
    content.className = "msg-content";
    renderMessageContent(content, msg.content);
    block.appendChild(head);
    block.appendChild(content);
    if (msg.role === "user" && Array.isArray(msg.attachments) && msg.attachments.length) {
      block.appendChild(createMessageAttachmentList(msg.attachments));
    }
    nodes.messages.appendChild(block);
  });

  nodes.messages.scrollTop = nodes.messages.scrollHeight;
  updateScrollButtons();
}

function scrollMessagesBy(direction) {
  const distance = Math.max(180, Math.round(nodes.messages.clientHeight * 0.8));
  nodes.messages.scrollBy({
    top: direction > 0 ? distance : -distance,
    behavior: "smooth"
  });
}

function updateScrollButtons() {
  const maxTop = Math.max(0, nodes.messages.scrollHeight - nodes.messages.clientHeight);
  const current = nodes.messages.scrollTop;
  const canUp = current > 4;
  const canDown = current < maxTop - 4;
  nodes.scrollUpBtn.disabled = !canUp;
  nodes.scrollDownBtn.disabled = !canDown;
}

function renderMessageContent(container, text) {
  const blocks = parseMessageBlocks(String(text || ""));
  blocks.forEach((item) => {
    if (item.type === "code") {
      container.appendChild(createCodeBlock(item.code, item.lang, item.autoDetected));
      return;
    }
    if (!item.text.trim()) return;
    container.appendChild(createTextBlock(item.text));
  });
}

function parseMessageBlocks(source) {
  const blocks = [];
  const fencePattern = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let matched = null;

  while ((matched = fencePattern.exec(source)) !== null) {
    if (matched.index > lastIndex) {
      pushTextWithAutoCommandBlocks(blocks, source.slice(lastIndex, matched.index));
    }
    blocks.push({
      type: "code",
      code: stripTrailingNewline(matched[2] || ""),
      lang: (matched[1] || "").trim(),
      autoDetected: false
    });
    lastIndex = fencePattern.lastIndex;
  }

  if (lastIndex < source.length) {
    pushTextWithAutoCommandBlocks(blocks, source.slice(lastIndex));
  }

  if (!blocks.length) {
    return [{ type: "text", text: source }];
  }
  return blocks;
}

function pushTextWithAutoCommandBlocks(blocks, segment) {
  const lines = String(segment || "").split("\n");
  let textBuf = [];
  let codeBuf = [];

  const flushText = () => {
    if (!textBuf.length) return;
    blocks.push({ type: "text", text: textBuf.join("\n") });
    textBuf = [];
  };
  const flushCode = () => {
    if (!codeBuf.length) return;
    blocks.push({
      type: "code",
      code: stripTrailingNewline(codeBuf.join("\n")),
      lang: "bash",
      autoDetected: true
    });
    codeBuf = [];
  };

  lines.forEach((line) => {
    const inCode = codeBuf.length > 0;
    if (isLikelyCommandLine(line, inCode)) {
      flushText();
      codeBuf.push(line);
      return;
    }
    if (inCode && !line.trim()) {
      codeBuf.push(line);
      return;
    }
    flushCode();
    textBuf.push(line);
  });

  flushCode();
  flushText();
}

function isLikelyCommandLine(line, inCodeBlock) {
  const raw = String(line || "");
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^[$#]\s+/.test(trimmed)) return true;
  if (/^[\w.-]+@[\w.-]+:.*[$#]\s+.+/.test(trimmed)) return true;
  if (/^(sudo\s+)?(curl|wget|npm|pnpm|yarn|node|npx|cd|cp|mv|rm|cat|echo|export|unset|git|python|python3|pip|pip3|uv|docker|systemctl|journalctl|ss|ps|rg|sed|awk|chmod|chown|ls|mkdir|touch|ln|nohup|bash|sh|source)\b/.test(trimmed)) {
    return true;
  }
  if (inCodeBlock) {
    if (/^(\|\||&&|\||>|2>|<|\\)$/.test(trimmed)) return true;
    if (/^(-{1,2}[a-zA-Z0-9-]+)/.test(trimmed)) return true;
    if (/^\s+/.test(raw)) return true;
  }
  return false;
}

function createTextBlock(text) {
  const block = document.createElement("p");
  block.className = "msg-text";

  const source = String(text || "");
  const parts = source.split(/(`[^`]+`)/g);
  parts.forEach((part) => {
    if (!part) return;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const code = document.createElement("code");
      code.className = "inline-code";
      code.textContent = part.slice(1, -1);
      block.appendChild(code);
      return;
    }
    block.appendChild(document.createTextNode(part));
  });
  return block;
}

function createCodeBlock(codeText, lang, autoDetected) {
  const wrap = document.createElement("section");
  wrap.className = "code-block";

  const head = document.createElement("div");
  head.className = "code-block-head";

  const tag = document.createElement("span");
  tag.className = "code-tag";
  const normalizedLang = String(lang || "").trim();
  tag.textContent = normalizedLang || (autoDetected ? "命令行" : "代码");

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "复制";
  copyBtn.addEventListener("click", async () => {
    const ok = await copyToClipboard(codeText);
    setStatus(ok ? "状态：已复制命令/代码" : "状态：复制失败，请手动复制");
  });

  head.appendChild(tag);
  head.appendChild(copyBtn);

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = String(codeText || "");
  pre.appendChild(code);

  wrap.appendChild(head);
  wrap.appendChild(pre);
  return wrap;
}

async function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_error) {
    // fall through to legacy copy
  }

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

function stripTrailingNewline(text) {
  return String(text || "").replace(/\s+$/, "");
}

async function onFilesSelected(event) {
  const list = Array.from(event.target.files || []);
  event.target.value = "";
  if (!list.length) return;
  await addPendingFiles(list);
}

async function addPendingFiles(files) {
  const remainSlots = MAX_ATTACH_FILES - pendingAttachments.length;
  if (remainSlots <= 0) {
    setStatus(`状态：最多可附加 ${MAX_ATTACH_FILES} 个文件`);
    return;
  }

  const selected = files.slice(0, remainSlots);
  let added = 0;
  let skipped = 0;
  let totalChars = getPendingAttachmentTotalChars();

  for (const file of selected) {
    const name = file.name || "untitled";
    if (!isTextLikeFile(file)) {
      skipped += 1;
      continue;
    }

    // If inline budget is exhausted, try uploading to library instead of skipping.
    const inlineBudgetLeft = Math.max(0, MAX_ATTACH_TOTAL_CHARS - totalChars);
    const parsed = await parseInputFile(file, { allowLargeForUpload: true });
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const shouldUpload =
      Number(file.size || 0) > MAX_ATTACH_FILE_BYTES ||
      parsed.wasOverCharLimit ||
      inlineBudgetLeft <= 0 ||
      parsed.content.length > inlineBudgetLeft;

    if (shouldUpload) {
      const uploaded = await uploadAttachmentToLibrary({
        name,
        projectPath: activeProjectPath || projects[0]?.path || "",
        content: parsed.fullContent,
        size: Number(file.size || 0)
      });
      if (!uploaded) {
        skipped += 1;
        continue;
      }
      pendingAttachments.push({
        id: buildAttachmentId(file),
        stored: true,
        storedId: uploaded.id,
        name,
        size: Number(file.size || 0),
        content: "",
        charCount: uploaded.charCount,
        truncated: false
      });
      added += 1;
      continue;
    }

    // Inline attach
    const item = {
      id: buildAttachmentId(file),
      stored: false,
      storedId: "",
      name,
      size: Number(file.size || 0),
      content: parsed.content,
      charCount: parsed.content.length,
      truncated: parsed.truncated
    };
    pendingAttachments.push(item);
    totalChars += item.charCount;
    added += 1;
  }

  renderPendingAttachments();
  if (added && skipped) {
    setStatus(`状态：已加入 ${added} 个文件，跳过 ${skipped} 个`);
    return;
  }
  if (added) {
    setStatus(`状态：已加入 ${added} 个文件`);
    return;
  }
  setStatus("状态：未加入文件（可能格式不支持或超过大小限制）");
}

async function parseInputFile(file, options = {}) {
  if (!isTextLikeFile(file)) return null;
  const size = Number(file.size || 0);
  const allowLargeForUpload = !!options.allowLargeForUpload;
  if (!allowLargeForUpload && size > MAX_ATTACH_FILE_BYTES) return null;
  if (allowLargeForUpload && size > MAX_UPLOAD_FILE_BYTES) return null;

  let raw = "";
  try {
    raw = await file.text();
  } catch (_error) {
    return null;
  }

  const fullText = String(raw || "").replace(/\r\n/g, "\n");
  if (!fullText.trim()) return null;
  if (allowLargeForUpload && fullText.length > MAX_UPLOAD_FILE_CHARS) return null;

  let text = fullText;
  let truncated = false;
  let wasOverCharLimit = false;
  if (text.length > MAX_ATTACH_FILE_CHARS) {
    text = text.slice(0, MAX_ATTACH_FILE_CHARS);
    truncated = true;
    wasOverCharLimit = true;
  }
  return { content: text, truncated, fullContent: fullText, wasOverCharLimit };
}

async function uploadAttachmentToLibrary(input) {
  const name = String(input?.name || "").trim() || "untitled.txt";
  const projectPath = String(input?.projectPath || "").trim();
  const content = String(input?.content || "");
  const size = Number(input?.size || 0);

  if (!projectPath) {
    setStatus("状态：请先选择项目后再上传大文件附件");
    return null;
  }
  if (!content.trim()) return null;
  if (size > MAX_UPLOAD_FILE_BYTES) {
    setStatus(`状态：文件过大，当前仅支持上传 ≤ ${Math.floor(MAX_UPLOAD_FILE_BYTES / (1024 * 1024))}MB`);
    return null;
  }
  if (content.length > MAX_UPLOAD_FILE_CHARS) {
    setStatus("状态：文件内容过长，建议先拆分或导出为更短的文本");
    return null;
  }

  try {
    setStatus(`状态：正在保存附件到附件库…（${name}）`);
    const response = await fetch("/api/attachments/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath, name, content })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || `上传失败（HTTP ${response.status}）`);
    }
    const att = payload.attachment || {};
    const id = String(att.id || "").trim();
    const charCount = Number(att.charCount || content.length);
    if (!id) throw new Error("上传成功但未返回附件 id");
    setStatus(`状态：已保存到附件库：${name}`);
    return { id, charCount };
  } catch (error) {
    setStatus(`状态：附件保存失败：${error.message}`);
    return null;
  }
}

function isTextLikeFile(file) {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (mime.includes("json") || mime.includes("xml") || mime.includes("javascript")) return true;
  const ext = getFileExtension(file.name || "");
  return TEXT_FILE_EXTENSIONS.has(ext);
}

function getFileExtension(name) {
  const value = String(name || "").trim();
  const idx = value.lastIndexOf(".");
  if (idx < 0 || idx === value.length - 1) return "";
  return value.slice(idx + 1).toLowerCase();
}

function buildAttachmentId(file) {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name || "file"}`;
}

function getPendingAttachmentTotalChars() {
  return pendingAttachments.reduce((sum, item) => sum + Number(item.charCount || 0), 0);
}

function renderPendingAttachments() {
  if (!nodes.pendingFiles) return;
  nodes.pendingFiles.innerHTML = "";
  if (!pendingAttachments.length) return;

  pendingAttachments.forEach((item) => {
    const row = document.createElement("div");
    row.className = "pending-file-item";

    const text = document.createElement("span");
    text.className = "pending-file-name";
    const suffix = item.stored ? "（已存入附件库）" : item.truncated ? "（已截断）" : "";
    text.textContent = `${item.name} · ${item.charCount} 字符${suffix}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "pending-file-remove";
    removeBtn.textContent = "移除";
    removeBtn.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((x) => x.id !== item.id);
      renderPendingAttachments();
      setStatus("状态：已移除文件");
    });

    row.appendChild(text);
    row.appendChild(removeBtn);
    nodes.pendingFiles.appendChild(row);
  });
}

function createMessageAttachmentList(list) {
  const wrap = document.createElement("div");
  wrap.className = "msg-attachments";
  list.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "msg-attachment-chip";
    const base = `${item.name || "file"} · ${item.charCount || 0} 字符`;
    chip.textContent = item.truncated ? `${base}（已截断）` : base;
    wrap.appendChild(chip);
  });
  return wrap;
}

function buildApiMessagesFromHistory() {
  return history.map((item) => ({
    role: item.role,
    content: String(item.apiContent || item.content || "").trim()
  }));
}

function buildUserApiContent(userText, attachments) {
  const prompt = String(userText || "").trim();
  if (!attachments.length) return prompt;

  const blocks = attachments.map((item, index) => {
    if (item.stored && item.storedId) {
      return `[附件 ${index + 1}] ${item.name}（已存入附件库，按需检索；约 ${item.charCount} 字符）`;
    }
    const header =
      `[附件 ${index + 1}] ${item.name}（${item.charCount} 字符` +
      (item.truncated ? "，已截断）" : "）");
    return `${header}\n${item.content || ""}`;
  });

  if (!prompt) {
    return ["请先阅读并基于以下用户上传文件回复：", blocks.join("\n\n-----\n\n")].join("\n\n");
  }
  return [prompt, "以下是本轮用户上传文件：", blocks.join("\n\n-----\n\n")].join("\n\n");
}

async function sendMessage() {
  if (sending) return;
  if (!activeProjectPath) {
    if (projects.length) {
      activeProjectPath = projects[0].path;
      syncHistoryFromProject();
      renderProjectList();
      persistChatState();
      setStatus(`状态：已自动选择项目 ${pathToName(activeProjectPath)}`);
    } else {
      setStatus("状态：请先在左侧选择项目");
      return;
    }
  }
  const userText = nodes.userInput.value.trim();
  const shouldAutoSpeakThisTurn = lastSendFromVoiceInput;
  lastSendFromVoiceInput = false;
  const attachmentsSnapshot = pendingAttachments.map((item) => ({
    id: item.id,
    name: item.name,
    content: item.content,
    charCount: item.charCount,
    truncated: item.truncated,
    stored: !!item.stored,
    storedId: String(item.storedId || "").trim()
  }));
  if (!userText && !attachmentsSnapshot.length) return;

  const config = collectConfig();
  if (!config.model) {
    setStatus("状态：请先在输入框上方选择模型");
    return;
  }
  if (!config.baseUrl) {
    setStatus("状态：当前模型缺少接口地址，请到配置台补充");
    return;
  }
  if (!config.apiKey && config.provider !== "ollama") {
    setStatus("状态：当前模型缺少 API 密钥，请到配置台补充");
    return;
  }

  const apiUserContent = buildUserApiContent(userText, attachmentsSnapshot);
  history.push({
    role: "user",
    content: userText || "（仅发送附件）",
    apiContent: apiUserContent,
    attachments: attachmentsSnapshot.map((item) => ({
      name: item.name,
      charCount: item.charCount,
      truncated: item.truncated
    }))
  });
  nodes.userInput.value = "";
  autoResizeUserInput();
  pendingAttachments = [];
  renderPendingAttachments();
  renderMessages();
  persistChatState();

  setSending(true);
  try {
    const runChatRequest = async () => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...collectConfig(),
          projectPath: activeProjectPath,
          messages: buildApiMessagesFromHistory(),
          attachments: attachmentsSnapshot
        })
      });
      const payload = await parseJsonResponse(response);
      return { response, payload };
    };

    const { response, payload } = await runChatRequest();
    if (!response.ok) {
      const modelUnsupported = extractModelUnsupportedMessage(payload?.error);
      if (modelUnsupported) {
        const profile = getCurrentProfile();
        const currentModel = nodes.model.value.trim();
        const fallbackModel = pickFallbackModelId(profile, currentModel);
        if (fallbackModel && fallbackModel !== currentModel) {
          preferredModelId = fallbackModel;
          renderComposerModelOptions(profile, fallbackModel);
          persistChatState();
          setStatus(`状态：当前模型不可用，已切换到 ${fallbackModel} 并重试…`);

          const retry = await runChatRequest();
          if (!retry.response.ok) {
            const retryError = retry.payload?.error || `对话失败（HTTP ${retry.response.status}）`;
            throw new Error(`已自动切换模型但仍失败：${retryError}`);
          }
          const assistantText = String(retry.payload.message || "").trim();
          if (!assistantText) {
            throw new Error("接口已响应，但没有返回有效内容");
          }
          history.push({ role: "assistant", content: assistantText });
          renderMessages();
          persistChatState();
          setStatus(`状态：回答完成（已自动切换模型为 ${fallbackModel}）`);
          if ((voiceModeEnabled || autoSpeakEnabled) && shouldAutoSpeakThisTurn) {
            const speakable = extractSpeakText(assistantText);
            if (speakable) speakText(speakable);
          }
          void syncHistoryFromServer(activeProjectPath, { silent: true });
          return;
        }
        throw new Error(`${modelUnsupported}（请在“模型”下拉框选择其它模型，或点“刷新”更新可用模型列表）`);
      }
      throw new Error(payload.error || `对话失败（HTTP ${response.status}）`);
    }

    const assistantText = String(payload.message || "").trim();
    if (!assistantText) {
      throw new Error("接口已响应，但没有返回有效内容");
    }
    history.push({ role: "assistant", content: assistantText });
    renderMessages();
    persistChatState();
    setStatus("状态：回答完成");
    if ((voiceModeEnabled || autoSpeakEnabled) && shouldAutoSpeakThisTurn) {
      const speakable = extractSpeakText(assistantText);
      if (speakable) speakText(speakable);
    }
    void syncHistoryFromServer(activeProjectPath, { silent: true });
  } catch (error) {
    history.push({ role: "assistant", content: `请求失败：${error.message}`, error: true });
    renderMessages();
    persistChatState();
    setStatus("状态：请求失败");
  } finally {
    setSending(false);
  }
}

function extractModelUnsupportedMessage(errorText) {
  const raw = String(errorText || "").trim();
  if (!raw) return "";

  // 可能是上游返回 JSON 被拼进错误字符串里（例如：上游接口错误（400）：{"detail":"..."}）
  let detail = raw;
  const jsonCandidate = extractFirstJsonObject(raw);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (parsed && typeof parsed === "object") {
        const picked =
          parsed.detail ||
          parsed.message ||
          parsed.error?.message ||
          parsed.error ||
          "";
        if (picked) detail = String(picked).trim() || raw;
      }
    } catch (_error) {
      // ignore
    }
  }

  const message = String(detail || raw).trim();
  const isModelRelated =
    (/model/i.test(message) && /not supported/i.test(message)) ||
    (/model/i.test(message) && /not found/i.test(message)) ||
    (/model/i.test(message) && /does not exist/i.test(message)) ||
    (/model/i.test(message) && /not available/i.test(message)) ||
    (/model/i.test(message) && /unsupported/i.test(message));
  if (!isModelRelated) return "";
  return `模型不可用：${message}`;
}

function extractFirstJsonObject(text) {
  const source = String(text || "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  const candidate = source.slice(start, end + 1).trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return "";
  return candidate;
}

function pickFallbackModelId(profile, currentModel) {
  const current = String(currentModel || "").trim();
  const available = normalizeModelIdList(profile?.availableModels);
  const candidates = [
    "gpt-5.2-xhigh",
    "gpt-5.2-high",
    "gpt-5.2",
    "gpt-5.1",
    "gpt-5",
    "gpt-5.3-codex-xhigh",
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "gpt-5.1-codex",
    "gpt-5-codex-mini",
    "gpt-5-codex"
  ];

  const isForbidden = (id) => {
    const v = String(id || "").trim();
    if (!v) return true;
    if (v === current) return true;
    // 避免反复切回同类不可用模型（如 gpt-5.4*）
    if (v.startsWith("gpt-5.4")) return true;
    return false;
  };

  // 优先选“可用列表”里存在的候选
  if (available.length) {
    for (const id of candidates) {
      if (isForbidden(id)) continue;
      if (available.includes(id)) return id;
    }
  } else {
    // 没有可用列表时：直接按候选顺序尝试
    for (const id of candidates) {
      if (isForbidden(id)) continue;
      return id;
    }
  }

  // 其次：从可用列表里挑一个不是当前模型、且不是 gpt-5.4*
  const fallback = available.find((id) => !isForbidden(id));
  return fallback || "";
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
    const snippet = String(raw || "").slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
      `服务返回了非 JSON 响应（HTTP ${response.status}）。` +
        (snippet ? `返回片段：${snippet}` : "请确认本地服务已重启并使用最新代码。")
    );
  }
}

function collectConfig() {
  return {
    provider: nodes.provider.value,
    model: nodes.model.value.trim(),
    baseUrl: nodes.baseUrl.value.trim(),
    apiKey: nodes.apiKey.value.trim(),
    systemPrompt: nodes.systemPrompt.value.trim(),
    temperature: parseFloatOrDefault(nodes.temperature.value, 0.7),
    maxTokens: parseIntOrDefault(nodes.maxTokens.value, 1024),
    topP: parseFloatOrDefault(nodes.topP.value, 1)
  };
}

function setSending(value) {
  sending = value;
  nodes.sendBtn.disabled = value;
  nodes.sendBtn.textContent = value ? "发送中..." : "发送";
  if (value) setStatus("状态：正在请求模型...");
}

function setStatus(text) {
  nodes.status.textContent = text;
}

function persistChatState() {
  saveHistoryForActiveProject();
  const payload = {
    config: collectConfig(),
    activeProjectPath,
    archivedExpanded: !!archivedExpanded,
    historyByProject,
    voice: {
      voiceModeEnabled,
      autoSpeakEnabled,
      ttsPreferredVoiceName,
      ttsRate,
      ttsPitch,
      ttsVolume
    }
  };
  safeLocalStorageSetItem(CHAT_STORAGE_KEY, JSON.stringify(payload));
  persistChatSelectionToCookie();
}

function restoreChatState() {
  try {
    const raw = safeLocalStorageGetItem(CHAT_STORAGE_KEY);
    if (!raw) {
      applyProfile({
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: providerPresets.openai.baseUrl,
        apiKey: "",
        temperature: 0.7,
        maxTokens: 1024,
        topP: 1
      });
      if (preferredProjectPath) {
        activeProjectPath = preferredProjectPath;
      }
      return;
    }

    const parsed = JSON.parse(raw);
    applyProfile(parsed.config || {});
    nodes.systemPrompt.value = parsed.config?.systemPrompt || "";
    historyByProject = normalizeHistoryMap(parsed.historyByProject, parsed.history);
    activeProjectPath = String(parsed.activeProjectPath || "").trim();
    if (!activeProjectPath && preferredProjectPath) {
      activeProjectPath = preferredProjectPath;
    }
    archivedExpanded = !!parsed.archivedExpanded;
    history = (historyByProject[getProjectHistoryKey(activeProjectPath)] || []).filter(isValidMsg);
    // 默认关闭自动语音模式，避免刷新后继续自动朗读造成噪音困扰。
    voiceModeEnabled = false;
    autoSpeakEnabled = false;
    ttsPreferredVoiceName = String(parsed.voice?.ttsPreferredVoiceName || "").trim();
    ttsRate = parseFloatOrDefault(parsed.voice?.ttsRate, 1);
    ttsPitch = parseFloatOrDefault(parsed.voice?.ttsPitch, 1);
    ttsVolume = parseFloatOrDefault(parsed.voice?.ttsVolume, 1);
  } catch (_error) {
    historyByProject = {};
    activeProjectPath = "";
    archivedExpanded = false;
    history = [];
    applyProfile({
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: providerPresets.openai.baseUrl,
      apiKey: "",
      temperature: 0.7,
      maxTokens: 1024,
      topP: 1
    });
  }
}

function normalizeHistoryMap(historyByProjectRaw, legacyHistory) {
  const out = {};
  if (historyByProjectRaw && typeof historyByProjectRaw === "object") {
    Object.entries(historyByProjectRaw).forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      out[String(key || NO_PROJECT_KEY)] = value.filter(isValidMsg);
    });
  }
  if (Array.isArray(legacyHistory) && legacyHistory.length) {
    out[NO_PROJECT_KEY] = legacyHistory.filter(isValidMsg);
  }
  return out;
}

function isValidMsg(item) {
  if (!item || typeof item !== "object") return false;
  if (item.role !== "user" && item.role !== "assistant") return false;
  return typeof item.content === "string";
}

function toDisplayNumber(value, fallback) {
  const result = Number.isFinite(value) ? value : fallback;
  return String(result);
}

function parseFloatOrDefault(value, fallback) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntOrDefault(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
