const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const QRCode = require("qrcode");
const { spawnSync, spawn, execFile } = require("child_process");
const { convertVpnInput } = require("./vpn-convert");
const {
  getTaskExecutorConfigPath,
  loadTaskExecutorConfig,
  normalizeTaskExecutorConfig,
  saveTaskExecutorConfig,
  tryExecuteTaskFromText
} = require("./task-executor");

const port = Number(process.env.PORT || 4173);
const host = String(process.env.HOST || "0.0.0.0").trim() || "0.0.0.0";
const root = __dirname;
const AZURE_OPENAI_API_VERSION = "2024-10-21";
const userHome = os.homedir();
const bridgeConfigPath = path.join(root, "bridge.config.json");
const bridgeExampleConfigPath = path.join(root, "bridge.config.example.json");
const bridgeEnvPath = path.join(userHome, ".config", "openclaw", "bridge.env");
const modelConsoleConfigPath = path.join(userHome, ".config", "openclaw", "model-console.json");
const modelConsoleBackupPath = path.join(userHome, ".config", "openclaw", "model-console.backup.json");
const startupSequencePath = path.join(userHome, ".config", "openclaw", "startup-sequence.json");
const projectsConfigPath = path.join(userHome, ".config", "openclaw", "projects.json");
const projectsStatePath = path.join(userHome, ".config", "openclaw", "projects-state.json");
const vpnConvertHistoryPath = path.join(userHome, ".config", "openclaw", "vpn-convert-history.json");
const vpnSubscriptionsPath = path.join(userHome, ".config", "openclaw", "vpn-subscriptions.json");
const vpnConvertExportDir = path.join(userHome, ".config", "openclaw", "vpn-convert-exports");
const vpnConvertExportTtlMs = clampInt(
  Number(process.env.OPENCLAW_VPN_EXPORT_TTL_MS || 24 * 60 * 60 * 1000),
  24 * 60 * 60 * 1000,
  5 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000
);
const vpnConvertExportMaxItems = clampInt(
  Number(process.env.OPENCLAW_VPN_EXPORT_MAX_ITEMS || 200),
  200,
  20,
  5000
);
const vpnConvertExportMaxBytes = clampInt(
  Number(process.env.OPENCLAW_VPN_EXPORT_MAX_BYTES || 5 * 1024 * 1024),
  5 * 1024 * 1024,
  1024,
  20 * 1024 * 1024
);
const sshHostsConfigPath = path.join(userHome, ".config", "openclaw", "ssh-hosts.json");
const sshManagedKeyDir = path.join(userHome, ".config", "openclaw", "ssh-keys");
const fileManagerAuthConfigPath = path.join(userHome, ".config", "openclaw", "files-auth.json");
const bridgeServiceName = "openclaw-bridge.service";
const webServiceName = "openclaw-web.service";
const webIdeServiceName = "openclaw-web-ide.service";
const cloudflaredServiceNames = ["openclaw-cloudflared.service", "openclaw-cloudflared-b.service"];
const cloudflaredGuardServiceName = "openclaw-cloudflared-guard.service";
const cloudflaredGuardTimerName = "openclaw-cloudflared-guard.timer";
const dashboardServiceUnits = new Set([
  webServiceName,
  webIdeServiceName,
  bridgeServiceName,
  ...cloudflaredServiceNames,
  cloudflaredGuardServiceName,
  cloudflaredGuardTimerName
]);
const cloudflaredGuardScriptPath = path.join(root, "scripts", "ensure-cloudflared-direct.sh");
const mihomoConfigDir = path.join(userHome, ".config", "mihomo-party");
const mihomoOverrideConfigPath = path.join(mihomoConfigDir, "override.yaml");
const mihomoOverrideDir = path.join(mihomoConfigDir, "override");
const mihomoProfileConfigPath = path.join(mihomoConfigDir, "profile.yaml");
const mihomoWorkConfigPath = path.join(mihomoConfigDir, "work", "config.yaml");
const cloudflaredDirectOverrideId = "openclaw-cloudflared-direct";
const cloudflaredDirectOverridePath = path.join(mihomoOverrideDir, `${cloudflaredDirectOverrideId}.yaml`);
const cloudflaredGuardLogPath = path.join(userHome, ".config", "openclaw", "logs", "cloudflared-direct-guard.log");
const telegramWebhookPublicPath = normalizeWebhookProxyPath(
  process.env.OPENCLAW_TELEGRAM_WEBHOOK_PUBLIC_PATH || "/api/telegram/webhook"
);
const telegramWebhookLocalUrl = String(
  process.env.OPENCLAW_TELEGRAM_WEBHOOK_LOCAL_URL || "http://127.0.0.1:4174/telegram/webhook"
).trim();
const telegramWebhookProxyTimeoutMs = clampInt(
  Number(process.env.OPENCLAW_TELEGRAM_WEBHOOK_PROXY_TIMEOUT_MS || 30000),
  30000,
  2000,
  120000
);
const telegramWebhookHealthStatePath = path.join(userHome, ".config", "openclaw", "telegram-webhook-health.json");
const telegramWebhookHealthEventLimit = clampInt(
  Number(process.env.OPENCLAW_TELEGRAM_WEBHOOK_HEALTH_EVENTS || 120),
  120,
  20,
  500
);
const telegramWebhookSelfTestTimeoutMs = clampInt(
  Number(process.env.OPENCLAW_TELEGRAM_WEBHOOK_SELF_TEST_TIMEOUT_MS || 12000),
  12000,
  2000,
  60000
);
const cloudflaredEventLookbackHours = 24;
const cloudflaredDropEventKeywords = [
  "lost connection with the edge",
  "connection with edge closed",
  "context deadline exceeded",
  "quic timeout",
  "failed to serve incoming request",
  "serve tunnel error"
];
const cloudflaredTelegramAlertStatePath = path.join(userHome, ".config", "openclaw", "cloudflared-telegram-alert-state.json");
const cloudflaredTelegramAlertCheckIntervalMs = clampInt(
  Number(process.env.OPENCLAW_CLOUDFLARED_TG_ALERT_CHECK_MS || 2 * 60 * 1000),
  2 * 60 * 1000,
  30 * 1000,
  30 * 60 * 1000
);
const cloudflaredTelegramAlertMinIntervalMs = clampInt(
  Number(process.env.OPENCLAW_CLOUDFLARED_TG_ALERT_MIN_INTERVAL_MS || 10 * 60 * 1000),
  10 * 60 * 1000,
  60 * 1000,
  6 * 60 * 60 * 1000
);
const cloudflaredTelegramAlertStartupDelayMs = clampInt(
  Number(process.env.OPENCLAW_CLOUDFLARED_TG_ALERT_STARTUP_DELAY_MS || 25 * 1000),
  25 * 1000,
  1000,
  5 * 60 * 1000
);
const cloudflaredTelegramAlertConsecutiveThreshold = clampInt(
  Number(process.env.OPENCLAW_CLOUDFLARED_TG_ALERT_CONSECUTIVE_THRESHOLD || 5),
  5,
  1,
  120
);
const runtimeCache = new Map();
const serviceStatusCacheTtlMs = 2000;
const commandCheckCacheTtlMs = 60 * 1000;
const terminalToken = String(process.env.OPENCLAW_TERMINAL_TOKEN || process.env.TERMINAL_TOKEN || "").trim();
const terminalOutputLimit = 200000;
const terminalTimeoutMs = 12000;
const sshOutputLimit = 200000;
const sshDefaultCommandTimeoutMs = 20000;
const sshDefaultConnectTimeoutSec = 8;
const sshTransferMaxBytes = 20 * 1024 * 1024;
const sshDownloadMaxBytes = 100 * 1024 * 1024;
const sshRemoteTextMaxBytes = 1024 * 1024;
const sshInteractiveSessionTtlMs = clampInt(
  Number(process.env.OPENCLAW_SSH_INTERACTIVE_TTL_MS || 30 * 60 * 1000),
  30 * 60 * 1000,
  2 * 60 * 1000,
  24 * 60 * 60 * 1000
);
const sshInteractiveMaxChunks = clampInt(
  Number(process.env.OPENCLAW_SSH_INTERACTIVE_MAX_CHUNKS || 2000),
  2000,
  200,
  10000
);
const sshInteractiveMaxSessions = clampInt(
  Number(process.env.OPENCLAW_SSH_INTERACTIVE_MAX_SESSIONS || 20),
  20,
  1,
  200
);
const startupSequenceDefaults = {
  enabled: false,
  maxCharsPerFile: 6000,
  maxTotalChars: 18000,
  files: []
};
const projectsConfigDefaults = {
  defaultRoot: path.join(userHome, "codex"),
  allowedRoots: [path.join(userHome, "codex")]
};
const projectWorkspaceFileNames = ["SOUL.md", "USER.md", "MEMORY.md", "BOOTSTRAP.md"];
const globalWorkspaceDir = path.join(projectsConfigDefaults.defaultRoot, "workspace");
const chatHistoryPath = path.join(globalWorkspaceDir, "chat-history.json");
const chatHistoryLogPath = path.join(globalWorkspaceDir, "backups", "chat-history.jsonl");
const chatHistoryPerProjectLimit = 2000;
const bridgeEnvKeys = [
  "RC_KEY",
  "TG_BOT_TOKEN",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_VERIFY_TOKEN",
  "FEISHU_ENCRYPT_KEY",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_SIGNING_SECRET",
  "DISCORD_BOT_TOKEN",
  "WECOM_CORP_ID",
  "WECOM_CORP_SECRET",
  "WECOM_AGENT_ID",
  "DINGTALK_APP_KEY",
  "DINGTALK_APP_SECRET",
  "GENERIC_WEBHOOK_SECRET"
];

const attachmentDirName = ".openclaw/attachments";
const attachmentIndexFileName = "index.json";
const attachmentUploadMaxBytes = 20 * 1024 * 1024;
const attachmentContextMaxChars = 16000;
const fileManagerRoot = path.normalize(
  expandHomeDir(String(process.env.OPENCLAW_SHARE_DIR || "/home/weijin/codex/share").trim() || "/home/weijin/codex/share")
);
const fileManagerMetaDirName = ".openclaw";
const fileManagerTempDirName = "tmp";
const fileManagerChunkUploadDirName = "chunk-uploads";
const fileManagerUploadMaxBytes = resolveFileManagerUploadMaxBytes(process.env.OPENCLAW_FILES_UPLOAD_MAX_BYTES);
const fileManagerChunkUploadChunkBytes = clampInt(
  Number(process.env.OPENCLAW_FILES_CHUNK_BYTES || 8 * 1024 * 1024),
  8 * 1024 * 1024,
  512 * 1024,
  32 * 1024 * 1024
);
const fileManagerChunkUploadSessionTtlMs = clampInt(
  Number(process.env.OPENCLAW_FILES_CHUNK_TTL_MS || 24 * 60 * 60 * 1000),
  24 * 60 * 60 * 1000,
  10 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000
);
const fileManagerListMaxItems = clampInt(
  Number(process.env.OPENCLAW_FILES_LIST_MAX_ITEMS || 5000),
  5000,
  200,
  20000
);
const fileManagerPreviewTextMaxBytes = clampInt(
  Number(process.env.OPENCLAW_FILES_PREVIEW_TEXT_MAX_BYTES || 3 * 1024 * 1024),
  3 * 1024 * 1024,
  256 * 1024,
  20 * 1024 * 1024
);
const fileManagerPreviewTextMaxChars = clampInt(
  Number(process.env.OPENCLAW_FILES_PREVIEW_TEXT_MAX_CHARS || 120000),
  120000,
  2000,
  500000
);

const fileManagerNoExtLabel = "noext";
const fileManagerDbFileName = "files.db";
const fileManagerIndexMetaTable = "file_index_meta";
const fileManagerIndexTable = "file_index";
const fileManagerShareTable = "file_share_link";
const fileManagerIndexBootstrapKey = "indexed_at";
const fileManagerShareDefaultTtlSec = resolveFileManagerShareTtlSeconds(process.env.OPENCLAW_FILES_SHARE_TTL_SEC);
const fileManagerOneTimeShareDefaultTtlSec = resolveFileManagerShareTtlSeconds(
  process.env.OPENCLAW_FILES_SHARE_ONETIME_TTL_SEC || 7 * 24 * 60 * 60
);
const fileManagerPublicOrigin = normalizeOptionalOrigin(
  String(process.env.OPENCLAW_FILES_PUBLIC_ORIGIN || "").trim()
);
const fileManagerShareSecretPath = path.join(userHome, ".config", "openclaw", "files-share-secret");
let fileManagerIndexDb = null;
let fileManagerShareSecretCache = "";
const fileManagerImagePreviewExts = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif"
]);
const fileManagerTextPreviewExts = new Set([
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

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};
const fileDownloadMimeTypes = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime"
};
const TASK_PLANNER_SYSTEM_PROMPT = [
  "你是 Linux 命令规划器，只输出 JSON，不要输出 Markdown。",
  '返回格式必须是：{"execute":true|false,"command":"...","reason":"..."}。',
  "规则：",
  "1) 只有用户在请求本机操作时才 execute=true；普通问答或闲聊必须 execute=false。",
  "2) command 必须是单行 bash 命令，不要包含解释。",
  "3) 危险命令必须拒绝：rm -rf /、mkfs、dd 写磁盘、shutdown/reboot/poweroff。",
  "4) 若需求不明确，execute=false。"
].join("\n");

// ===== Microsoft Entra ID (Azure AD) 登录网关 =====
// 说明：用户说的“微软一次性密码/OTP”一般由微软登录页触发 MFA；本站只做 OIDC 登录与会话控制。
// 配置（推荐写到 systemd 环境变量或 ~/.config/openclaw/ms.env）：
// - MS_TENANT_ID: 租户 ID（或 common/organizations/consumers）
// - MS_CLIENT_ID: 应用（客户端）ID
// - MS_CLIENT_SECRET: 机密（可选；若是公共客户端可不填，但推荐填）
// - MS_REDIRECT_URI: 回调地址（例如 http://localhost:4173/auth/callback），必须与 Entra 后台登记一致
// - OPENCLAW_REQUIRE_LOGIN: 1/0（默认：当配置齐全时自动开启）
const msEnvPath = path.join(userHome, ".config", "openclaw", "ms.env");
loadEnvFileIntoProcess(msEnvPath);

const msTenantId = String(process.env.MS_TENANT_ID || "").trim();
const msClientId = String(process.env.MS_CLIENT_ID || "").trim();
const msClientSecret = String(process.env.MS_CLIENT_SECRET || "").trim();
const msRedirectUriOverride = String(process.env.MS_REDIRECT_URI || "").trim();
const msAuthConfigured = !!msTenantId && !!msClientId;
const requireLogin = parseBooleanEnv(process.env.OPENCLAW_REQUIRE_LOGIN, msAuthConfigured);
const requireMfa = parseBooleanEnv(process.env.OPENCLAW_REQUIRE_MFA, false);
const allowedEmails = parseStringListFlexible(process.env.OPENCLAW_ALLOWED_EMAILS || "");
const allowedDomains = parseStringListFlexible(process.env.OPENCLAW_ALLOWED_DOMAINS || "");
const allowedTenants = parseStringListFlexible(process.env.OPENCLAW_ALLOWED_TENANTS || "");
const allowedOids = parseStringListFlexible(process.env.OPENCLAW_ALLOWED_OIDS || "");
const enforceAllowlist = !!(allowedEmails.length || allowedDomains.length || allowedTenants.length || allowedOids.length);

// Guest demo (for occasional sharing). Designed to be safe for public exposure.
// - Guests can only use /guest.html + /api/chat/guest (no /run, no terminal, no workspace writes).
// - Access is gated by time-limited invite tokens.
const guestEnabled = parseBooleanEnv(process.env.OPENCLAW_GUEST_ENABLED, false);
const guestInviteTtlMs = clampInt(Number(process.env.OPENCLAW_GUEST_INVITE_TTL_MS || 60 * 60 * 1000), 60 * 60 * 1000, 5 * 60 * 1000, 24 * 60 * 60 * 1000);
const guestRateLimitPerMin = clampInt(Number(process.env.OPENCLAW_GUEST_RPM || 12), 12, 2, 120);
const guestCookieName = "oc_guest";
const guestSessions = new Map(); // sid -> { createdAt, expiresAt, rate: { windowAt, count } }
const guestInvites = new Map(); // token -> { expiresAt }
const guestAllowedBaseUrls = parseStringListFlexible(process.env.OPENCLAW_GUEST_ALLOWED_BASE_URLS || "");
const guestPublicOrigin = String(process.env.OPENCLAW_GUEST_PUBLIC_ORIGIN || "").trim();
const guestVerifyRpm = clampInt(Number(process.env.OPENCLAW_GUEST_VERIFY_RPM || 30), 30, 5, 300);
const guestVerifyRateByIp = new Map(); // ip -> { windowAt, count }

// Admin auth without Microsoft: support Cloudflare Access headers and optional loopback.
const trustCloudflareAccessHeaders = parseBooleanEnv(process.env.OPENCLAW_TRUST_CF_ACCESS_HEADERS, false);
const allowLocalAdmin = parseBooleanEnv(process.env.OPENCLAW_ALLOW_LOCAL_ADMIN, true);
const adminEmails = parseStringListFlexible(process.env.OPENCLAW_ADMIN_EMAILS || process.env.OPENCLAW_ALLOWED_EMAILS || "");

const sessionCookieName = "oc_session";
const sessionTtlMs = clampInt(Number(process.env.OPENCLAW_SESSION_TTL_MS || 12 * 60 * 60 * 1000), 12 * 60 * 60 * 1000, 5 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
const sessions = new Map(); // sid -> { user, expiresAt }
const fileManagerSessionCookieName = "oc_files_session";
const fileManagerSessionTtlMs = clampInt(Number(process.env.OPENCLAW_FILES_SESSION_TTL_MS || 12 * 60 * 60 * 1000), 12 * 60 * 60 * 1000, 5 * 60 * 1000, 30 * 24 * 60 * 60 * 1000);
const fileManagerSessions = new Map(); // sid -> { user, expiresAt }
const pendingAuth = new Map(); // state -> { verifier, nonce, next, expiresAt }
const pendingDeviceAuth = new Map(); // id -> { device_code, next, intervalSec, expiresAt }
const sshInteractiveSessions = new Map(); // id -> { process, host, chunks, nextSeq, clients, ... }

let msDiscoveryCache = null; // { fetchedAt, doc }
let msJwksCache = null; // { fetchedAt, jwks }
let telegramWebhookHealthState = loadTelegramWebhookHealthState();
let cloudflaredTelegramAlertState = loadCloudflaredTelegramAlertState();
let cloudflaredTelegramAlertRunning = false;

const sshInteractiveCleanupTimer = setInterval(() => {
  cleanupSshInteractiveSessions({ force: false });
}, 60 * 1000);
if (typeof sshInteractiveCleanupTimer?.unref === "function") {
  sshInteractiveCleanupTimer.unref();
}

const cloudflaredTelegramAlertTimer = setInterval(() => {
  void runCloudflaredTelegramAlertCheck("timer");
}, cloudflaredTelegramAlertCheckIntervalMs);
if (typeof cloudflaredTelegramAlertTimer?.unref === "function") {
  cloudflaredTelegramAlertTimer.unref();
}
const cloudflaredTelegramAlertStartupTimer = setTimeout(() => {
  void runCloudflaredTelegramAlertCheck("startup");
}, cloudflaredTelegramAlertStartupDelayMs);
if (typeof cloudflaredTelegramAlertStartupTimer?.unref === "function") {
  cloudflaredTelegramAlertStartupTimer.unref();
}

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const cleanPath = decodeURIComponent((req.url || "/").split("?")[0]);

  // Auth endpoints (不受 requireLogin 限制)
  if (method === "GET" && cleanPath === "/api/auth/info") {
    await handleAuthInfo(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/auth/qr.svg") {
    await handleAuthQrSvg(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/auth/device/start") {
    await handleAuthDeviceStart(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/auth/device/poll") {
    await handleAuthDevicePoll(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/auth/start") {
    await handleAuthStart(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/auth/callback") {
    await handleAuthCallback(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/auth/logout") {
    await handleAuthLogout(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/files/auth/info") {
    await handleFileManagerAuthInfo(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/auth/setup") {
    await handleFileManagerAuthSetup(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/auth/login") {
    await handleFileManagerAuthLogin(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/auth/logout") {
    await handleFileManagerAuthLogout(req, res);
    return;
  }

  // Guest endpoints (部分不受 requireLogin 限制)
  if (method === "GET" && cleanPath === "/api/guest/info") {
    await handleGuestInfo(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/guest/verify") {
    await handleGuestVerify(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/guest/logout") {
    await handleGuestLogout(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/guest/invite") {
    await handleGuestInvite(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/chat/guest") {
    await handleGuestChat(req, res);
    return;
  }

  // Telegram webhook ingress: public endpoint (no login), proxied to local bridge webhook server.
  if (method === "POST" && cleanPath === telegramWebhookPublicPath) {
    await handleTelegramWebhookProxy(req, res);
    return;
  }

  // 全站鉴权网关：未登录时页面跳转到 /login.html，API 返回 401
  const authUser = getAuthUserFromRequest(req);
  if (
    requireLogin &&
    !authUser &&
    !isAuthPublicPath(cleanPath) &&
    !isFileManagerStandalonePath(cleanPath) &&
    !isFileHostBypassPath(req, cleanPath)
  ) {
    if (cleanPath.startsWith("/api/")) {
      sendJson(res, 401, { error: "未登录：请先通过微软登录", login: buildLoginUrl(req) });
      return;
    }
    sendRedirect(res, 302, buildLoginUrl(req));
    return;
  }

  if (method === "POST" && cleanPath === "/api/models/discover") {
    await handleDiscoverModels(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/models/test") {
    await handleTestModel(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/models/config") {
    await handleGetModelConsoleConfig(res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/models/config") {
    await handleSaveModelConsoleConfig(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/terminal/info") {
    await handleTerminalInfo(res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/terminal/run") {
    await handleTerminalRun(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/ssh/config") {
    await handleGetSshConfig(res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/ssh/public-key") {
    await handleGetSshPublicKey(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/private-to-public") {
    await handleSshPrivateToPublic(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/config") {
    await handleSaveSshConfig(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/test") {
    await handleSshTest(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/run") {
    await handleSshRun(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/distribute-key") {
    await handleSshDistributeKey(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/check-public-key") {
    await handleSshCheckPublicKey(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/files/list") {
    await handleSshFileList(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/files/action") {
    await handleSshFileAction(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/files/read-text") {
    await handleSshReadTextFile(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/files/write-text") {
    await handleSshWriteTextFile(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/upload") {
    await handleSshUpload(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/download") {
    await handleSshDownload(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/download-archive") {
    await handleSshDownloadArchive(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/interactive/start") {
    await handleSshInteractiveStart(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/interactive/input") {
    await handleSshInteractiveInput(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/ssh/interactive/stop") {
    await handleSshInteractiveStop(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/ssh/interactive/stream") {
    await handleSshInteractiveStream(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/files/info") {
    await handleGetFileManagerInfo(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/files/list") {
    await handleListFileManagerItems(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/files/tree") {
    await handleGetFileManagerTree(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/upload") {
    await handleUploadFileManagerItem(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/upload/chunk/start") {
    await handleStartFileManagerChunkUpload(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/upload/chunk/part") {
    await handleUploadFileManagerChunkPart(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/upload/chunk/finish") {
    await handleFinishFileManagerChunkUpload(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/files/preview") {
    await handlePreviewFileManagerItem(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/files/download") {
    await handleDownloadFileManagerItem(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/delete") {
    await handleDeleteFileManagerItems(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/rename") {
    await handleRenameFileManagerItem(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/folder") {
    await handleCreateFileManagerFolder(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/share") {
    await handleCreateFileManagerShareLink(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/files/zip") {
    await handleZipFileManagerItems(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/attachments/upload") {
    await handleUploadAttachment(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/chat") {
    await handleChat(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/startup-sequence") {
    await handleGetStartupSequence(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/startup-sequence") {
    await handleSaveStartupSequence(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/task-executor") {
    await handleGetTaskExecutor(res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/task-executor") {
    await handleSaveTaskExecutor(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/projects/config") {
    await handleGetProjectsConfig(res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/projects/list") {
    await handleListProjects(res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/projects/archive") {
    await handleArchiveProject(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/projects/restore") {
    await handleRestoreProject(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/projects/create") {
    await handleCreateProject(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/chat/history") {
    await handleGetChatHistory(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/integrations/config") {
    await handleGetIntegrationsConfig(res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/integrations/config") {
    await handleSaveIntegrationsConfig(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/integrations/service") {
    await handleGetIntegrationsService(res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/integrations/service") {
    await handleIntegrationsServiceAction(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/integrations/test") {
    await handleIntegrationsTest(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/network/info") {
    await handleGetNetworkInfo(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/vpn-convert/history") {
    await handleGetVpnConvertHistory(res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/vpn-subscriptions") {
    await handleGetVpnSubscriptions(res);
    return;
  }
  if (method === "GET" && cleanPath.startsWith("/api/vpn-convert/export/")) {
    await handleGetVpnConvertExport(req, res, cleanPath);
    return;
  }
  if (method === "POST" && cleanPath === "/api/vpn-convert") {
    await handleVpnConvert(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/vpn-convert/export-link") {
    await handleCreateVpnConvertExportLink(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/vpn-subscriptions/save") {
    await handleSaveVpnSubscriptions(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/vpn-subscriptions/delete") {
    await handleDeleteVpnSubscription(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/vpn-convert/history/delete") {
    await handleDeleteVpnConvertHistory(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/vpn-convert/history/clear") {
    await handleClearVpnConvertHistory(res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/cloudflared/guard") {
    await handleGetCloudflaredGuard(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/cloudflared/guard") {
    await handlePostCloudflaredGuard(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/cloudflared/telegram/test") {
    await handlePostCloudflaredTelegramTest(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/telegram/webhook/health") {
    await handleGetTelegramWebhookHealth(req, res);
    return;
  }
  if (method === "POST" && cleanPath === "/api/telegram/webhook/self-test") {
    await handlePostTelegramWebhookSelfTest(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/services/dashboard") {
    await handleGetServicesDashboard(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/services/links") {
    await handleGetServicesLinks(req, res);
    return;
  }
  if (method === "GET" && cleanPath === "/api/services/logs") {
    await handleGetServiceLogs(req, res);
    return;
  }
  if (cleanPath.startsWith("/api/")) {
    sendJson(res, 404, { error: `接口不存在：${cleanPath}` });
    return;
  }

  if (isFileManagerHostRequest(req) && (cleanPath === "/" || cleanPath === "/index.html")) {
    sendRedirect(res, 302, "/files.html");
    return;
  }

  if (isGuestHostRequest(req) && (cleanPath === "/" || cleanPath === "/index.html" || cleanPath === "/services.html")) {
    sendRedirect(res, 302, "/guest.html");
    return;
  }

  if (isClawHostRequest(req) && (cleanPath === "/vpn-convert.html" || cleanPath === "/vpn-subscriptions.html")) {
    const fileOrigin = deriveFilePublicOrigin(req);
    if (fileOrigin) {
      sendRedirect(res, 302, `${fileOrigin}${cleanPath}`);
      return;
    }
  }

  if (
    cleanPath === "/files.html" ||
    cleanPath === "/files.css" ||
    cleanPath === "/files.js" ||
    cleanPath === "/files-login.html" ||
    cleanPath === "/files-login.css" ||
    cleanPath === "/files-login.js" ||
    cleanPath === "/uploads.html" ||
    cleanPath === "/uploads.css" ||
    cleanPath === "/uploads.js"
  ) {
    if (cleanPath !== "/files-login.html" && cleanPath !== "/files-login.css" && cleanPath !== "/files-login.js") {
      const auth = ensureFileManagerAuth(req, res, { api: false });
      if (!auth) return;
    }
  }

  const relativePath = cleanPath === "/" ? "/services.html" : cleanPath;
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("未找到资源");
      return;
    }
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || "application/octet-stream";
    // Avoid stale asset caching (important when served behind Cloudflare Access/Tunnel).
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

function isAuthPublicPath(cleanPath) {
  const p = String(cleanPath || "/");
  return (
    p === "/login.html" ||
    p === "/login.css" ||
    p === "/login.js" ||
    p === "/files-login.html" ||
    p === "/files-login.css" ||
    p === "/files-login.js" ||
    p === "/favicon.ico" ||
    (guestEnabled &&
      (p === "/guest.html" ||
        p === "/guest.css" ||
        p === "/guest.js"))
  );
}

function isFileManagerStandalonePath(cleanPath) {
  const p = String(cleanPath || "/");
  return (
    p === "/files.html" ||
    p === "/files.css" ||
    p === "/files.js" ||
    p === "/files-login.html" ||
    p === "/files-login.css" ||
    p === "/files-login.js" ||
    p === "/uploads.html" ||
    p === "/uploads.css" ||
    p === "/uploads.js" ||
    p.startsWith("/api/files/")
  );
}

function buildLoginUrl(req) {
  const next = typeof req?.url === "string" && req.url ? req.url : "/chat.html";
  return `/login.html?next=${encodeURIComponent(next)}`;
}

function buildFileManagerLoginUrl(req) {
  const next = typeof req?.url === "string" && req.url ? req.url : "/files.html";
  return `/files-login.html?next=${encodeURIComponent(next)}`;
}

function getAuthUserFromRequest(req) {
  const cookies = parseCookies(String(req?.headers?.cookie || ""));
  const sid = String(cookies[sessionCookieName] || "").trim();
  if (!sid) return null;
  const entry = sessions.get(sid);
  if (!entry) return null;
  if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return entry.user || null;
}

async function handleAuthInfo(req, res) {
  const user = getAuthUserFromRequest(req);
  sendJson(res, 200, {
    requireLogin,
    requireMfa,
    configured: msAuthConfigured,
    allowlist: {
      enabled: enforceAllowlist,
      allowedEmailsCount: allowedEmails.length,
      allowedDomainsCount: allowedDomains.length,
      allowedTenantsCount: allowedTenants.length,
      allowedOidsCount: allowedOids.length
    },
    ms: {
      tenantId: msTenantId || null,
      clientId: msClientId ? `${msClientId.slice(0, 6)}...` : null,
      redirectUri: msRedirectUriOverride || null
    },
    user
  });
}

async function handleGetNetworkInfo(req, res) {
  const cfRay = String(req?.headers?.["cf-ray"] || "").trim();
  const cfConnectingIp = String(req?.headers?.["cf-connecting-ip"] || "").trim();
  const cfIpCountry = String(req?.headers?.["cf-ipcountry"] || "").trim().toUpperCase();
  const xForwardedFor = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const forwarded = String(req?.headers?.forwarded || "").trim();
  const hostHeader = String(req?.headers?.host || "").trim();
  const remoteAddress = String(req?.socket?.remoteAddress || "").trim();
  const colo = parseCloudflareRayColo(cfRay);
  const network = classifyNetworkPath({
    colo,
    loc: cfIpCountry
  });

  sendJson(res, 200, {
    ok: true,
    now: new Date().toISOString(),
    request: {
      host: hostHeader,
      origin: getRequestOrigin(req),
      path: String(req?.url || "/").trim() || "/",
      userAgent: String(req?.headers?.["user-agent"] || "").trim()
    },
    client: {
      ip: getClientIp(req),
      cfConnectingIp,
      xForwardedFor,
      remoteAddress,
      country: cfIpCountry || "",
      viaCloudflare: !!cfRay || !!cfConnectingIp
    },
    cloudflare: {
      ray: cfRay,
      colo,
      forwarded
    },
    server: {
      host,
      port,
      isFileManagerHost: isFileManagerHostRequest(req),
      isDirectLocalRequest: isDirectLocalRequest(req)
    },
    network
  });
}

async function handleVpnConvert(req, res) {
  try {
    const payload = await readJsonBody(req);
    const input = String(payload?.input || "").trim();
    const options = {
      maxNodes: clampInt(payload?.maxNodes, 500, 1, 5000),
      dedupeMode: String(payload?.dedupeMode || "endpoint").trim().toLowerCase(),
      protocols: Array.isArray(payload?.protocols) ? payload.protocols : [],
      region: String(payload?.region || "all").trim().toLowerCase(),
      keyword: String(payload?.keyword || "").trim()
    };
    const result = await convertVpnInput(input, {
      ...options,
      fetchText: async (url) => requestText(url, {
        method: "GET",
        headers: {
          "User-Agent": "OpenClaw/1.0 VPN Converter"
        },
        timeoutMs: resolveRequestTimeoutMs(payload?.timeoutMs)
      })
    });
    if (result?.summary?.rawTotal > 0 || result?.summary?.total > 0) {
      saveVpnConvertHistoryEntry({
        input,
        options,
        result
      });
    }
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "节点转换失败" });
  }
}

async function handleCreateVpnConvertExportLink(req, res) {
  try {
    const payload = await readJsonBody(req, { maxBytes: vpnConvertExportMaxBytes * 2 + 64 * 1024 });
    const text = String(payload?.text || "");
    const trimmed = text.trim();
    if (!trimmed) {
      sendJson(res, 400, { error: "缺少可导出的转换结果" });
      return;
    }
    const byteSize = Buffer.byteLength(text, "utf8");
    if (byteSize > vpnConvertExportMaxBytes) {
      sendJson(res, 413, { error: `结果过大，当前上限 ${Math.floor(vpnConvertExportMaxBytes / 1024)}KB` });
      return;
    }

    const ext = normalizeVpnConvertExportExt(payload?.ext);
    const mime = normalizeVpnConvertExportMime(payload?.mime, ext);
    const tabSegment = normalizeVpnConvertExportTab(payload?.tab);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + vpnConvertExportTtlMs).toISOString();
    const id = `vpnexp-${randomBase64Url(10)}`;
    const fileName = sanitizeUploadFileName(`openclaw-${tabSegment}-${formatVpnConvertExportStamp(now)}.${ext}`);
    const dataFile = `${id}.${ext}`;
    const metaFile = `${id}.json`;

    fs.mkdirSync(vpnConvertExportDir, { recursive: true });
    fs.writeFileSync(path.join(vpnConvertExportDir, dataFile), text, "utf8");
    fs.writeFileSync(
      path.join(vpnConvertExportDir, metaFile),
      `${JSON.stringify(
        {
          id,
          fileName,
          mime,
          ext,
          size: byteSize,
          createdAt,
          expiresAt,
          dataFile
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    cleanupVpnConvertExports({ maxItems: vpnConvertExportMaxItems });
    const url = `${getRequestOrigin(req)}/api/vpn-convert/export/${encodeURIComponent(id)}`;
    sendJson(res, 200, { ok: true, id, url, fileName, mime, size: byteSize, expiresAt });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "生成下载链接失败" });
  }
}

async function handleGetVpnConvertExport(_req, res, cleanPath) {
  try {
    const prefix = "/api/vpn-convert/export/";
    const rawId = decodeURIComponent(String(cleanPath || "").slice(prefix.length));
    const id = String(rawId || "").trim();
    if (!/^vpnexp-[A-Za-z0-9_-]{8,80}$/.test(id)) {
      sendJson(res, 400, { error: "下载链接无效" });
      return;
    }

    const meta = loadVpnConvertExportMeta(id);
    if (!meta) {
      sendJson(res, 404, { error: "下载链接不存在或已失效" });
      return;
    }

    const expiresAtMs = Date.parse(meta.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      removeVpnConvertExportFiles(id, meta);
      sendJson(res, 410, { error: "下载链接已过期" });
      return;
    }

    const dataPath = path.join(vpnConvertExportDir, path.basename(meta.dataFile || `${id}.${meta.ext}`));
    if (!fs.existsSync(dataPath)) {
      removeVpnConvertExportFiles(id, meta);
      sendJson(res, 404, { error: "下载文件不存在" });
      return;
    }

    const content = fs.readFileSync(dataPath);
    const fileName = sanitizeUploadFileName(String(meta.fileName || `openclaw-export.${meta.ext || "txt"}`));
    const mime = normalizeVpnConvertExportMime(meta.mime, meta.ext);
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
    });
    res.end(content);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "下载失败" });
  }
}

async function handleGetVpnConvertHistory(res) {
  try {
    const state = loadVpnConvertHistoryState();
    sendJson(res, 200, {
      ok: true,
      updatedAt: state.updatedAt,
      items: state.items
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取转换历史失败" });
  }
}

async function handleGetVpnSubscriptions(res) {
  try {
    const state = loadVpnSubscriptionState();
    sendJson(res, 200, {
      ok: true,
      updatedAt: state.updatedAt,
      items: state.items
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取订阅列表失败" });
  }
}

async function handleSaveVpnSubscriptions(req, res) {
  try {
    const payload = await readJsonBody(req, { maxBytes: 512 * 1024 });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const current = loadVpnSubscriptionState();
    saveVpnSubscriptionState({
      ...current,
      updatedAt: new Date().toISOString(),
      items
    });
    const next = loadVpnSubscriptionState();
    sendJson(res, 200, { ok: true, updatedAt: next.updatedAt, items: next.items });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "保存订阅列表失败" });
  }
}

async function handleDeleteVpnSubscription(req, res) {
  try {
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const targetId = String(payload?.id || "").trim();
    if (!targetId) {
      sendJson(res, 400, { error: "缺少订阅 ID" });
      return;
    }
    const state = loadVpnSubscriptionState();
    const nextItems = state.items.filter((item) => item.id !== targetId);
    saveVpnSubscriptionState({
      ...state,
      updatedAt: new Date().toISOString(),
      items: nextItems
    });
    sendJson(res, 200, {
      ok: true,
      removed: state.items.length - nextItems.length,
      updatedAt: new Date().toISOString(),
      items: nextItems
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "删除订阅失败" });
  }
}

async function handleDeleteVpnConvertHistory(req, res) {
  try {
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const targetId = String(payload?.id || "").trim();
    if (!targetId) {
      sendJson(res, 400, { error: "缺少历史记录 ID" });
      return;
    }
    const state = loadVpnConvertHistoryState();
    const nextItems = state.items.filter((item) => item.id !== targetId);
    saveVpnConvertHistoryState({
      ...state,
      updatedAt: new Date().toISOString(),
      items: nextItems
    });
    sendJson(res, 200, { ok: true, removed: state.items.length - nextItems.length, items: nextItems });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "删除历史记录失败" });
  }
}

async function handleClearVpnConvertHistory(res) {
  try {
    saveVpnConvertHistoryState({
      version: 1,
      updatedAt: new Date().toISOString(),
      items: []
    });
    sendJson(res, 200, { ok: true, items: [] });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "清空历史失败" });
  }
}

async function handleGetCloudflaredGuard(_req, res) {
  try {
    sendJson(res, 200, getCloudflaredGuardSnapshot());
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取 cloudflared 状态失败" });
  }
}

async function handlePostCloudflaredGuard(req, res) {
  try {
    const admin = getAdminUserFromRequest(req);
    if (!admin) {
      sendJson(res, 401, { error: "未授权：只有管理员可执行修复" });
      return;
    }

    const payload = await readJsonBody(req).catch(() => ({}));
    const action = String(payload?.action || "run_fix").trim().toLowerCase();
    if (action !== "run_fix" && action !== "restart_tunnels") {
      sendJson(res, 400, { error: "仅支持 action=run_fix 或 action=restart_tunnels" });
      return;
    }

    const execution = action === "restart_tunnels" ? restartCloudflaredServices() : runCloudflaredGuardScript();
    const snapshot = getCloudflaredGuardSnapshot();
    const statusCode = execution.ok ? 200 : 500;
    sendJson(res, statusCode, {
      ok: execution.ok,
      action,
      executedAt: new Date().toISOString(),
      execution,
      snapshot
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "执行修复失败" });
  }
}

async function handlePostCloudflaredTelegramTest(req, res) {
  try {
    const admin = getAdminUserFromRequest(req);
    if (!admin) {
      sendJson(res, 401, { error: "未授权：只有管理员可发送 Telegram 测试告警" });
      return;
    }

    const payload = await readJsonBody(req).catch(() => ({}));
    const target = resolveCloudflaredTelegramAlertTarget();
    if (!target.enabled) {
      sendJson(res, 400, { error: target.reason || "Telegram 告警未启用或配置不完整" });
      return;
    }

    const snapshot = getCloudflaredGuardSnapshot();
    const summary = snapshot?.summary || {};
    const events = snapshot?.events || {};
    const testText = [
      "OpenClaw 隧道告警测试",
      `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
      `结论：${summary.label || "-"}`,
      `说明：${summary.detail || "-"}`,
      `15分钟掉线：${events.dropCount15m ?? "-"}`,
      `自动恢复：${events.autoRecovered ? "是" : "否"}`,
      payload?.note ? `备注：${String(payload.note).slice(0, 120)}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    const result = await sendTelegramTextToTargets(target, testText);
    const statusCode = result.ok ? 200 : 502;
    sendJson(res, statusCode, {
      ok: result.ok,
      target: {
        apiBase: target.apiBase,
        chatIds: target.chatIds
      },
      result
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "发送 Telegram 测试告警失败" });
  }
}

async function handleGetTelegramWebhookHealth(req, res) {
  try {
    const snapshot = await buildTelegramWebhookHealthSnapshot(req);
    sendJson(res, 200, snapshot);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取 Telegram Webhook 状态失败" });
  }
}

async function handlePostTelegramWebhookSelfTest(req, res) {
  try {
    const admin = getAdminUserFromRequest(req);
    if (!admin) {
      sendJson(res, 401, { error: "未授权：只有管理员可执行 Webhook 自检" });
      return;
    }

    const telegramConfig = resolveTelegramWebhookHealthConfig();
    if (!telegramConfig.telegram.enabled) {
      sendJson(res, 400, { error: "telegram.enabled=false，当前未启用 Telegram" });
      return;
    }
    if (telegramConfig.telegram.mode !== "webhook") {
      sendJson(res, 400, { error: "当前不是 Webhook 模式（telegram.mode 不是 webhook）" });
      return;
    }
    if (!telegramConfig.bridge.botTokenConfigured) {
      sendJson(res, 400, { error: "Telegram botToken 未配置，无法做 Webhook 自检" });
      return;
    }

    const payload = {
      update_id: Math.floor(Date.now() / 1000),
      webhook_health_check: true,
      message: {
        message_id: 0,
        date: Math.floor(Date.now() / 1000),
        text: "",
        chat: { id: 0, type: "private" },
        from: { id: 0, is_bot: true, first_name: "openclaw-check" }
      }
    };

    const headers = {
      "Content-Type": "application/json"
    };
    if (telegramConfig.bridge.secretConfigured && telegramConfig.bridge.secretToken) {
      headers["X-Telegram-Bot-Api-Secret-Token"] = telegramConfig.bridge.secretToken;
    }

    const startedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}${telegramWebhookPublicPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(telegramWebhookSelfTestTimeoutMs)
    });
    const durationMs = Math.max(0, Date.now() - startedAt);
    const raw = await response.text();
    const text = String(raw || "").trim();

    sendJson(res, response.ok ? 200 : 502, {
      ok: response.ok,
      status: response.status,
      durationMs,
      responseSnippet: text.slice(0, 400),
      snapshot: await buildTelegramWebhookHealthSnapshot(req)
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "执行 Webhook 自检失败" });
  }
}

async function handleGetServicesDashboard(req, res) {
  try {
    sendJson(res, 200, getServicesDashboardSnapshot(req));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取服务导航状态失败" });
  }
}

async function handleGetServicesLinks(req, res) {
  try {
    sendJson(res, 200, getServicesLinksSnapshot(req));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取服务导航入口失败" });
  }
}

async function handleGetServiceLogs(req, res) {
  try {
    const { query } = parseUrl(req.url || "/api/services/logs");
    const unit = String(query.unit || "").trim();
    if (!unit || !dashboardServiceUnits.has(unit)) {
      sendJson(res, 400, { error: "服务单元不存在或不允许查看日志" });
      return;
    }
    const lines = clampInt(Number(query.lines || 60), 60, 10, 200);
    sendJson(res, 200, getServiceLogs(unit, lines));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取服务日志失败" });
  }
}

async function handleAuthStart(req, res) {
  if (!msAuthConfigured) {
    sendJson(res, 500, { error: "未配置微软登录：请设置 MS_TENANT_ID 与 MS_CLIENT_ID（以及可选的 MS_CLIENT_SECRET、MS_REDIRECT_URI）" });
    return;
  }

  const { query } = parseUrl(req.url || "/auth/start");
  const next = normalizeNextPath(String(query.next || "/chat.html"));

  const state = randomBase64Url(24);
  const nonce = randomBase64Url(24);
  const verifier = randomBase64Url(48);
  const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());

  pendingAuth.set(state, {
    verifier,
    nonce,
    next,
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const redirectUri = getMicrosoftRedirectUri(req);
  const authorizeUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(msTenantId)}/oauth2/v2.0/authorize`);
  authorizeUrl.searchParams.set("client_id", msClientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_mode", "query");
  authorizeUrl.searchParams.set("scope", "openid profile email");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("prompt", "select_account");

  sendRedirect(res, 302, authorizeUrl.toString());
}

async function handleAuthCallback(req, res) {
  try {
    if (!msAuthConfigured) {
      sendRedirect(res, 302, "/login.html?err=not_configured");
      return;
    }

    const { query } = parseUrl(req.url || "/auth/callback");
    const code = String(query.code || "").trim();
    const state = String(query.state || "").trim();
    if (!code || !state) {
      sendRedirect(res, 302, "/login.html?err=missing_code");
      return;
    }

    const pending = pendingAuth.get(state);
    pendingAuth.delete(state);
    if (!pending || !pending.verifier || !pending.nonce || !pending.next || !pending.expiresAt || pending.expiresAt <= Date.now()) {
      sendRedirect(res, 302, "/login.html?err=bad_state");
      return;
    }

    const redirectUri = getMicrosoftRedirectUri(req);
    const token = await exchangeMicrosoftCodeForToken({
      code,
      verifier: pending.verifier,
      redirectUri
    });

    const claims = await verifyMicrosoftIdToken(token.id_token, { nonce: pending.nonce });
    if (requireMfa && !hasMfaFromMicrosoftClaims(claims)) {
      sendRedirect(res, 302, "/login.html?err=mfa_required");
      return;
    }
    if (enforceAllowlist && !isAllowedMicrosoftUser(claims)) {
      sendRedirect(res, 302, "/login.html?err=not_allowed");
      return;
    }
    const user = {
      name: String(claims.name || "").trim() || null,
      username: String(claims.preferred_username || claims.upn || claims.email || "").trim() || null,
      oid: String(claims.oid || "").trim() || null,
      tid: String(claims.tid || "").trim() || null,
      sub: String(claims.sub || "").trim() || null
    };

    const sid = randomBase64Url(32);
    sessions.set(sid, { user, expiresAt: Date.now() + sessionTtlMs });

    setCookie(res, sessionCookieName, sid, {
      httpOnly: true,
      sameSite: "Lax",
      secure: isRequestHttps(req),
      path: "/",
      maxAgeSec: Math.floor(sessionTtlMs / 1000)
    });

    sendRedirect(res, 302, pending.next || "/chat.html");
  } catch (_error) {
    sendRedirect(res, 302, "/login.html?err=callback_failed");
  }
}

async function handleAuthQrSvg(req, res) {
  try {
    const { query } = parseUrl(req.url || "/api/auth/qr.svg");
    const text = String(query.text || "").trim();
    if (!text) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("缺少 text");
      return;
    }
    const svg = await QRCode.toString(text, { type: "svg", margin: 1, width: 240 });
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(svg);
  } catch (_error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("生成二维码失败");
  }
}

async function handleAuthDeviceStart(req, res) {
  try {
    if (!msAuthConfigured) {
      sendJson(res, 500, { error: "未配置微软登录：请先设置 MS_TENANT_ID 与 MS_CLIENT_ID" });
      return;
    }
    const payload = await readJsonBody(req);
    const next = normalizeNextPath(String(payload?.next || "/chat.html"));
    const device = await startMicrosoftDeviceCode();
    const id = randomBase64Url(18);
    pendingDeviceAuth.set(id, {
      device_code: device.device_code,
      next,
      intervalSec: clampInt(Number(device.interval || 5), 5, 1, 30),
      expiresAt: Date.now() + clampInt(Number(device.expires_in || 900), 900, 60, 3600) * 1000
    });
    sendJson(res, 200, {
      id,
      user_code: device.user_code,
      verification_uri: device.verification_uri,
      verification_uri_complete: device.verification_uri_complete || null,
      message: device.message || null,
      interval: clampInt(Number(device.interval || 5), 5, 1, 30),
      expires_in: clampInt(Number(device.expires_in || 900), 900, 60, 3600)
    });
  } catch (error) {
    sendJson(res, 502, { error: error.message || "设备码登录初始化失败" });
  }
}

async function handleAuthDevicePoll(req, res) {
  try {
    if (!msAuthConfigured) {
      sendJson(res, 500, { error: "未配置微软登录" });
      return;
    }
    const payload = await readJsonBody(req);
    const id = String(payload?.id || "").trim();
    const entry = pendingDeviceAuth.get(id);
    if (!id || !entry) {
      sendJson(res, 404, { error: "设备码会话不存在或已失效" });
      return;
    }
    if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
      pendingDeviceAuth.delete(id);
      sendJson(res, 410, { error: "设备码已过期，请重新扫码" });
      return;
    }

    const result = await pollMicrosoftDeviceCode(entry.device_code);
    if (result.status === "pending") {
      sendJson(res, 200, { status: "pending" });
      return;
    }
    if (result.status === "slow_down") {
      entry.intervalSec = clampInt(Number(entry.intervalSec || 5) + 2, 7, 1, 60);
      sendJson(res, 200, { status: "pending", slowDown: true, interval: entry.intervalSec });
      return;
    }
    if (result.status !== "ok") {
      pendingDeviceAuth.delete(id);
      sendJson(res, 400, { error: result.error || "设备码登录失败" });
      return;
    }

    const claims = await verifyMicrosoftIdToken(result.id_token, { nonce: null });
    if (requireMfa && !hasMfaFromMicrosoftClaims(claims)) {
      pendingDeviceAuth.delete(id);
      sendJson(res, 403, { error: "需要微软 MFA（建议启用 Microsoft Authenticator 动态码/推送）" });
      return;
    }
    if (enforceAllowlist && !isAllowedMicrosoftUser(claims)) {
      pendingDeviceAuth.delete(id);
      sendJson(res, 403, { error: "你没有权限登录该页面（管理员已启用白名单）" });
      return;
    }
    const user = {
      name: String(claims.name || "").trim() || null,
      username: String(claims.preferred_username || claims.upn || claims.email || "").trim() || null,
      oid: String(claims.oid || "").trim() || null,
      tid: String(claims.tid || "").trim() || null,
      sub: String(claims.sub || "").trim() || null
    };

    const sid = randomBase64Url(32);
    sessions.set(sid, { user, expiresAt: Date.now() + sessionTtlMs });
    setCookie(res, sessionCookieName, sid, {
      httpOnly: true,
      sameSite: "Lax",
      secure: isRequestHttps(req),
      path: "/",
      maxAgeSec: Math.floor(sessionTtlMs / 1000)
    });

    pendingDeviceAuth.delete(id);
    sendJson(res, 200, { status: "ok", user, next: entry.next || "/chat.html" });
  } catch (error) {
    sendJson(res, 502, { error: error.message || "设备码轮询失败" });
  }
}

async function startMicrosoftDeviceCode() {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(msTenantId)}/oauth2/v2.0/devicecode`;
  const body = new URLSearchParams();
  body.set("client_id", msClientId);
  body.set("scope", "openid profile email");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const raw = await resp.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    throw new Error("设备码端点返回非 JSON");
  }
  if (!resp.ok) {
    const msg = data.error_description || data.error || `设备码初始化失败（HTTP ${resp.status}）`;
    throw new Error(msg);
  }
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error("设备码返回缺少关键字段");
  }
  return data;
}

async function pollMicrosoftDeviceCode(deviceCode) {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(msTenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
  body.set("client_id", msClientId);
  body.set("device_code", String(deviceCode || ""));
  if (msClientSecret) body.set("client_secret", msClientSecret);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const raw = await resp.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return { status: "error", error: "设备码 token 返回非 JSON" };
  }

  if (resp.ok) {
    if (!data.id_token) return { status: "error", error: "设备码登录成功但缺少 id_token" };
    return { status: "ok", id_token: data.id_token };
  }

  const err = String(data.error || "").trim();
  if (err === "authorization_pending") return { status: "pending" };
  if (err === "slow_down") return { status: "slow_down" };
  if (err === "expired_token") return { status: "error", error: "设备码已过期" };
  if (err === "access_denied") return { status: "error", error: "用户拒绝授权" };
  const msg = data.error_description || data.error || `设备码轮询失败（HTTP ${resp.status}）`;
  return { status: "error", error: msg };
}

async function handleAuthLogout(req, res) {
  const cookies = parseCookies(String(req?.headers?.cookie || ""));
  const sid = String(cookies[sessionCookieName] || "").trim();
  if (sid) sessions.delete(sid);
  clearCookie(res, sessionCookieName, { path: "/" });
  sendRedirect(res, 302, "/login.html?logged_out=1");
}

async function handleFileManagerAuthInfo(req, res) {
  const config = loadFileManagerAuthConfig();
  const user = getFileManagerUserFromRequest(req);
  sendJson(res, 200, {
    ok: true,
    configured: config.users.length > 0,
    user,
    usersCount: config.users.length
  });
}

async function handleFileManagerAuthSetup(req, res) {
  try {
    const config = loadFileManagerAuthConfig();
    if (config.users.length > 0) {
      sendJson(res, 409, { error: "文件管理账号已存在，请直接登录" });
      return;
    }
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const email = normalizeFileManagerEmail(payload.email);
    const password = normalizeFileManagerPassword(payload.password);
    const name = String(payload.name || "").trim().slice(0, 80) || email.split("@")[0] || "文件管理员";
    const passwordRecord = createFileManagerPasswordRecord(password);
    config.users.push({
      id: `files-user-${randomBase64Url(8)}`,
      email,
      name,
      enabled: true,
      passwordSalt: passwordRecord.salt,
      passwordHash: passwordRecord.hash,
      createdAt: new Date().toISOString()
    });
    saveFileManagerAuthConfig(config);
    const user = issueFileManagerSession(req, res, {
      role: "files-admin",
      source: "files-local",
      email,
      name
    });
    sendJson(res, 200, {
      ok: true,
      configured: true,
      user,
      next: normalizeFileManagerNextPath(payload.next)
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "创建文件管理账号失败" });
  }
}

async function handleFileManagerAuthLogin(req, res) {
  try {
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const email = normalizeFileManagerEmail(payload.email);
    const password = normalizeFileManagerPassword(payload.password, { allowShort: false });
    const config = loadFileManagerAuthConfig();
    if (!config.users.length) {
      sendJson(res, 400, { error: "文件管理账号尚未创建，请先完成初始化" });
      return;
    }
    const matched = config.users.find((item) => item.enabled !== false && String(item.email || "").trim().toLowerCase() === email);
    if (!matched) {
      sendJson(res, 401, { error: "邮箱或密码不正确" });
      return;
    }
    if (!verifyFileManagerPassword(password, matched)) {
      sendJson(res, 401, { error: "邮箱或密码不正确" });
      return;
    }
    const user = issueFileManagerSession(req, res, {
      role: "files-admin",
      source: "files-local",
      email: matched.email,
      name: matched.name || matched.email
    });
    sendJson(res, 200, {
      ok: true,
      user,
      next: normalizeFileManagerNextPath(payload.next)
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "文件管理登录失败" });
  }
}

async function handleFileManagerAuthLogout(req, res) {
  const cookies = parseCookies(String(req?.headers?.cookie || ""));
  const sid = String(cookies[fileManagerSessionCookieName] || "").trim();
  if (sid) fileManagerSessions.delete(sid);
  clearCookie(res, fileManagerSessionCookieName, { path: "/" });
  sendJson(res, 200, { ok: true, next: "/files-login.html?logged_out=1" });
}

function getMicrosoftRedirectUri(req) {
  if (msRedirectUriOverride) return msRedirectUriOverride;
  const origin = getRequestOrigin(req);
  return `${origin}/auth/callback`;
}

function getRequestOrigin(req) {
  const xfProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const xfHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const hostHeader = xfHost || String(req?.headers?.host || "localhost:4173");
  const proto = xfProto || (isRequestHttps(req) ? "https" : "http");
  return `${proto}://${hostHeader}`;
}

function isRequestHttps(req) {
  const xfProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (xfProto === "https") return true;
  if (xfProto === "http") return false;
  return false;
}

function normalizeFileManagerNextPath(rawValue) {
  const normalized = normalizeNextPath(String(rawValue || "/files.html"));
  if (normalized === "/chat.html") return "/files.html";
  return normalized;
}

function issueFileManagerSession(req, res, user) {
  const sid = randomBase64Url(32);
  const safeUser = {
    role: String(user?.role || "files-admin").trim() || "files-admin",
    source: String(user?.source || "files-local").trim() || "files-local",
    email: String(user?.email || "").trim() || null,
    name: String(user?.name || "").trim() || null
  };
  fileManagerSessions.set(sid, {
    user: safeUser,
    expiresAt: Date.now() + fileManagerSessionTtlMs
  });
  setCookie(res, fileManagerSessionCookieName, sid, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isRequestHttps(req),
    path: "/",
    maxAgeSec: Math.floor(fileManagerSessionTtlMs / 1000)
  });
  return safeUser;
}

async function exchangeMicrosoftCodeForToken({ code, verifier, redirectUri }) {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(msTenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", msClientId);
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", verifier);
  if (msClientSecret) body.set("client_secret", msClientSecret);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const raw = await resp.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    throw new Error("微软 token 端点返回非 JSON");
  }
  if (!resp.ok) {
    const msg = data.error_description || data.error || `微软 token 获取失败（HTTP ${resp.status}）`;
    throw new Error(msg);
  }
  if (!data.id_token) throw new Error("微软未返回 id_token");
  return data;
}

async function verifyMicrosoftIdToken(idToken, { nonce }) {
  const { header, payload, signingInput, signature } = decodeJwtParts(idToken);
  if (!header || header.alg !== "RS256" || !header.kid) throw new Error("不支持的 JWT 头");
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload !== "object") throw new Error("JWT payload 无效");
  if (nonce && payload.nonce !== nonce) throw new Error("nonce 不匹配");
  if (payload.exp && Number(payload.exp) <= nowSec) throw new Error("JWT 已过期");
  if (payload.nbf && Number(payload.nbf) > nowSec + 60) throw new Error("JWT 尚未生效");

  const issuer = String(payload.iss || "");
  if (isGuidLikeTenant(msTenantId)) {
    const expectedIssuer = `https://login.microsoftonline.com/${msTenantId}/v2.0`;
    if (issuer !== expectedIssuer) throw new Error("iss 不匹配");
    if (payload.tid && String(payload.tid) !== msTenantId) throw new Error("tid 不匹配");
  } else {
    // common/organizations/consumers：iss 通常会落到实际 tid，因此允许匹配固定模式。
    if (!/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/i.test(issuer)) {
      throw new Error("iss 不匹配");
    }
  }

  const aud = payload.aud;
  if (Array.isArray(aud)) {
    if (!aud.includes(msClientId)) throw new Error("aud 不匹配");
  } else if (String(aud || "") !== msClientId) {
    throw new Error("aud 不匹配");
  }

  const jwks = await getMicrosoftJwks();
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((k) => k.kid === header.kid) : null;
  if (!jwk) throw new Error("未找到匹配的 JWKS key");
  const keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" });

  const ok = crypto.verify("RSA-SHA256", Buffer.from(signingInput), keyObject, signature);
  if (!ok) throw new Error("JWT 签名校验失败");
  return payload;
}

function isGuidLikeTenant(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function hasMfaFromMicrosoftClaims(claims) {
  // Entra ID 往往会在 id_token 里带 amr（Authentication Methods References）。
  // 不能保证所有租户/策略都带，但带了的话可以用来粗略判断是否做过 MFA。
  const amr = claims && Array.isArray(claims.amr) ? claims.amr.map((x) => String(x || "").toLowerCase()) : [];
  if (amr.includes("mfa")) return true;
  // 某些情况下会出现 otp 等更细粒度标记（不保证）。
  if (amr.includes("otp")) return true;
  return false;
}

function isAllowedMicrosoftUser(claims) {
  const username = String(claims?.preferred_username || claims?.upn || claims?.email || "").trim().toLowerCase();
  const tid = String(claims?.tid || "").trim();
  const oid = String(claims?.oid || "").trim();

  if (allowedTenants.length && tid && allowedTenants.includes(tid)) return true;
  if (allowedOids.length && oid && allowedOids.includes(oid)) return true;
  if (allowedEmails.length && username && allowedEmails.some((x) => String(x || "").trim().toLowerCase() === username)) {
    return true;
  }
  if (allowedDomains.length && username.includes("@")) {
    const domain = username.split("@").pop();
    if (domain && allowedDomains.some((x) => String(x || "").trim().toLowerCase() === String(domain).toLowerCase())) {
      return true;
    }
  }

  // 若启用了白名单但没有命中，则拒绝
  return false;
}

async function getMicrosoftJwks() {
  const now = Date.now();
  if (msJwksCache && msJwksCache.fetchedAt + 6 * 60 * 60 * 1000 > now) return msJwksCache.jwks;

  const discovery = await getMicrosoftDiscovery();
  const jwksUri = String(discovery.jwks_uri || "").trim();
  if (!jwksUri) throw new Error("发现文档缺少 jwks_uri");
  const resp = await fetch(jwksUri, { method: "GET" });
  const raw = await resp.text();
  let jwks = {};
  try {
    jwks = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    throw new Error("JWKS 返回非 JSON");
  }
  if (!resp.ok) throw new Error(`拉取 JWKS 失败（HTTP ${resp.status}）`);
  msJwksCache = { fetchedAt: now, jwks };
  return jwks;
}

async function getMicrosoftDiscovery() {
  const now = Date.now();
  if (msDiscoveryCache && msDiscoveryCache.fetchedAt + 6 * 60 * 60 * 1000 > now) return msDiscoveryCache.doc;
  const url = `https://login.microsoftonline.com/${encodeURIComponent(msTenantId)}/v2.0/.well-known/openid-configuration`;
  const resp = await fetch(url, { method: "GET" });
  const raw = await resp.text();
  let doc = {};
  try {
    doc = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    throw new Error("发现文档返回非 JSON");
  }
  if (!resp.ok) throw new Error(`拉取发现文档失败（HTTP ${resp.status}）`);
  msDiscoveryCache = { fetchedAt: now, doc };
  return doc;
}

function decodeJwtParts(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("JWT 格式错误");
  const header = safeJsonParse(base64UrlDecodeToString(parts[0]));
  const payload = safeJsonParse(base64UrlDecodeToString(parts[1]));
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = base64UrlDecodeToBuffer(parts[2]);
  return { header, payload, signingInput, signature };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch (_error) {
    return null;
  }
}

function normalizeNextPath(next) {
  const raw = String(next || "").trim();
  if (!raw || raw === "/") return "/chat.html";
  // 只允许站内相对路径，防止 open redirect
  if (!raw.startsWith("/")) return "/chat.html";
  if (raw.startsWith("//")) return "/chat.html";
  return raw;
}

function randomBase64Url(bytes) {
  return base64UrlEncode(crypto.randomBytes(bytes));
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecodeToString(s) {
  return base64UrlDecodeToBuffer(s).toString("utf8");
}

function base64UrlDecodeToBuffer(s) {
  const input = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input + pad, "base64");
}

function parseCookies(headerValue) {
  const out = {};
  String(headerValue || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx <= 0) return;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    });
  return out;
}

function setCookie(res, name, value, options) {
  const opts = options && typeof options === "object" ? options : {};
  const parts = [`${name}=${encodeURIComponent(String(value || ""))}`];
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAgeSec) parts.push(`Max-Age=${Math.floor(opts.maxAgeSec)}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name, options) {
  const pathValue = options && options.path ? String(options.path) : "/";
  res.setHeader("Set-Cookie", `${name}=; Path=${pathValue}; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function sendRedirect(res, statusCode, location) {
  res.writeHead(statusCode, { Location: String(location || "/") });
  res.end();
}

// ===== Guest demo =====

async function handleGuestInfo(_req, res) {
  sendJson(res, 200, {
    enabled: guestEnabled,
    inviteTtlMs: guestInviteTtlMs,
    rpm: guestRateLimitPerMin,
    verifyRpm: guestVerifyRpm
  });
}

function getGuestSessionFromRequest(req) {
  const cookies = parseCookies(String(req?.headers?.cookie || ""));
  const sid = String(cookies[guestCookieName] || "").trim();
  if (!sid) return null;
  const entry = guestSessions.get(sid);
  if (!entry) return null;
  if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
    guestSessions.delete(sid);
    return null;
  }
  return { sid, ...entry };
}

function allowGuestRequest(entry) {
  const now = Date.now();
  const rate = entry.rate && typeof entry.rate === "object" ? entry.rate : { windowAt: 0, count: 0 };
  const windowAt = Number(rate.windowAt || 0);
  const isNewWindow = !windowAt || now - windowAt >= 60 * 1000;
  const next = isNewWindow ? { windowAt: now, count: 1 } : { windowAt, count: Number(rate.count || 0) + 1 };
  if (next.count > guestRateLimitPerMin) return { ok: false, next };
  return { ok: true, next };
}

async function handleGuestVerify(req, res) {
  try {
    if (!guestEnabled) {
      sendJson(res, 404, { error: "访客体验未开启" });
      return;
    }

    const ip = getClientIp(req);
    if (!allowRateByIp(guestVerifyRateByIp, ip, guestVerifyRpm)) {
      sendJson(res, 429, { error: `请求过于频繁：每分钟最多 ${guestVerifyRpm} 次` });
      return;
    }

    const payload = await readJsonBody(req);
    const token = String(payload?.invite || "").trim();
    const invite = guestInvites.get(token);
    if (!token || !invite || !invite.expiresAt || invite.expiresAt <= Date.now()) {
      sendJson(res, 401, { error: "体验链接无效或已过期" });
      return;
    }
    // one-time use
    guestInvites.delete(token);

    const sid = randomBase64Url(28);
    const expiresAt = Date.now() + guestInviteTtlMs;
    guestSessions.set(sid, {
      createdAt: Date.now(),
      expiresAt,
      rate: { windowAt: Date.now(), count: 0 }
    });
    setCookie(res, guestCookieName, sid, {
      httpOnly: true,
      sameSite: "Lax",
      secure: isRequestHttps(req),
      path: "/",
      maxAgeSec: Math.floor(guestInviteTtlMs / 1000)
    });
    sendJson(res, 200, { ok: true, expiresAt });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "验证失败" });
  }
}

async function handleGuestLogout(req, res) {
  const session = getGuestSessionFromRequest(req);
  if (session?.sid) guestSessions.delete(session.sid);
  clearCookie(res, guestCookieName, { path: "/" });
  sendJson(res, 200, { ok: true });
}

async function handleGuestInvite(req, res) {
  try {
    if (!guestEnabled) {
      sendJson(res, 400, { error: "访客体验未开启（请设置 OPENCLAW_GUEST_ENABLED=1）" });
      return;
    }
    const admin = getAdminUserFromRequest(req);
    if (!admin) {
      sendJson(res, 401, { error: "未授权：只有管理员可生成体验链接" });
      return;
    }
    // create one-time invite token
    const token = randomBase64Url(24);
    const expiresAt = Date.now() + guestInviteTtlMs;
    guestInvites.set(token, { expiresAt });
    const origin = guestPublicOrigin || getRequestOrigin(req);
    const url = `${origin.replace(/\/+$/, "")}/guest.html?invite=${encodeURIComponent(token)}`;
    sendJson(res, 200, { ok: true, url, expiresAt, admin: { email: admin.email || null } });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "生成体验链接失败" });
  }
}

function normalizeGuestProvider(provider) {
  const value = String(provider || "").trim();
  const allowed = new Set(["openai", "anthropic", "gemini", "deepseek", "openrouter", "azure_openai", "custom"]);
  return allowed.has(value) ? value : "custom";
}

function isGuestBaseUrlAllowed(urlText) {
  const value = String(urlText || "").trim();
  if (!value) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return false;
    const host = String(u.hostname || "").trim().toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    if (host.endsWith(".local")) return false;
    if (guestAllowedBaseUrls.length) {
      return guestAllowedBaseUrls.some((item) => String(item || "").trim() === value);
    }
    // default allow-list: common public OpenAI-compatible providers
    if (value.startsWith("https://api.openai.com/")) return true;
    if (value.startsWith("https://www.right.codes/")) return true;
    if (value.startsWith("https://right.codes/")) return true;
    if (value.startsWith("https://api.deepseek.com/")) return true;
    if (value.startsWith("https://openrouter.ai/")) return true;
    if (value.startsWith("https://generativelanguage.googleapis.com/")) return true;
    if (value.startsWith("https://api.anthropic.com/")) return true;
    // Azure OpenAI is per-tenant domain; allow *.openai.azure.com
    if (host.endsWith(".openai.azure.com")) return true;
    return false;
  } catch (_error) {
    return false;
  }
}

async function handleGuestChat(req, res) {
  try {
    if (!guestEnabled) {
      sendJson(res, 404, { error: "访客体验未开启" });
      return;
    }
    const session = getGuestSessionFromRequest(req);
    if (!session) {
      sendJson(res, 401, { error: "未授权：请使用体验链接进入" });
      return;
    }
    const allowed = allowGuestRequest(session);
    guestSessions.set(session.sid, {
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      rate: allowed.next
    });
    if (!allowed.ok) {
      sendJson(res, 429, { error: `请求过于频繁：每分钟最多 ${guestRateLimitPerMin} 次` });
      return;
    }

    const payload = await readJsonBody(req);
    const provider = normalizeGuestProvider(payload.provider);
    const model = String(payload.model || "").trim();
    const baseUrl = String(payload.baseUrl || "").trim();
    const apiKey = String(payload.apiKey || "").trim();
    const systemPrompt = String(payload.systemPrompt || "").trim();
    const temperature = clampNumber(payload.temperature, 0.7, 0, 2);
    const maxTokens = clampInt(payload.maxTokens, 512, 1, 4096);
    const topP = clampNumber(payload.topP, 1, 0, 1);
    const messages = normalizeChatMessages(payload.messages);

    if (!model) {
      sendJson(res, 400, { error: "缺少模型 ID（model）" });
      return;
    }
    if (!baseUrl) {
      sendJson(res, 400, { error: "缺少接口地址（baseUrl）" });
      return;
    }
    if (!isGuestBaseUrlAllowed(baseUrl)) {
      sendJson(res, 400, { error: "访客模式不允许该 baseUrl（仅允许常见公网模型接口，防止 SSRF）" });
      return;
    }
    if (!apiKey && provider !== "ollama") {
      sendJson(res, 400, { error: "缺少 API 密钥（apiKey）" });
      return;
    }
    if (!messages.length) {
      sendJson(res, 400, { error: "消息列表为空（messages）" });
      return;
    }

    const text = await chatWithProvider({
      provider,
      model,
      baseUrl,
      apiKey,
      messages,
      systemPrompt,
      temperature,
      maxTokens,
      topP
    });
    sendJson(res, 200, { message: text });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 502;
    sendJson(res, statusCode, { error: error.message || "访客对话失败" });
  }
}

async function handleTelegramWebhookProxy(req, res) {
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const state = normalizeTelegramWebhookHealthState(telegramWebhookHealthState);
  state.counters.received = clampInt((state.counters.received || 0) + 1, 1, 0, 1_000_000_000);
  state.lastReceivedAt = nowIso;

  try {
    const rawBody = await readRawBody(req, { maxBytes: 2 * 1024 * 1024 });
    const contentType = String(req.headers["content-type"] || "application/json").trim() || "application/json";
    const secretToken = String(req.headers["x-telegram-bot-api-secret-token"] || "").trim();
    const response = await fetch(telegramWebhookLocalUrl, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(secretToken ? { "X-Telegram-Bot-Api-Secret-Token": secretToken } : {})
      },
      body: rawBody,
      signal: AbortSignal.timeout(telegramWebhookProxyTimeoutMs)
    });

    const text = await response.text();
    const durationMs = Math.max(0, Date.now() - startedAt);
    if (response.ok) {
      state.counters.forwarded = clampInt((state.counters.forwarded || 0) + 1, 1, 0, 1_000_000_000);
      state.lastForwardedAt = nowIso;
      state.lastError = "";
      pushTelegramWebhookHealthEvent(state, {
        time: nowIso,
        type: "forwarded",
        statusCode: response.status || 200,
        durationMs,
        detail: ""
      });
    } else {
      const maybeSecretMismatch = response.status === 403;
      if (maybeSecretMismatch) {
        state.counters.secretMismatch = clampInt((state.counters.secretMismatch || 0) + 1, 1, 0, 1_000_000_000);
        state.lastSecretMismatchAt = nowIso;
      } else {
        state.counters.failed = clampInt((state.counters.failed || 0) + 1, 1, 0, 1_000_000_000);
        state.lastFailedAt = nowIso;
      }
      const compact = String(text || "").trim().slice(0, 240);
      state.lastError = compact || `HTTP ${response.status || 502}`;
      pushTelegramWebhookHealthEvent(state, {
        time: nowIso,
        type: maybeSecretMismatch ? "secret_mismatch" : "forward_failed",
        statusCode: response.status || 502,
        durationMs,
        detail: compact
      });
    }
    saveTelegramWebhookHealthState(state);

    const payload = text || '{"ok":true}';
    res.writeHead(response.status || 200, {
      "Content-Type": String(response.headers.get("content-type") || "application/json; charset=utf-8"),
      "Cache-Control": "no-store"
    });
    res.end(payload);
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const detail = formatErrorMessage(error);
    state.counters.failed = clampInt((state.counters.failed || 0) + 1, 1, 0, 1_000_000_000);
    state.lastFailedAt = nowIso;
    state.lastError = detail.slice(0, 240);
    pushTelegramWebhookHealthEvent(state, {
      time: nowIso,
      type: "proxy_error",
      statusCode: 502,
      durationMs,
      detail: detail.slice(0, 240)
    });
    saveTelegramWebhookHealthState(state);
    sendJson(res, 502, { error: `Telegram webhook 转发失败：${formatErrorMessage(error)}` });
  }
}

function getAdminUserFromRequest(req) {
  const authUser = getAuthUserFromRequest(req);
  if (authUser && isEmailAllowedForAdmin(authUser.username || "")) {
    return { source: "microsoft", email: authUser.username || "" };
  }

  if (trustCloudflareAccessHeaders) {
    const email = String(req?.headers?.["cf-access-authenticated-user-email"] || "").trim();
    // Require the Access JWT header as a minimal anti-spoof guard.
    const jwt = String(req?.headers?.["cf-access-jwt-assertion"] || "").trim();
    if (email && jwt && isEmailAllowedForAdmin(email)) {
      return { source: "cloudflare-access", email };
    }
  }

  if (allowLocalAdmin && isLoopbackAddress(String(req?.socket?.remoteAddress || "")) && isDirectLocalRequest(req)) {
    // Only treat true direct localhost access as admin.
    // When behind a reverse proxy (e.g. cloudflared), remoteAddress is still loopback, so we must not trust it.
    return { source: "loopback", email: "" };
  }

  return null;
}

function getFileManagerUserFromRequest(req) {
  return getFileManagerLocalUserFromRequest(req);
}

function getFileManagerLocalUserFromRequest(req) {
  const cookies = parseCookies(String(req?.headers?.cookie || ""));
  const sid = String(cookies[fileManagerSessionCookieName] || "").trim();
  if (!sid) return null;
  const entry = fileManagerSessions.get(sid);
  if (!entry) return null;
  if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
    fileManagerSessions.delete(sid);
    return null;
  }
  return entry.user || null;
}

function ensureFileManagerAuth(req, res, options = {}) {
  const user = getFileManagerUserFromRequest(req);
  if (user) return user;

  const isApi = options.api !== false;
  if (isApi) {
    sendJson(res, 401, {
      error: "未授权：请先登录后再访问文件管理",
      login: buildFileManagerLoginUrl(req)
    });
    return null;
  }

  sendRedirect(res, 302, buildFileManagerLoginUrl(req));
  return null;
}

function isDirectLocalRequest(req) {
  const host = String(req?.headers?.host || "").trim().toLowerCase();
  const hasForwarded =
    !!String(req?.headers?.["cf-connecting-ip"] || "").trim() ||
    !!String(req?.headers?.["x-forwarded-for"] || "").trim() ||
    !!String(req?.headers?.forwarded || "").trim();
  if (hasForwarded) return false;
  return (
    host.startsWith("127.0.0.1") ||
    host.startsWith("localhost") ||
    host.startsWith("[::1]") ||
    host === "::1"
  );
}

function isEmailAllowedForAdmin(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!adminEmails.length) return true; // if not configured, any authenticated admin source is ok
  return adminEmails.some((x) => String(x || "").trim().toLowerCase() === e);
}

function isLoopbackAddress(addr) {
  const a = String(addr || "").trim();
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function getClientIp(req) {
  const cf = String(req?.headers?.["cf-connecting-ip"] || "").trim();
  if (cf) return cf;
  const xf = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  if (xf) return xf;
  return String(req?.socket?.remoteAddress || "").trim() || "unknown";
}

function parseCloudflareRayColo(rayValue) {
  const raw = String(rayValue || "").trim();
  if (!raw) return "";
  const parts = raw.split("-");
  if (parts.length < 2) return "";
  return String(parts[parts.length - 1] || "").trim().toUpperCase();
}

function classifyNetworkPath(info = {}) {
  const colo = String(info.colo || "").trim().toUpperCase();
  const loc = String(info.loc || "").trim().toUpperCase();
  const mainlandColos = new Set(["PEK", "PKX", "SHA", "PVG", "CAN", "SZX", "HGH", "CTU", "CKG", "WUH", "XMN", "TSN", "TAO"]);
  const nearChinaColos = new Set(["HKG", "TPE", "KHH", "MFM", "NRT", "KIX", "ICN", "SIN"]);

  if (mainlandColos.has(colo)) {
    return {
      code: "cn_mainland",
      label: "国内落地",
      detail: "当前命中的边缘节点位于中国大陆。"
    };
  }
  if (loc === "CN" && nearChinaColos.has(colo)) {
    return {
      code: "cn_nearby_overseas",
      label: "中国网络，经近境外节点",
      detail: "访问源在中国，但当前命中的是香港/台湾/日本/韩国/新加坡等近境外节点。"
    };
  }
  if (loc === "CN" && colo) {
    return {
      code: "cn_global_overseas",
      label: "中国网络，经远端海外节点",
      detail: "访问源在中国，但当前命中的是更远的海外节点，通常属于国际链路。"
    };
  }
  if (colo) {
    return {
      code: "overseas",
      label: "海外网络",
      detail: "当前出口或命中边缘节点位于海外。"
    };
  }
  return {
    code: "unknown",
    label: "无法判断",
    detail: "当前没有拿到足够的 Cloudflare 节点信息。"
  };
}

function allowRateByIp(map, ip, limitPerMin) {
  const key = String(ip || "unknown");
  const now = Date.now();
  const existing = map.get(key) || { windowAt: 0, count: 0 };
  const windowAt = Number(existing.windowAt || 0);
  const isNew = !windowAt || now - windowAt >= 60 * 1000;
  const next = isNew ? { windowAt: now, count: 1 } : { windowAt, count: Number(existing.count || 0) + 1 };
  map.set(key, next);
  return next.count <= limitPerMin;
}

function parseUrl(urlValue) {
  const raw = String(urlValue || "/");
  const u = new URL(raw, "http://localhost");
  const query = {};
  u.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  return { pathname: u.pathname, query };
}

function isFileManagerHostRequest(req) {
  return getRequestHostName(req) === "file.qxyx.net";
}

function isClawHostRequest(req) {
  return getRequestHostName(req) === "claw.qxyx.net";
}

function isGuestHostRequest(req) {
  return getRequestHostName(req) === "guest.qxyx.net";
}

function getRequestHostName(req) {
  const xfHost = String(req?.headers?.["x-forwarded-host"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const hostHeader = xfHost || String(req?.headers?.host || "");
  return hostHeader
    .trim()
    .toLowerCase()
    .split(":")[0];
}

function deriveFilePublicOrigin(req) {
  const explicit = normalizeOptionalOrigin(fileManagerPublicOrigin);
  if (explicit) return explicit;
  const current = normalizeOptionalOrigin(getRequestOrigin(req));
  const sibling = deriveSiblingOrigin(current, "claw.", "file.");
  return sibling || "";
}

function isFileHostBypassPath(req, cleanPath) {
  if (!isFileManagerHostRequest(req)) return false;
  const p = String(cleanPath || "/");
  return (
    p === "/vpn-convert.html" ||
    p === "/vpn-convert.css" ||
    p === "/vpn-convert-page.js" ||
    p === "/vpn-subscriptions.html" ||
    p === "/vpn-subscriptions.css" ||
    p === "/vpn-subscriptions.js" ||
    p === "/api/vpn-convert/history" ||
    p === "/api/vpn-subscriptions" ||
    p === "/api/vpn-convert" ||
    p === "/api/vpn-subscriptions/save" ||
    p === "/api/vpn-subscriptions/delete" ||
    p === "/api/vpn-convert/history/delete" ||
    p === "/api/vpn-convert/history/clear" ||
    p === "/api/vpn-convert/export-link" ||
    p.startsWith("/api/vpn-convert/export/")
  );
}

function parseBooleanEnv(value, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return !!fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return !!fallback;
}

function loadEnvFileIntoProcess(filePath) {
  try {
    if (!filePath) return;
    if (!fs.existsSync(filePath)) return;
    const parsed = parseEnvText(fs.readFileSync(filePath, "utf8"));
    Object.entries(parsed).forEach(([k, v]) => {
      if (!k) return;
      if (process.env[k] == null || process.env[k] === "") {
        process.env[k] = String(v ?? "");
      }
    });
  } catch (_error) {
    // ignore
  }
}

async function handleTerminalInfo(res) {
  const projectsConfig = loadProjectsConfig();
  sendJson(res, 200, {
    tokenRequired: !!terminalToken,
    allowedRoots: [],
    defaultCwd: String(projectsConfig.defaultRoot || projectsConfigDefaults.defaultRoot),
    allowedCommands: ["*（已开放：按 shell 直接执行）"],
    limits: {
      outputChars: terminalOutputLimit,
      timeoutMs: terminalTimeoutMs
    }
  });
}

async function handleTerminalRun(req, res) {
  try {
    if (terminalToken) {
      const provided = String(req.headers["x-terminal-token"] || "").trim();
      if (!provided || provided !== terminalToken) {
        sendJson(res, 401, { error: "未授权：缺少或错误的终端 Token（X-Terminal-Token）" });
        return;
      }
    }

    const payload = await readJsonBody(req);
    const projectsConfig = loadProjectsConfig();
    const cwd = resolveTerminalCwdUnrestricted(payload.cwd, projectsConfig.defaultRoot);
    const commandLine = String(payload.command || "").trim();
    if (!commandLine) {
      sendJson(res, 400, { error: "缺少 command" });
      return;
    }

    const cmd = "/bin/bash";
    const args = ["-lc", commandLine];

    const startedAt = Date.now();
    const result = spawnSync(cmd, args, {
      cwd,
      env: buildTerminalEnv(),
      encoding: "utf8",
      timeout: terminalTimeoutMs,
      maxBuffer: terminalOutputLimit + 1024
    });

    const durationMs = Math.max(0, Date.now() - startedAt);
    const stdoutRaw = String(result.stdout || "");
    const stderrRaw = String(result.stderr || "");
    const stdout = truncateText(stdoutRaw, terminalOutputLimit);
    const stderr = truncateText(stderrRaw, terminalOutputLimit);

    sendJson(res, 200, {
      ok: result.status === 0,
      cwd,
      cmd: "bash",
      args: ["-lc", commandLine],
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal || null,
      timedOut: !!result.error && String(result.error.code || "") === "ETIMEDOUT",
      durationMs,
      stdout,
      stderr,
      truncated: stdout.length !== stdoutRaw.length || stderr.length !== stderrRaw.length
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "终端执行失败" });
  }
}

async function handleGetSshConfig(res) {
  try {
    const config = loadSshHostsConfig();
    sendJson(res, 200, {
      config,
      path: sshHostsConfigPath,
      sshAvailable: hasCommand("ssh"),
      scpAvailable: hasCommand("scp"),
      tokenRequired: !!terminalToken
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取 SSH 配置失败" });
  }
}

async function handleGetSshPublicKey(req, res) {
  try {
    ensureTerminalToken(req);
    const { query } = parseUrl(req.url || "/api/ssh/public-key");
    const preferredPath = String(query.path || "").trim();
    const loaded = loadLocalPublicKey(preferredPath);
    sendJson(res, 200, {
      ok: true,
      path: loaded.path,
      publicKey: loaded.publicKey
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "读取本机公钥失败" });
  }
}

async function handleSshPrivateToPublic(req, res) {
  try {
    ensureTerminalToken(req);
    if (!hasCommand("ssh-keygen")) {
      sendJson(res, 400, { error: "本机未安装 ssh-keygen，无法从私钥自动生成公钥" });
      return;
    }
    const payload = await readJsonBody(req, { maxBytes: 256 * 1024 });
    const privateKeyText = sanitizeSshPrivateKeyText(String(payload?.privateKeyText || ""));
    const publicKey = deriveSshPublicKeyFromPrivateKeyText(privateKeyText);
    sendJson(res, 200, {
      ok: true,
      publicKey
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "从私钥生成公钥失败" });
  }
}

async function handleSaveSshConfig(req, res) {
  try {
    const payload = await readJsonBody(req);
    const source = payload && typeof payload === "object" && payload.config ? payload.config : payload;
    const config = normalizeSshHostsConfig(source);
    applyManagedPrivateKeysToSshConfig(config, payload?.privateKeys);
    saveSshHostsConfig(config);
    const savedConfig = loadSshHostsConfig();
    sendJson(res, 200, {
      ok: true,
      config: savedConfig,
      path: sshHostsConfigPath,
      sshAvailable: hasCommand("ssh"),
      scpAvailable: hasCommand("scp"),
      tokenRequired: !!terminalToken
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "保存 SSH 配置失败" });
  }
}

async function handleSshTest(req, res) {
  try {
    if (terminalToken) {
      const provided = String(req.headers["x-terminal-token"] || "").trim();
      if (!provided || provided !== terminalToken) {
        sendJson(res, 401, { error: "未授权：缺少或错误的终端 Token（X-Terminal-Token）" });
        return;
      }
    }
    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 512 * 1024 });
    const host = normalizeSshHost(payload.host, new Set());
    if (!host) {
      sendJson(res, 400, { error: "主机配置无效" });
      return;
    }
    if (payload.sessionPassword != null && String(payload.sessionPassword || "") !== "") {
      host.runtimePassword = String(payload.sessionPassword || "");
    }

    let tempKeyPath = "";
    if (String(payload.privateKeyText || "").trim()) {
      tempKeyPath = writeTempSshPrivateKey(String(payload.privateKeyText || ""));
      host.identityFile = tempKeyPath;
      if (host.authMode === "password") host.authMode = "auto";
    }

    try {
      const timeoutMs = clampInt(payload.timeoutMs, sshDefaultCommandTimeoutMs, 1000, 10 * 60 * 1000);
      const connectTimeoutSec = clampInt(payload.connectTimeoutSec, sshDefaultConnectTimeoutSec, 1, 60);
      const result = await runSingleSshCommand(host, "printf 'openclaw-ssh-ok\\n'", { timeoutMs, connectTimeoutSec });
      sendJson(res, 200, {
        ok: !!result.ok,
        result
      });
    } finally {
      cleanupFileSafe(tempKeyPath);
    }
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "SSH 连通性测试失败" });
  }
}

async function handleSshRun(req, res) {
  try {
    if (terminalToken) {
      const provided = String(req.headers["x-terminal-token"] || "").trim();
      if (!provided || provided !== terminalToken) {
        sendJson(res, 401, { error: "未授权：缺少或错误的终端 Token（X-Terminal-Token）" });
        return;
      }
    }

    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }

    const payload = await readJsonBody(req);
    const command = String(payload.command || "").trim();
    if (!command) {
      sendJson(res, 400, { error: "缺少 command" });
      return;
    }

    const config = loadSshHostsConfig();
    const hostIds = Array.isArray(payload.hostIds) ? payload.hostIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const selected = selectSshHostsByIds(config, hostIds, payload.sessionPasswords);
    if (!selected.length) {
      sendJson(res, 400, { error: "未选择任何 SSH 主机" });
      return;
    }

    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );
    const concurrency = clampInt(payload.concurrency, 4, 1, 12);
    const startedAt = Date.now();
    const results = await runSshCommandBatch(selected, command, { timeoutMs, connectTimeoutSec, concurrency });
    const durationMs = Math.max(0, Date.now() - startedAt);
    const okCount = results.filter((item) => item.ok).length;

    sendJson(res, 200, {
      ok: okCount === results.length,
      command,
      durationMs,
      okCount,
      failCount: results.length - okCount,
      results
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "SSH 执行失败" });
  }
}

async function handleSshDistributeKey(req, res) {
  try {
    ensureTerminalToken(req);
    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 256 * 1024 });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, payload.hostIds, payload.sessionPasswords);
    if (!selected.length) {
      sendJson(res, 400, { error: "未选择任何 SSH 主机" });
      return;
    }

    const loadedKey = loadLocalPublicKey(String(payload.localPath || "").trim(), String(payload.publicKey || "").trim());
    const publicKey = String(loadedKey.publicKey || "").trim();
    if (!publicKey) {
      sendJson(res, 400, { error: "公钥内容为空" });
      return;
    }
    if (!/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/=]+(?:\s+.+)?$/.test(publicKey)) {
      sendJson(res, 400, { error: "公钥格式看起来不正确，请确认是 .pub 内容" });
      return;
    }

    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );
    const concurrency = clampInt(payload.concurrency, 4, 1, 12);
    const startedAt = Date.now();
    const script = buildAuthorizedKeyInstallScript(publicKey);
    const results = await runSshScriptBatch(selected, script, {
      timeoutMs,
      connectTimeoutSec,
      concurrency,
      meta: {
        action: "distribute_key",
        sourcePath: loadedKey.path || "",
        keyType: publicKey.split(/\s+/)[0] || ""
      }
    });
    const successfulHosts = selected.filter((host) => {
      const matched = results.find((item) => item.id === host.id);
      return matched && matched.ok;
    });
    let verificationResults = [];
    if (successfulHosts.length) {
      verificationResults = await runSshCommandBatch(successfulHosts, "printf '__OPENCLAW_AUTH_OK__\\n'", {
        timeoutMs,
        connectTimeoutSec,
        concurrency
      });
    }
    const verificationMap = new Map(verificationResults.map((item) => [item.id, item]));
    results.forEach((item) => {
      if (!item.ok || item.skipped) {
        item.authVerified = false;
        return;
      }
      const verification = verificationMap.get(item.id);
      const authVerified = !!verification && verification.ok && String(verification.stdout || "").includes("__OPENCLAW_AUTH_OK__");
      item.authVerified = authVerified;
      if (!authVerified) {
        item.ok = false;
        item.stderr = [String(item.stderr || "").trim(), "免密登录验证失败"].filter(Boolean).join("\n");
      } else {
        item.stdout = [String(item.stdout || "").trim(), "免密登录验证成功"].filter(Boolean).join("\n");
      }
    });
    const okCount = results.filter((item) => item.ok).length;
    sendJson(res, 200, {
      ok: okCount === results.length,
      okCount,
      failCount: results.length - okCount,
      durationMs: Math.max(0, Date.now() - startedAt),
      sourcePath: loadedKey.path || "",
      keyType: publicKey.split(/\s+/)[0] || "",
      verifyAuth: true,
      results
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "批量分发公钥失败" });
  }
}

async function handleSshCheckPublicKey(req, res) {
  try {
    ensureTerminalToken(req);
    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 256 * 1024 });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, [payload.hostId], payload.sessionPasswords);
    const host = selected[0];
    if (!host) {
      sendJson(res, 400, { error: "未选择有效的 SSH 主机" });
      return;
    }

    const loadedKey = loadLocalPublicKey("", String(payload.publicKey || "").trim());
    const publicKey = String(loadedKey.publicKey || "").trim();
    if (!publicKey) {
      sendJson(res, 400, { error: "公钥内容为空" });
      return;
    }
    const publicKeyMeta = parseSshPublicKeyMeta(publicKey);
    if (!/^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/=]+(?:\s+.+)?$/.test(publicKey)) {
      sendJson(res, 400, { error: "公钥格式看起来不正确，请确认是 ssh-ed25519 / ssh-rsa 这类一整行内容" });
      return;
    }

    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );

    const result = await runSingleSshScript(host, buildAuthorizedKeyCheckScript(publicKey), {
      timeoutMs,
      connectTimeoutSec,
      meta: {
        action: "check_public_key",
        keyType: publicKeyMeta.keyType,
        keyComment: publicKeyMeta.keyComment
      }
    });
    if (!result.ok) {
      sendJson(res, 400, { error: result.stderr || "公钥检测失败", result });
      return;
    }
    const rawStdout = String(result.stdout || "");
    const exists = rawStdout.includes("__OPENCLAW_KEY_EXISTS__");
    const authFilePathMatch = rawStdout.match(/__OPENCLAW_AUTH_FILE__(.*)/);
    const lineCountMatch = rawStdout.match(/__OPENCLAW_AUTH_LINES__(\d+)/);
    const authFilePath = String(authFilePathMatch?.[1] || "").trim() || "~/.ssh/authorized_keys";
    const authorizedKeysLineCount = Number.parseInt(String(lineCountMatch?.[1] || "0"), 10);
    result.stdout = truncateText(
      rawStdout
        .replace(/__OPENCLAW_AUTH_FILE__.*\n?/g, "")
        .replace(/__OPENCLAW_AUTH_LINES__\d+\n?/g, "")
        .replace(/__OPENCLAW_KEY_(EXISTS|MISSING)__\n?/g, "")
        .trim(),
      sshOutputLimit
    );
    sendJson(res, 200, {
      ok: true,
      exists,
      keyType: publicKeyMeta.keyType,
      keyComment: publicKeyMeta.keyComment,
      authFilePath,
      authorizedKeysLineCount: Number.isFinite(authorizedKeysLineCount) ? authorizedKeysLineCount : 0,
      result: {
        ...result,
        ok: exists,
        keyType: publicKeyMeta.keyType,
        keyComment: publicKeyMeta.keyComment,
        authFilePath,
        authorizedKeysLineCount: Number.isFinite(authorizedKeysLineCount) ? authorizedKeysLineCount : 0,
        stdout: result.stdout || (exists ? "当前主机已存在这条公钥" : "当前主机还没有这条公钥"),
        stderr: exists ? "" : "未找到这条公钥"
      }
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "公钥检测失败" });
  }
}

async function handleSshFileList(req, res) {
  try {
    ensureTerminalToken(req);
    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 128 * 1024 });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, [payload.hostId], payload.sessionPasswords);
    const host = selected[0];
    if (!host) {
      sendJson(res, 400, { error: "未选择有效的 SSH 主机" });
      return;
    }

    const browsePath = String(payload.path || "~").trim() || "~";
    const showHidden = payload.showHidden !== false;
    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );

    const script = buildRemoteFileListScript(browsePath, showHidden);
    const result = await runSingleSshScript(host, script, {
      timeoutMs,
      connectTimeoutSec,
      meta: {
        action: "list_files",
        browsePath
      }
    });
    if (!result.ok) {
      sendJson(res, 400, { error: result.stderr || "远程目录读取失败", result });
      return;
    }

    const parsed = parseRemoteFileListOutput(result.stdout);
    sendJson(res, 200, {
      ok: true,
      host: {
        id: host.id,
        name: host.name,
        user: host.user,
        host: host.host,
        port: host.port
      },
      cwd: parsed.cwd,
      parent: parsed.parent,
      entries: parsed.entries
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "远程目录读取失败" });
  }
}

async function handleSshFileAction(req, res) {
  try {
    ensureTerminalToken(req);
    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 128 * 1024 });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, [payload.hostId], payload.sessionPasswords);
    const host = selected[0];
    if (!host) {
      sendJson(res, 400, { error: "未选择有效的 SSH 主机" });
      return;
    }

    const action = String(payload.action || "").trim();
    const targetPath = sanitizeRemotePathInput(payload.path);
    const nextPath = payload.newPath == null || String(payload.newPath).trim() === ""
      ? ""
      : sanitizeRemotePathInput(payload.newPath);
    const collisionStrategy = normalizeRemoteCollisionStrategy(payload.collisionStrategy);
    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );

    const script = buildRemoteFileActionScript(action, {
      path: targetPath,
      newPath: nextPath,
      collisionStrategy
    });
    const result = await runSingleSshScript(host, script, {
      timeoutMs,
      connectTimeoutSec,
      meta: {
        action: `file_${action}`,
        remotePath: targetPath,
        newRemotePath: nextPath || "",
        collisionStrategy
      }
    });
    if (!result.ok) {
      sendJson(res, 400, { error: result.stderr || "远程文件操作失败", result });
      return;
    }

    const parsed = parseRemoteFileActionOutput(result.stdout);
    result.remotePath = parsed.path || targetPath;
    result.newRemotePath = parsed.newPath || nextPath || "";
    sendJson(res, 200, {
      ok: true,
      action,
      path: parsed.path || targetPath,
      newPath: parsed.newPath || nextPath || "",
      result
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "远程文件操作失败" });
  }
}

async function handleSshReadTextFile(req, res) {
  try {
    ensureTerminalToken(req);
    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 128 * 1024 });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, [payload.hostId], payload.sessionPasswords);
    const host = selected[0];
    if (!host) {
      sendJson(res, 400, { error: "未选择有效的 SSH 主机" });
      return;
    }

    const remotePath = sanitizeRemotePathInput(payload.path);
    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );

    const result = await runSingleSshScript(host, buildRemoteReadTextScript(remotePath, sshRemoteTextMaxBytes), {
      timeoutMs,
      connectTimeoutSec,
      meta: {
        action: "read_text",
        remotePath
      }
    });
    if (!result.ok) {
      sendJson(res, 400, { error: result.stderr || "远程文本读取失败", result });
      return;
    }

    const parsed = parseRemoteReadTextOutput(result.stdout);
    const buffer = Buffer.from(parsed.contentBase64 || "", "base64");
    if (buffer.length > sshRemoteTextMaxBytes) {
      sendJson(res, 400, { error: `文件过大，在线预览上限 ${sshRemoteTextMaxBytes} 字节` });
      return;
    }
    if (!looksLikeUtf8TextBuffer(buffer)) {
      sendJson(res, 400, { error: "该文件不是 UTF-8 文本，暂不支持在线预览" });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      path: parsed.path || remotePath,
      size: parsed.size,
      mtimeSec: parsed.mtimeSec,
      content: buffer.toString("utf8")
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "远程文本读取失败" });
  }
}

async function handleSshWriteTextFile(req, res) {
  try {
    ensureTerminalToken(req);
    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: Math.ceil(sshRemoteTextMaxBytes * 2.2) });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, [payload.hostId], payload.sessionPasswords);
    const host = selected[0];
    if (!host) {
      sendJson(res, 400, { error: "未选择有效的 SSH 主机" });
      return;
    }

    const remotePath = sanitizeRemotePathInput(payload.path);
    const content = String(payload.content || "");
    const buffer = Buffer.from(content, "utf8");
    if (buffer.length > sshRemoteTextMaxBytes) {
      sendJson(res, 400, { error: `文本内容过大，在线编辑上限 ${sshRemoteTextMaxBytes} 字节` });
      return;
    }

    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );
    const result = await runSingleSshScript(host, buildRemoteWriteTextScript(remotePath, buffer.toString("base64")), {
      timeoutMs,
      connectTimeoutSec,
      meta: {
        action: "write_text",
        remotePath
      }
    });
    if (!result.ok) {
      sendJson(res, 400, { error: result.stderr || "远程文本保存失败", result });
      return;
    }

    const parsed = parseRemoteFileActionOutput(result.stdout);
    sendJson(res, 200, {
      ok: true,
      path: parsed.path || remotePath,
      size: buffer.length,
      result
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "远程文本保存失败" });
  }
}

async function handleSshUpload(req, res) {
  let tempDir = "";
  try {
    ensureTerminalToken(req);
    if (!hasCommand("scp")) {
      sendJson(res, 400, { error: "本机未安装 scp 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: Math.ceil(sshTransferMaxBytes * 1.5) });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, payload.hostIds, payload.sessionPasswords);
    if (!selected.length) {
      sendJson(res, 400, { error: "未选择任何 SSH 主机" });
      return;
    }

    const remotePath = String(payload.remotePath || "").trim();
    if (!remotePath) {
      sendJson(res, 400, { error: "缺少远程目标路径（remotePath）" });
      return;
    }

    const fileName = sanitizeUploadFileName(String(payload.fileName || payload.name || "upload.bin").trim() || "upload.bin");
    const contentBase64 = String(payload.contentBase64 || "").trim();
    if (!contentBase64) {
      sendJson(res, 400, { error: "缺少上传文件内容（contentBase64）" });
      return;
    }

    let buffer;
    try {
      buffer = Buffer.from(contentBase64, "base64");
    } catch (_error) {
      sendJson(res, 400, { error: "文件内容不是有效 base64" });
      return;
    }
    if (!buffer.length) {
      sendJson(res, 400, { error: "上传文件内容为空" });
      return;
    }
    if (buffer.length > sshTransferMaxBytes) {
      sendJson(res, 400, { error: `上传文件过大，当前上限 ${sshTransferMaxBytes} 字节` });
      return;
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-ssh-upload-"));
    const localFilePath = path.join(tempDir, fileName);
    fs.writeFileSync(localFilePath, buffer);

    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );
    const concurrency = clampInt(payload.concurrency, 3, 1, 8);
    const startedAt = Date.now();
    const results = await runScpUploadBatch(selected, localFilePath, remotePath, fileName, {
      timeoutMs,
      connectTimeoutSec,
      concurrency
    });
    const okCount = results.filter((item) => item.ok).length;
    sendJson(res, 200, {
      ok: okCount === results.length,
      okCount,
      failCount: results.length - okCount,
      durationMs: Math.max(0, Date.now() - startedAt),
      fileName,
      remotePath,
      results
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "SFTP 上传失败" });
  } finally {
    cleanupTempDirSafe(tempDir);
  }
}

async function handleSshDownload(req, res) {
  let tempDir = "";
  try {
    ensureTerminalToken(req);
    if (!hasCommand("scp")) {
      sendJson(res, 400, { error: "本机未安装 scp 命令" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 128 * 1024 });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, [payload.hostId], payload.sessionPasswords);
    const host = selected[0];
    if (!host) {
      sendJson(res, 400, { error: "未选择有效的 SSH 主机" });
      return;
    }

    const remotePath = String(payload.remotePath || "").trim();
    if (!remotePath) {
      sendJson(res, 400, { error: "缺少远程文件路径（remotePath）" });
      return;
    }

    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-ssh-download-"));
    const preferredName = sanitizeUploadFileName(path.basename(remotePath) || `${host.name || host.host}-download.bin`);
    const localFilePath = path.join(tempDir, preferredName || "download.bin");
    const result = await runSingleScpDownload(host, remotePath, localFilePath, {
      timeoutMs,
      connectTimeoutSec
    });
    if (!result.ok) {
      sendJson(res, 400, { error: result.stderr || "SFTP 下载失败", result });
      return;
    }

    const stat = fs.statSync(localFilePath);
    if (stat.size > sshDownloadMaxBytes) {
      sendJson(res, 400, { error: `下载文件过大，当前上限 ${sshDownloadMaxBytes} 字节`, result });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(preferredName)}`,
      "X-OpenClaw-SSH-Host": encodeURIComponent(String(host.name || host.host || "")),
      "X-OpenClaw-SSH-Remote-Path": encodeURIComponent(remotePath),
      "Cache-Control": "no-store"
    });
    const stream = fs.createReadStream(localFilePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "读取下载文件失败" });
      } else {
        res.end();
      }
    });
    stream.on("close", () => {
      cleanupTempDirSafe(tempDir);
    });
    stream.pipe(res);
    tempDir = "";
  } catch (error) {
    cleanupTempDirSafe(tempDir);
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "SFTP 下载失败" });
  }
}

async function handleSshDownloadArchive(req, res) {
  let tempDir = "";
  let zipPath = "";
  try {
    ensureTerminalToken(req);
    if (!hasCommand("scp") || !hasCommand("zip")) {
      sendJson(res, 400, { error: "本机缺少 scp 或 zip 命令，无法批量打包下载" });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 256 * 1024 });
    const config = loadSshHostsConfig();
    const selected = selectSshHostsByIds(config, [payload.hostId], payload.sessionPasswords);
    const host = selected[0];
    if (!host) {
      sendJson(res, 400, { error: "未选择有效的 SSH 主机" });
      return;
    }

    const remotePaths = Array.isArray(payload.remotePaths)
      ? Array.from(new Set(payload.remotePaths.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 200)
      : [];
    if (!remotePaths.length) {
      sendJson(res, 400, { error: "请至少选择一个远程文件或目录" });
      return;
    }

    const timeoutMs = clampInt(
      payload.timeoutMs,
      config.defaults.commandTimeoutMs || sshDefaultCommandTimeoutMs,
      1000,
      10 * 60 * 1000
    );
    const connectTimeoutSec = clampInt(
      payload.connectTimeoutSec,
      config.defaults.connectTimeoutSec || sshDefaultConnectTimeoutSec,
      1,
      60
    );

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-ssh-archive-"));
    const archiveRoot = path.join(tempDir, "bundle");
    fs.mkdirSync(archiveRoot, { recursive: true });
    for (const remotePath of remotePaths) {
      const result = await runSingleScpDownload(host, remotePath, archiveRoot, {
        timeoutMs,
        connectTimeoutSec,
        recursive: true
      });
      if (!result.ok) {
        sendJson(res, 400, { error: result.stderr || `拉取失败：${remotePath}`, result });
        return;
      }
    }

    const archiveName = sanitizeArchiveName(String(payload.name || `${host.name || host.host}-batch`).trim() || `${host.name || host.host}-batch`);
    zipPath = path.join(tempDir, `${archiveName}.zip`);
    const zipResult = spawnSync("zip", ["-q", "-r", zipPath, "."], {
      cwd: archiveRoot,
      encoding: "utf8"
    });
    if (zipResult.status !== 0 || !fs.existsSync(zipPath)) {
      const detail = String(zipResult.stderr || zipResult.stdout || "").trim();
      sendJson(res, 500, { error: detail || "zip 打包失败" });
      return;
    }

    const stat = fs.statSync(zipPath);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${archiveName}.zip`)}`,
      "Cache-Control": "no-store"
    });
    const stream = fs.createReadStream(zipPath);
    stream.on("error", () => {
      if (!res.headersSent) sendJson(res, 500, { error: "读取 zip 文件失败" });
      else res.end();
    });
    stream.on("close", () => {
      cleanupTempDirSafe(tempDir);
    });
    stream.pipe(res);
    tempDir = "";
  } catch (error) {
    cleanupTempDirSafe(tempDir);
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "批量 zip 下载失败" });
  }
}

async function handleSshInteractiveStart(req, res) {
  try {
    ensureTerminalToken(req);
    if (!hasCommand("ssh")) {
      sendJson(res, 400, { error: "本机未安装 ssh 命令" });
      return;
    }
    cleanupSshInteractiveSessions({ force: false });
    if (sshInteractiveSessions.size >= sshInteractiveMaxSessions) {
      sendJson(res, 429, { error: `交互会话过多，请先关闭旧会话（上限 ${sshInteractiveMaxSessions}）` });
      return;
    }

    const payload = await readJsonBody(req, { maxBytes: 128 * 1024 });
    const hostId = String(payload?.hostId || "").trim();
    if (!hostId) {
      sendJson(res, 400, { error: "缺少 hostId" });
      return;
    }
    const connectTimeoutSec = clampInt(payload?.connectTimeoutSec, sshDefaultConnectTimeoutSec, 1, 60);
    const sessionPassword = String(payload?.sessionPassword || "");
    const config = loadSshHostsConfig();
    const host = (Array.isArray(config.hosts) ? config.hosts : []).find((item) => item.id === hostId && item.enabled !== false);
    if (!host) {
      sendJson(res, 404, { error: "主机不存在或已禁用" });
      return;
    }

    const interactiveHost = sessionPassword
      ? { ...host, runtimePassword: sessionPassword, password: sessionPassword }
      : host;
    const spawnOptions = buildSshInteractiveSpawnOptions(interactiveHost, { connectTimeoutSec });
    const child = spawn(spawnOptions.command, spawnOptions.args, {
      env: spawnOptions.env || process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const sessionId = `sshi-${randomBase64Url(12)}`;
    const session = {
      id: sessionId,
      hostId: host.id,
      hostName: host.name || host.host,
      hostTarget: `${host.user}@${host.host}:${host.port}`,
      process: child,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      closed: false,
      closedEmitted: false,
      exitCode: null,
      signal: null,
      closeReason: "",
      closeDetail: "",
      cleanup: typeof spawnOptions.cleanup === "function" ? spawnOptions.cleanup : null,
      nextSeq: 1,
      chunks: [],
      clients: new Set()
    };
    sshInteractiveSessions.set(sessionId, session);

    const appendChunk = (value) => {
      const text = typeof value === "string" ? value : String(value || "");
      if (!text) return;
      pushSshInteractiveChunk(session, text);
    };

    child.stdout.on("data", (chunk) => {
      session.lastActiveAt = Date.now();
      appendChunk(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || ""));
    });
    child.stderr.on("data", (chunk) => {
      session.lastActiveAt = Date.now();
      appendChunk(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || ""));
    });
    child.on("error", (error) => {
      session.lastActiveAt = Date.now();
      appendChunk(`\r\n[error] ${error.message || "SSH 进程启动失败"}\r\n`);
      finalizeSshInteractiveSession(session, {
        exitCode: null,
        signal: null,
        reason: "process_error",
        detail: String(error?.message || "")
      });
    });
    child.on("close", (code, signal) => {
      session.lastActiveAt = Date.now();
      const reason = Number.isInteger(code)
        ? `\r\n[session closed] exit=${code}${signal ? ` signal=${signal}` : ""}\r\n`
        : `\r\n[session closed]${signal ? ` signal=${signal}` : ""}\r\n`;
      appendChunk(reason);
      finalizeSshInteractiveSession(session, {
        exitCode: Number.isInteger(code) ? code : null,
        signal: signal || null,
        reason: "process_exit",
        detail: Number.isInteger(code) ? `exit=${code}${signal ? ` signal=${signal}` : ""}` : (signal ? `signal=${signal}` : "")
      });
    });

    sendJson(res, 200, {
      ok: true,
      sessionId,
      host: {
        id: host.id,
        name: host.name,
        user: host.user,
        host: host.host,
        port: host.port
      },
      connectTimeoutSec
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "创建交互终端失败" });
  }
}

async function handleSshInteractiveInput(req, res) {
  try {
    ensureTerminalToken(req);
    const payload = await readJsonBody(req, { maxBytes: 256 * 1024 });
    const sessionId = String(payload?.sessionId || "").trim();
    if (!sessionId) {
      sendJson(res, 400, { error: "缺少 sessionId" });
      return;
    }
    const session = sshInteractiveSessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: "会话不存在或已结束" });
      return;
    }
    if (session.closed || !session.process || session.process.killed) {
      sendJson(res, 410, { error: "会话已关闭" });
      return;
    }
    const data = typeof payload?.data === "string" ? payload.data : String(payload?.data || "");
    if (!data) {
      sendJson(res, 200, { ok: true, wrote: 0 });
      return;
    }
    if (data.length > 64 * 1024) {
      sendJson(res, 413, { error: "输入过长，请分批发送" });
      return;
    }
    session.lastActiveAt = Date.now();
    session.process.stdin.write(data);
    sendJson(res, 200, { ok: true, wrote: data.length });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "写入交互终端失败" });
  }
}

async function handleSshInteractiveStop(req, res) {
  try {
    ensureTerminalToken(req);
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const sessionId = String(payload?.sessionId || "").trim();
    if (!sessionId) {
      sendJson(res, 400, { error: "缺少 sessionId" });
      return;
    }
    const session = sshInteractiveSessions.get(sessionId);
    if (!session) {
      sendJson(res, 200, { ok: true, closed: false });
      return;
    }
    closeSshInteractiveSession(session, { reason: "manual_stop", kill: true });
    sendJson(res, 200, { ok: true, closed: true });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "关闭交互终端失败" });
  }
}

async function handleSshInteractiveStream(req, res) {
  try {
    const { query } = parseUrl(req.url || "/api/ssh/interactive/stream");
    if (terminalToken) {
      const tokenInQuery = String(query.token || "").trim();
      if (!tokenInQuery || tokenInQuery !== terminalToken) {
        sendJson(res, 401, { error: "未授权：缺少或错误的终端 Token" });
        return;
      }
    }
    const sessionId = String(query.sessionId || "").trim();
    if (!sessionId) {
      sendJson(res, 400, { error: "缺少 sessionId" });
      return;
    }
    const session = sshInteractiveSessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: "会话不存在或已结束" });
      return;
    }
    const since = clampInt(query.since, 0, 0, Number.MAX_SAFE_INTEGER);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 1000\n\n");

    session.lastActiveAt = Date.now();
    session.chunks.forEach((item) => {
      if (Number(item.seq || 0) <= since) return;
      writeSseEvent(res, "chunk", item);
    });

    if (session.closed) {
      writeSseEvent(res, "close", {
        sessionId: session.id,
        exitCode: session.exitCode,
        signal: session.signal,
        reason: String(session.closeReason || ""),
        detail: String(session.closeDetail || "")
      });
      res.end();
      return;
    }

    const client = {
      res,
      heartbeat: setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch (_error) {
          // ignore
        }
      }, 15000)
    };
    if (typeof client.heartbeat?.unref === "function") client.heartbeat.unref();
    session.clients.add(client);

    const release = () => {
      if (!session.clients.has(client)) return;
      session.clients.delete(client);
      try {
        if (client.heartbeat) clearInterval(client.heartbeat);
      } catch (_error) {
        // ignore
      }
    };
    req.on("close", release);
    req.on("aborted", release);
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "连接交互终端流失败" });
  }
}

function buildSshInteractiveSpawnOptions(host, options = {}) {
  const connectTimeoutSec = clampInt(options?.connectTimeoutSec, sshDefaultConnectTimeoutSec, 1, 60);
  const mode = normalizeSshAuthMode(host?.authMode, host?.runtimePassword || host?.password, host?.identityFile);
  const identityFile = String(host?.identityFile || "").trim();
  const password = String(host?.runtimePassword || host?.password || "");
  const sshArgs = [
    "-tt",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `ConnectTimeout=${connectTimeoutSec}`,
    "-o", "ServerAliveInterval=20",
    "-o", "ServerAliveCountMax=3",
    "-o", "TCPKeepAlive=yes",
    "-p", String(clampInt(host?.port, 22, 1, 65535))
  ];
  let env = { ...process.env };
  let cleanup = () => {};

  if (identityFile) {
    const resolvedKey = expandHomeDir(identityFile);
    if (!fs.existsSync(resolvedKey)) {
      throw createHttpError(400, `私钥文件不存在：${resolvedKey}`);
    }
    sshArgs.push("-i", resolvedKey);
  }
  if (mode === "key") {
    if (!identityFile) throw createHttpError(400, "该主机为仅私钥模式，但未配置私钥文件");
    sshArgs.push("-o", "BatchMode=yes", "-o", "PreferredAuthentications=publickey", "-o", "NumberOfPasswordPrompts=0");
  } else if (mode === "password") {
    sshArgs.push(
      "-o", "BatchMode=no",
      "-o", "PreferredAuthentications=password,keyboard-interactive",
      "-o", "PubkeyAuthentication=no",
      "-o", "NumberOfPasswordPrompts=3"
    );
    if (password) {
      const askpass = createSshAskpassEnv(password);
      env = askpass.env;
      cleanup = askpass.cleanup;
    }
  } else {
    sshArgs.push(
      "-o", "BatchMode=no",
      "-o", "PreferredAuthentications=publickey,password,keyboard-interactive",
      "-o", "NumberOfPasswordPrompts=3"
    );
    if (password) {
      const askpass = createSshAskpassEnv(password);
      env = askpass.env;
      cleanup = askpass.cleanup;
    }
  }
  sshArgs.push(buildSshTarget(host));

  env = {
    ...env,
    TERM: env.TERM || process.env.TERM || "xterm-256color",
    COLORTERM: env.COLORTERM || process.env.COLORTERM || "truecolor"
  };

  // Use util-linux `script` to allocate a PTY so password prompts / Ctrl+C / arrow keys behave like a real terminal.
  if (commandExists("script")) {
    const commandLine = ["ssh", ...sshArgs].map((arg) => quoteShellArg(arg)).join(" ");
    return {
      command: "script",
      args: ["-q", "-f", "-c", commandLine, "/dev/null"],
      env,
      cleanup
    };
  }

  return {
    command: "ssh",
    args: sshArgs,
    env,
    cleanup
  };
}

function quoteShellArg(value) {
  return `'${escapeShellSingleQuoted(String(value || ""))}'`;
}

function writeSseEvent(res, eventName, payload) {
  const event = String(eventName || "message").trim() || "message";
  const data = JSON.stringify(payload == null ? {} : payload);
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function pushSshInteractiveChunk(session, data) {
  if (!session || session.closed) return;
  const text = String(data || "");
  if (!text) return;
  const item = {
    seq: Number(session.nextSeq || 1),
    data: text
  };
  session.nextSeq = item.seq + 1;
  session.chunks.push(item);
  if (session.chunks.length > sshInteractiveMaxChunks) {
    session.chunks.splice(0, session.chunks.length - sshInteractiveMaxChunks);
  }
  for (const client of Array.from(session.clients)) {
    try {
      writeSseEvent(client.res, "chunk", item);
    } catch (_error) {
      try {
        if (client.heartbeat) clearInterval(client.heartbeat);
      } catch (_ignored) {
        // ignore
      }
      session.clients.delete(client);
    }
  }
}

function finalizeSshInteractiveSession(session, result = {}) {
  if (!session || session.closedEmitted) return;
  session.closedEmitted = true;
  session.closed = true;
  session.exitCode = result.exitCode ?? null;
  session.signal = result.signal ?? null;
  session.closeReason = String(result.reason || session.closeReason || "").trim();
  session.closeDetail = String(result.detail || session.closeDetail || "").trim();
  session.lastActiveAt = Date.now();
  if (typeof session.cleanup === "function") {
    try {
      session.cleanup();
    } catch (_error) {
      // ignore cleanup failure
    }
    session.cleanup = null;
  }
  for (const client of Array.from(session.clients)) {
    try {
      writeSseEvent(client.res, "close", {
        sessionId: session.id,
        exitCode: session.exitCode,
        signal: session.signal,
        reason: session.closeReason,
        detail: session.closeDetail
      });
    } catch (_error) {
      // ignore
    }
    try {
      if (client.heartbeat) clearInterval(client.heartbeat);
    } catch (_ignored) {
      // ignore
    }
    try {
      client.res.end();
    } catch (_ignored) {
      // ignore
    }
    session.clients.delete(client);
  }
}

function closeSshInteractiveSession(session, options = {}) {
  if (!session) return;
  if (options.kill !== false && session.process && !session.process.killed) {
    try {
      session.process.kill("SIGHUP");
    } catch (_error) {
      // ignore
    }
  }
  if (!session.closed) {
    const reason = String(options.reason || "").trim();
    if (reason) {
      pushSshInteractiveChunk(session, `\r\n[session stop] ${reason}\r\n`);
    }
    finalizeSshInteractiveSession(session, {
      exitCode: session.exitCode,
      signal: session.signal,
      reason: reason || "session_stop",
      detail: String(options.detail || "")
    });
  }
  if (options.remove !== false) {
    sshInteractiveSessions.delete(session.id);
  }
}

function cleanupSshInteractiveSessions(options = {}) {
  const force = !!options.force;
  const now = Date.now();
  for (const session of Array.from(sshInteractiveSessions.values())) {
    const idleMs = Math.max(0, now - Number(session.lastActiveAt || session.createdAt || now));
    const shouldClose = force || (session.closed ? idleMs > 2 * 60 * 1000 : idleMs > sshInteractiveSessionTtlMs);
    if (!shouldClose) continue;
    closeSshInteractiveSession(session, { reason: force ? "cleanup_force" : "idle_timeout", kill: true, remove: true });
  }
}

function ensureTerminalToken(req) {
  if (!terminalToken) return;
  const provided = String(req.headers["x-terminal-token"] || "").trim();
  if (!provided || provided !== terminalToken) {
    const error = new Error("未授权：缺少或错误的终端 Token（X-Terminal-Token）");
    error.statusCode = 401;
    throw error;
  }
}

function selectSshHostsByIds(config, hostIds, runtimePasswordInput) {
  const ids = Array.isArray(hostIds) ? hostIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!ids.length) return [];
  const runtimePasswords = normalizeRuntimePasswordMap(runtimePasswordInput);
  return (Array.isArray(config?.hosts) ? config.hosts : [])
    .filter((item) => ids.includes(item.id))
    .map((item) => ({
      ...item,
      runtimePassword: runtimePasswords[item.id] || ""
    }));
}

function normalizeRuntimePasswordMap(input) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  Object.entries(source).forEach(([key, value]) => {
    const id = String(key || "").trim();
    const password = String(value || "");
    if (!id || !password) return;
    out[id] = password;
  });
  return out;
}

function loadSshHostsConfig() {
  const state = normalizeSshHostsConfig(loadJsonFileSafe(sshHostsConfigPath));
  if (state.updatedAt) return state;
  return {
    ...state,
    updatedAt: ""
  };
}

function saveSshHostsConfig(input) {
  const state = normalizeSshHostsConfig(input);
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(sshHostsConfigPath), { recursive: true });
  fs.writeFileSync(sshHostsConfigPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function normalizeSshHostsConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = source.defaults && typeof source.defaults === "object" ? source.defaults : {};
  const seen = new Set();
  const rawHosts = Array.isArray(source.hosts)
    ? source.hosts
    : Array.isArray(source.items)
      ? source.items
      : [];
  const hosts = rawHosts
    .map((item) => normalizeSshHost(item, seen))
    .filter((item) => !!item);

  return {
    version: 1,
    updatedAt: String(source.updatedAt || "").trim(),
    defaults: {
      connectTimeoutSec: clampInt(defaults.connectTimeoutSec, sshDefaultConnectTimeoutSec, 1, 60),
      commandTimeoutMs: clampInt(defaults.commandTimeoutMs, sshDefaultCommandTimeoutMs, 1000, 10 * 60 * 1000)
    },
    hosts
  };
}

function normalizeSshHost(input, seen) {
  if (!input || typeof input !== "object") return null;
  const host = String(input.host || input.hostname || input.address || "").trim();
  if (!host) return null;

  const name = String(input.name || input.label || "").trim() || host;
  const user = String(input.user || input.username || "").trim() || "root";
  const port = clampInt(input.port, 22, 1, 65535);
  const authMode = normalizeSshAuthMode(input.authMode, input.password, input.identityFile || input.keyFile || input.privateKeyPath);
  let id = String(input.id || "").trim() || buildSshHostId({ name, host, user, port });
  while (seen.has(id)) {
    id = buildSshHostId({ name, host, user, port, seed: randomBase64Url(4) });
  }
  seen.add(id);

  const identityFile = String(input.identityFile || input.keyFile || input.privateKeyPath || "").trim();
  return {
    id,
    name,
    host,
    port,
    user,
    authMode,
    identityFile: identityFile ? expandHomeDir(identityFile) : "",
    password: String(input.password || "").trim(),
    tags: normalizeSshTagList(input.tags),
    notes: String(input.notes || input.remark || "").trim(),
    enabled: input.enabled !== false
  };
}

function applyManagedPrivateKeysToSshConfig(config, input) {
  const privateKeys = normalizeSshPrivateKeyMap(input);
  if (!privateKeys.size) return config;
  config.hosts.forEach((host) => {
    const privateKeyText = privateKeys.get(host.id);
    if (!privateKeyText) return;
    const identityFile = writeManagedSshPrivateKey(host, privateKeyText);
    host.identityFile = identityFile;
    if (host.authMode === "password") host.authMode = "auto";
  });
  return config;
}

function normalizeSshPrivateKeyMap(input) {
  const source = input && typeof input === "object" ? input : {};
  const out = new Map();
  Object.entries(source).forEach(([hostId, value]) => {
    const id = String(hostId || "").trim();
    const privateKeyText = String(value || "").trim();
    if (!id || !privateKeyText) return;
    out.set(id, sanitizeSshPrivateKeyText(privateKeyText));
  });
  return out;
}

function sanitizeSshPrivateKeyText(input) {
  const value = String(input || "").replace(/\r\n/g, "\n").trim();
  if (!value) {
    throw createHttpError(400, "私钥内容不能为空");
  }
  if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value) || !/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(value)) {
    throw createHttpError(400, "私钥内容格式不正确，需要完整的 PRIVATE KEY 块");
  }
  if (value.length > 128 * 1024) {
    throw createHttpError(400, "私钥内容过长");
  }
  return `${value}\n`;
}

function writeManagedSshPrivateKey(host, privateKeyText) {
  const hostId = String(host?.id || "").trim() || `host-${Date.now()}`;
  const fileNameBase = sanitizeFolderSegment(host?.name || host?.host || hostId) || "host";
  const hash = crypto.createHash("sha256").update(privateKeyText).digest("hex").slice(0, 12);
  fs.mkdirSync(sshManagedKeyDir, { recursive: true, mode: 0o700 });
  const fileName = `${hostId}-${fileNameBase}-${hash}.key`;
  const filePath = path.join(sshManagedKeyDir, fileName);
  fs.writeFileSync(filePath, privateKeyText, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_error) {
    // ignore chmod failure on unsupported fs
  }
  cleanupOldManagedSshKeys(hostId, filePath);
  return filePath;
}

function cleanupOldManagedSshKeys(hostId, keepFilePath) {
  try {
    if (!fs.existsSync(sshManagedKeyDir)) return;
    const prefix = `${String(hostId || "").trim()}-`;
    fs.readdirSync(sshManagedKeyDir).forEach((name) => {
      if (!name.startsWith(prefix)) return;
      const currentPath = path.join(sshManagedKeyDir, name);
      if (currentPath === keepFilePath) return;
      cleanupFileSafe(currentPath);
    });
  } catch (_error) {
    // ignore cleanup failure
  }
}

function writeTempSshPrivateKey(privateKeyText) {
  const safeText = sanitizeSshPrivateKeyText(privateKeyText);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-ssh-key-"));
  const filePath = path.join(tempDir, "id.key");
  fs.writeFileSync(filePath, safeText, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_error) {
    // ignore chmod failure on unsupported fs
  }
  return filePath;
}

function cleanupFileSafe(filePath) {
  const target = String(filePath || "").trim();
  if (!target) return;
  const parentDir = path.dirname(target);
  try {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      fs.rmSync(target, { force: true });
    }
  } catch (_error) {
    // ignore cleanup failure
  }
  if (path.basename(parentDir).startsWith("openclaw-ssh-key-")) {
    cleanupTempDirSafe(parentDir);
  }
}

function normalizeSshAuthMode(rawMode, password, identityFile) {
  const value = String(rawMode || "").trim().toLowerCase();
  if (value === "key" || value === "password" || value === "auto") return value;
  if (String(password || "").trim() && String(identityFile || "").trim()) return "auto";
  if (String(password || "").trim()) return "password";
  return "key";
}

function buildSshHostId(input) {
  const source = input && typeof input === "object" ? input : {};
  const slug = String(source.name || source.host || "host")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "host";
  const hash = crypto
    .createHash("sha1")
    .update(
      [
        String(source.user || "").trim(),
        String(source.host || "").trim(),
        String(source.port || "").trim(),
        String(source.seed || "").trim()
      ].join("|")
    )
    .digest("hex")
    .slice(0, 8);
  return `ssh-${slug}-${hash}`;
}

function normalizeSshTagList(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(/[\n,]/g);
  const tags = [];
  const seen = new Set();
  raw.forEach((item) => {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    tags.push(value);
  });
  return tags;
}

function resolveSshAuthProfile(host) {
  const identityFile = String(host?.identityFile || "").trim();
  const password = String(host?.runtimePassword || host?.password || "");
  const mode = normalizeSshAuthMode(host?.authMode, password, identityFile);
  const hasKey = !!identityFile;
  if (mode === "password" && !password) {
    return { error: "该主机已设置为密码登录，但没有提供密码" };
  }
  if (mode === "auto" && !hasKey && !password) {
    return { error: "该主机未提供私钥，也没有提供密码" };
  }
  if (mode === "key" && !hasKey) {
    return { error: "该主机未配置私钥文件，无法按仅私钥模式登录" };
  }
  return {
    mode,
    identityFile,
    password
  };
}

function createSshAskpassEnv(password) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-askpass-"));
  const scriptPath = path.join(tempDir, "askpass.sh");
  const escaped = escapeShellSingleQuoted(String(password || ""));
  fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' '${escaped}'\n`, { encoding: "utf8", mode: 0o700 });
  return {
    env: {
      ...process.env,
      SSH_ASKPASS: scriptPath,
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: process.env.DISPLAY || "openclaw:0"
    },
    cleanup: () => cleanupTempDirSafe(tempDir)
  };
}

function buildSshConnectionOptions(host, options = {}, protocol = "ssh") {
  const connectTimeoutSec = clampInt(options.connectTimeoutSec, sshDefaultConnectTimeoutSec, 1, 60);
  const auth = resolveSshAuthProfile(host);
  if (auth.error) {
    return { error: auth.error };
  }

  const portFlag = protocol === "scp" ? "-P" : "-p";
  const args = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `ConnectTimeout=${connectTimeoutSec}`,
    portFlag,
    String(clampInt(host?.port, 22, 1, 65535))
  ];
  let env = process.env;
  let cleanup = () => {};

  if (auth.mode === "key") {
    args.push("-o", "BatchMode=yes", "-o", "NumberOfPasswordPrompts=0");
    if (auth.identityFile) args.push("-i", expandHomeDir(auth.identityFile));
  } else if (auth.mode === "password") {
    args.push(
      "-o", "BatchMode=no",
      "-o", "NumberOfPasswordPrompts=1",
      "-o", "PreferredAuthentications=password,keyboard-interactive",
      "-o", "PubkeyAuthentication=no"
    );
    const askpass = createSshAskpassEnv(auth.password);
    env = askpass.env;
    cleanup = askpass.cleanup;
  } else {
    args.push(
      "-o", "BatchMode=no",
      "-o", "NumberOfPasswordPrompts=1",
      "-o", "PreferredAuthentications=publickey,password,keyboard-interactive"
    );
    if (auth.identityFile) args.push("-i", expandHomeDir(auth.identityFile));
    if (auth.password) {
      const askpass = createSshAskpassEnv(auth.password);
      env = askpass.env;
      cleanup = askpass.cleanup;
    }
  }

  return { args, env, cleanup, authMode: auth.mode };
}

async function runSshCommandBatch(hosts, command, options = {}) {
  const list = Array.isArray(hosts) ? hosts : [];
  const concurrency = clampInt(options.concurrency, 4, 1, 12);
  const results = new Array(list.length);
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const currentIndex = cursor;
      cursor += 1;
      const host = list[currentIndex];
      try {
        results[currentIndex] = await runSingleSshCommand(host, command, options);
      } catch (error) {
        results[currentIndex] = {
          id: host?.id || "",
          name: host?.name || host?.host || "未命名主机",
          host: host?.host || "",
          ok: false,
          exitCode: null,
          signal: null,
          durationMs: 0,
          timedOut: false,
          stdout: "",
          stderr: error.message || "SSH 执行失败"
        };
      }
    }
  }

  const workerCount = Math.min(concurrency, list.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function runSingleSshCommand(host, command, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    if (!host || typeof host !== "object") {
      resolve({
        id: "",
        name: "未命名主机",
        host: "",
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        stdout: "",
        stderr: "主机配置无效"
      });
      return;
    }

    if (host.enabled === false) {
      resolve({
        id: host.id || "",
        name: host.name || host.host || "未命名主机",
        host: host.host || "",
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        skipped: true,
        stdout: "",
        stderr: "该主机已禁用，已跳过"
      });
      return;
    }

    const timeoutMs = clampInt(options.timeoutMs, sshDefaultCommandTimeoutMs, 1000, 10 * 60 * 1000);
    const connection = buildSshConnectionOptions(host, options, "ssh");
    if (connection.error) {
      resolve({
        id: host.id || "",
        name: host.name || host.host || "未命名主机",
        host: host.host || "",
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut: false,
        stdout: "",
        stderr: connection.error
      });
      return;
    }
    const args = [...connection.args];
    args.push(buildSshTarget(host), "sh", "-s", "--");

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forceKillTimer = null;
    const child = spawn("ssh", args, {
      env: connection.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      connection.cleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // ignore
      }
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_error) {
          // ignore
        }
      }, 1000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > sshOutputLimit * 2) {
        stdout = stdout.slice(0, sshOutputLimit * 2);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > sshOutputLimit * 2) {
        stderr = stderr.slice(0, sshOutputLimit * 2);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        id: host.id || "",
        name: host.name || host.host || "未命名主机",
        host: host.host || "",
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut,
        stdout: truncateText(stdout, sshOutputLimit),
        stderr: truncateText(error.message || stderr || "SSH 启动失败", sshOutputLimit)
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finish({
        id: host.id || "",
        name: host.name || host.host || "未命名主机",
        host: host.host || "",
        ok: !timedOut && code === 0,
        exitCode: Number.isInteger(code) ? code : null,
        signal: signal || null,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut,
        stdout: truncateText(stdout, sshOutputLimit),
        stderr: truncateText(stderr, sshOutputLimit)
      });
    });

    child.stdin.end(`${String(command || "")}\n`);
  });
}

function buildSshTarget(host) {
  const user = String(host?.user || "").trim();
  const targetHost = String(host?.host || "").trim();
  return user ? `${user}@${targetHost}` : targetHost;
}

async function runSshScriptBatch(hosts, script, options = {}) {
  const list = Array.isArray(hosts) ? hosts : [];
  const concurrency = clampInt(options.concurrency, 4, 1, 12);
  const results = new Array(list.length);
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const currentIndex = cursor;
      cursor += 1;
      const host = list[currentIndex];
      try {
        results[currentIndex] = await runSingleSshScript(host, script, options);
      } catch (error) {
        results[currentIndex] = {
          id: host?.id || "",
          name: host?.name || host?.host || "未命名主机",
          host: host?.host || "",
          ok: false,
          exitCode: null,
          signal: null,
          durationMs: 0,
          timedOut: false,
          stdout: "",
          stderr: error.message || "SSH 脚本执行失败",
          ...(options.meta && typeof options.meta === "object" ? options.meta : {})
        };
      }
    }
  }

  const workerCount = Math.min(concurrency, list.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function runSingleSshScript(host, script, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const meta = options.meta && typeof options.meta === "object" ? options.meta : {};
    if (!host || typeof host !== "object") {
      resolve({
        id: "",
        name: "未命名主机",
        host: "",
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        stdout: "",
        stderr: "主机配置无效",
        ...meta
      });
      return;
    }
    if (host.enabled === false) {
      resolve({
        id: host.id || "",
        name: host.name || host.host || "未命名主机",
        host: host.host || "",
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        skipped: true,
        stdout: "",
        stderr: "该主机已禁用，已跳过",
        ...meta
      });
      return;
    }

    const timeoutMs = clampInt(options.timeoutMs, sshDefaultCommandTimeoutMs, 1000, 10 * 60 * 1000);
    const connection = buildSshConnectionOptions(host, options, "ssh");
    if (connection.error) {
      resolve({
        id: host.id || "",
        name: host.name || host.host || "未命名主机",
        host: host.host || "",
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut: false,
        stdout: "",
        stderr: connection.error,
        ...meta
      });
      return;
    }
    const args = [...connection.args];
    args.push(buildSshTarget(host), "sh", "-s", "--");

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forceKillTimer = null;
    const child = spawn("ssh", args, {
      env: connection.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      connection.cleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // ignore
      }
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_error) {
          // ignore
        }
      }, 1000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > sshOutputLimit * 2) stdout = stdout.slice(0, sshOutputLimit * 2);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > sshOutputLimit * 2) stderr = stderr.slice(0, sshOutputLimit * 2);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        id: host.id || "",
        name: host.name || host.host || "未命名主机",
        host: host.host || "",
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut,
        stdout: truncateText(stdout, sshOutputLimit),
        stderr: truncateText(error.message || stderr || "SSH 启动失败", sshOutputLimit),
        ...meta
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finish({
        id: host.id || "",
        name: host.name || host.host || "未命名主机",
        host: host.host || "",
        ok: !timedOut && code === 0,
        exitCode: Number.isInteger(code) ? code : null,
        signal: signal || null,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut,
        stdout: truncateText(stdout, sshOutputLimit),
        stderr: truncateText(stderr, sshOutputLimit),
        ...meta
      });
    });

    child.stdin.end(String(script || ""));
  });
}

async function runScpUploadBatch(hosts, localFilePath, remotePath, fileName, options = {}) {
  const list = Array.isArray(hosts) ? hosts : [];
  const concurrency = clampInt(options.concurrency, 3, 1, 8);
  const results = new Array(list.length);
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await runSingleScpUpload(list[currentIndex], localFilePath, remotePath, fileName, options);
    }
  }

  const workerCount = Math.min(concurrency, list.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function runSingleScpUpload(host, localFilePath, remotePath, fileName, options = {}) {
  if (!host || typeof host !== "object") {
    return Promise.resolve(buildScpResult(null, {
      ok: false,
      startedAt: Date.now(),
      timedOut: false,
      stdout: "",
      stderr: "主机配置无效",
      exitCode: null,
      signal: null,
      extra: { direction: "upload" }
    }));
  }
  if (host.enabled === false) {
    return Promise.resolve(buildScpResult(host, {
      ok: false,
      startedAt: Date.now(),
      timedOut: false,
      stdout: "",
      stderr: "该主机已禁用，已跳过",
      exitCode: null,
      signal: null,
      extra: { direction: "upload", skipped: true }
    }));
  }
  const targetRemotePath = resolveRemoteUploadPath(remotePath, fileName);
  const scp = buildScpArgs(host, options);
  if (scp.error) {
    return Promise.resolve(buildScpResult(host, {
      ok: false,
      startedAt: Date.now(),
      timedOut: false,
      stdout: "",
      stderr: scp.error,
      exitCode: null,
      signal: null,
      extra: {
        timeoutMs: options.timeoutMs,
        remotePath: targetRemotePath,
        direction: "upload"
      }
    }));
  }
  return runScpProcess({
    host,
    args: [...scp.args, localFilePath, `${buildSshTarget(host)}:${escapeScpRemotePath(targetRemotePath)}`],
    successMessage: "上传完成",
    extra: {
      timeoutMs: options.timeoutMs,
      remotePath: targetRemotePath,
      direction: "upload",
      scpEnv: scp.env,
      scpCleanup: scp.cleanup
    }
  });
}

function runSingleScpDownload(host, remotePath, localFilePath, options = {}) {
  if (!host || typeof host !== "object") {
    return Promise.resolve(buildScpResult(null, {
      ok: false,
      startedAt: Date.now(),
      timedOut: false,
      stdout: "",
      stderr: "主机配置无效",
      exitCode: null,
      signal: null,
      extra: { direction: "download" }
    }));
  }
  if (host.enabled === false) {
    return Promise.resolve(buildScpResult(host, {
      ok: false,
      startedAt: Date.now(),
      timedOut: false,
      stdout: "",
      stderr: "该主机已禁用，已跳过",
      exitCode: null,
      signal: null,
      extra: { direction: "download", skipped: true }
    }));
  }
  const scp = buildScpArgs(host, options);
  if (scp.error) {
    return Promise.resolve(buildScpResult(host, {
      ok: false,
      startedAt: Date.now(),
      timedOut: false,
      stdout: "",
      stderr: scp.error,
      exitCode: null,
      signal: null,
      extra: { direction: "download", remotePath }
    }));
  }
  const args = [...scp.args];
  if (options.recursive) args.push("-r");
  return runScpProcess({
    host,
    args: [...args, `${buildSshTarget(host)}:${escapeScpRemotePath(remotePath)}`, localFilePath],
    successMessage: "下载完成",
    extra: {
      timeoutMs: options.timeoutMs,
      remotePath,
      localPath: localFilePath,
      direction: "download",
      scpEnv: scp.env,
      scpCleanup: scp.cleanup
    }
  });
}

function buildScpArgs(host, options = {}) {
  const connection = buildSshConnectionOptions(host, options, "scp");
  if (connection.error) return connection;
  return {
    args: [...(connection.authMode === "key" ? ["-B"] : []), ...connection.args],
    env: connection.env,
    cleanup: connection.cleanup
  };
}

function runScpProcess({ host, args, successMessage, extra }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forceKillTimer = null;
    const timeoutMs = clampInt(extra?.timeoutMs ?? extra?.commandTimeoutMs ?? undefined, sshDefaultCommandTimeoutMs, 1000, 10 * 60 * 1000);
    const scpEnv = extra?.scpEnv || process.env;
    const scpCleanup = typeof extra?.scpCleanup === "function" ? extra.scpCleanup : () => {};
    const child = spawn("scp", args, {
      env: scpEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      scpCleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // ignore
      }
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_error) {
          // ignore
        }
      }, 1000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish(buildScpResult(host, {
        ok: false,
        startedAt,
        timedOut,
        stdout,
        stderr: error.message || stderr || "scp 启动失败",
        exitCode: null,
        signal: null,
        extra
      }));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finish(buildScpResult(host, {
        ok: !timedOut && code === 0,
        startedAt,
        timedOut,
        stdout: !stdout && code === 0 ? successMessage || "" : stdout,
        stderr,
        exitCode: Number.isInteger(code) ? code : null,
        signal: signal || null,
        extra
      }));
    });
  });
}

function buildScpResult(host, input) {
  return {
    id: host?.id || "",
    name: host?.name || host?.host || "未命名主机",
    host: host?.host || "",
    ok: !!input.ok,
    exitCode: input.exitCode,
    signal: input.signal || null,
    durationMs: Math.max(0, Date.now() - Number(input.startedAt || Date.now())),
    timedOut: !!input.timedOut,
    stdout: truncateText(input.stdout || "", sshOutputLimit),
    stderr: truncateText(input.stderr || "", sshOutputLimit),
    ...(input.extra && typeof input.extra === "object" ? input.extra : {})
  };
}

function resolveRemoteUploadPath(remotePath, fileName) {
  const value = String(remotePath || "").trim();
  if (!value) {
    throw createHttpError(400, "远程目标路径不能为空");
  }
  if (/[\\r\\n]/.test(value)) {
    throw createHttpError(400, "远程路径不能包含换行");
  }
  if (value.endsWith("/")) {
    return `${value}${fileName}`;
  }
  return value;
}

function escapeScpRemotePath(value) {
  return String(value || "").replace(/([\\ "'`$!&(){}[\];<>|?*])/g, "\\$1");
}

function cleanupTempDirSafe(tempDir) {
  const target = String(tempDir || "").trim();
  if (!target) return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (_error) {
    // ignore cleanup failure
  }
}

function sanitizeRemotePathInput(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw createHttpError(400, "远程路径不能为空");
  }
  if (/[\u0000\r\n]/.test(value)) {
    throw createHttpError(400, "远程路径不能包含换行或空字节");
  }
  return value;
}

function buildRemotePathResolveScript(varName, rawValue) {
  const escaped = escapeShellSingleQuoted(String(rawValue || ""));
  return [
    `${varName}_RAW='${escaped}'`,
    `case "$${varName}_RAW" in`,
    `  '') echo 'ERROR\\tINVALID_PATH\\t${varName}' ; exit 2 ;;`,
    `  '~') ${varName}="$HOME" ;;`,
    `  '~/'*) ${varName}="$HOME/${"$"}{${varName}_RAW#~/}" ;;`,
    `  *) ${varName}="$${varName}_RAW" ;;`,
    "esac"
  ].join("\n");
}

function buildRemoteFileListScript(browsePath, showHidden) {
  const escapedPath = escapeShellSingleQuoted(String(browsePath || "~"));
  const hiddenFlag = showHidden ? "1" : "0";
  return [
    "set -eu",
    `TARGET='${escapedPath}'`,
    `SHOW_HIDDEN='${hiddenFlag}'`,
    "case \"$TARGET\" in",
    "  '') TARGET=\"$HOME\" ;;",
    "  '~') TARGET=\"$HOME\" ;;",
    "  '~/'*) TARGET=\"$HOME/${TARGET#~/}\" ;;",
    "esac",
    "if [ ! -e \"$TARGET\" ]; then",
    "  echo \"ERROR\\tNOT_FOUND\\t$TARGET\"",
    "  exit 3",
    "fi",
    "if [ -f \"$TARGET\" ]; then TARGET=$(dirname -- \"$TARGET\"); fi",
    "cd -- \"$TARGET\"",
    "CWD=$(pwd -P 2>/dev/null || pwd)",
    "PARENT=$(dirname -- \"$CWD\" 2>/dev/null || printf '%s' \"$CWD\")",
    "printf 'META\\tcwd\\t%s\\n' \"$CWD\"",
    "printf 'META\\tparent\\t%s\\n' \"$PARENT\"",
    "emit_item() {",
    "  item=\"$1\"",
    "  [ -e \"$item\" ] || return 0",
    "  name=$(basename -- \"$item\")",
    "  if [ -d \"$item\" ]; then",
    "    kind='dir'; size='0'",
    "  elif [ -L \"$item\" ]; then",
    "    kind='symlink'; size='0'",
    "  else",
    "    kind='file'; size=$(wc -c < \"$item\" 2>/dev/null || printf '0')",
    "  fi",
    "  mtime=$(stat -c %Y \"$item\" 2>/dev/null || stat -f %m \"$item\" 2>/dev/null || date -r \"$item\" +%s 2>/dev/null || printf '0')",
    "  perm=$(stat -c %A \"$item\" 2>/dev/null || stat -f %Sp \"$item\" 2>/dev/null || printf '-')",
    "  owner_group=$(stat -c '%U/%G' \"$item\" 2>/dev/null || stat -f '%Su/%Sg' \"$item\" 2>/dev/null || printf '-')",
    "  printf 'ENTRY\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \"$kind\" \"$size\" \"$mtime\" \"$perm\" \"$owner_group\" \"$name\"",
    "}",
    "for item in \"$CWD\"/*; do emit_item \"$item\"; done",
    "if [ \"$SHOW_HIDDEN\" = '1' ]; then",
    "  for item in \"$CWD\"/.[!.]* \"$CWD\"/..?*; do emit_item \"$item\"; done",
    "fi"
  ].join("\n") + "\n";
}

function buildRemoteFileActionScript(action, options = {}) {
  const targetPath = String(options.path || "");
  const nextPath = String(options.newPath || "");
  const collisionStrategy = normalizeRemoteCollisionStrategy(options.collisionStrategy);
  if (!["mkdir", "delete", "rename", "copy"].includes(action)) {
    throw createHttpError(400, "不支持的远程文件动作");
  }
  if ((action === "mkdir" || action === "delete") && !targetPath) {
    throw createHttpError(400, "缺少远程路径");
  }
  if ((action === "rename" || action === "copy") && (!targetPath || !nextPath)) {
    throw createHttpError(400, `${action === "copy" ? "复制" : "重命名"}需要 path 和 newPath`);
  }

  const lines = [
    "set -eu",
    buildRemotePathResolveScript("TARGET", targetPath)
  ];
  if (action === "rename" || action === "copy") lines.push(buildRemotePathResolveScript("TARGET_NEW", nextPath));
  lines.push(
    "deny_dangerous_path() {",
    "  value=\"$1\"",
    "  if [ \"$value\" = '/' ] || [ \"$value\" = '.' ] || [ \"$value\" = '..' ] || [ \"$value\" = \"$HOME\" ]; then",
    "    echo \"ERROR\\tDANGEROUS_PATH\\t$value\"",
    "    exit 9",
    "  fi",
    "}",
    "real_path() {",
    "  input=\"$1\"",
    "  dir=$(dirname -- \"$input\")",
    "  base=$(basename -- \"$input\")",
    "  if cd -- \"$dir\" 2>/dev/null; then",
    "    printf '%s/%s\\n' \"$(pwd -P 2>/dev/null || pwd)\" \"$base\"",
    "  else",
    "    printf '%s\\n' \"$input\"",
    "  fi",
    "}",
    "split_name_ext() {",
    "  name=\"$1\"",
    "  stem=\"$name\"",
    "  ext=''",
    "  case \"$name\" in",
    "    .*.*)",
    "      rest=${name#*.}",
    "      stem=\".${rest%.*}\"",
    "      ext=\".${rest##*.}\"",
    "      ;;",
    "    *.*)",
    "      stem=\"${name%.*}\"",
    "      ext=\".${name##*.}\"",
    "      ;;",
    "  esac",
    "}",
    "pick_available_path() {",
    "  target=\"$1\"",
    "  if [ ! -e \"$target\" ]; then",
    "    printf '%s\\n' \"$target\"",
    "    return 0",
    "  fi",
    "  dir=$(dirname -- \"$target\")",
    "  name=$(basename -- \"$target\")",
    "  split_name_ext \"$name\"",
    "  counter=1",
    "  while [ \"$counter\" -le 9999 ]; do",
    "    candidate=\"$dir/$stem ($counter)$ext\"",
    "    if [ ! -e \"$candidate\" ]; then",
    "      printf '%s\\n' \"$candidate\"",
    "      return 0",
    "    fi",
    "    counter=$((counter + 1))",
    "  done",
    "  echo \"ERROR\\tNO_AVAILABLE_PATH\\t$target\"",
    "  exit 5",
    "}"
  );
  if (action === "mkdir") {
    lines.push(
      "mkdir -p -- \"$TARGET\"",
      "ABS_PATH=$(cd -- \"$TARGET\" 2>/dev/null && (pwd -P 2>/dev/null || pwd) || real_path \"$TARGET\")",
      "printf 'META\\tpath\\t%s\\n' \"$ABS_PATH\"",
      "printf 'META\\taction\\tmkdir\\n'",
      "echo '目录已创建'"
    );
  } else if (action === "delete") {
    lines.push(
      "deny_dangerous_path \"$TARGET\"",
      "[ -e \"$TARGET\" ] || { echo \"ERROR\\tNOT_FOUND\\t$TARGET\"; exit 3; }",
      "ABS_PATH=$(real_path \"$TARGET\")",
      "rm -rf -- \"$TARGET\"",
      "printf 'META\\tpath\\t%s\\n' \"$ABS_PATH\"",
      "printf 'META\\taction\\tdelete\\n'",
      "echo '远程项目已删除'"
    );
  } else if (action === "rename") {
    lines.push(
      "deny_dangerous_path \"$TARGET\"",
      "deny_dangerous_path \"$TARGET_NEW\"",
      "[ -e \"$TARGET\" ] || { echo \"ERROR\\tNOT_FOUND\\t$TARGET\"; exit 3; }",
      collisionStrategy === "rename"
        ? "TARGET_FINAL=$(pick_available_path \"$TARGET_NEW\")"
        : "[ ! -e \"$TARGET_NEW\" ] || { echo \"ERROR\\tALREADY_EXISTS\\t$TARGET_NEW\"; exit 4; }\nTARGET_FINAL=\"$TARGET_NEW\"",
      "mkdir -p -- \"$(dirname -- \"$TARGET_FINAL\")\"",
      "ABS_OLD=$(real_path \"$TARGET\")",
      "mv -- \"$TARGET\" \"$TARGET_FINAL\"",
      "ABS_NEW=$(real_path \"$TARGET_FINAL\")",
      "printf 'META\\tpath\\t%s\\n' \"$ABS_OLD\"",
      "printf 'META\\tnewPath\\t%s\\n' \"$ABS_NEW\"",
      "printf 'META\\taction\\trename\\n'",
      "echo '远程项目已重命名'"
    );
  } else if (action === "copy") {
    lines.push(
      "deny_dangerous_path \"$TARGET\"",
      "deny_dangerous_path \"$TARGET_NEW\"",
      "[ -e \"$TARGET\" ] || { echo \"ERROR\\tNOT_FOUND\\t$TARGET\"; exit 3; }",
      collisionStrategy === "rename"
        ? "TARGET_FINAL=$(pick_available_path \"$TARGET_NEW\")"
        : "[ ! -e \"$TARGET_NEW\" ] || { echo \"ERROR\\tALREADY_EXISTS\\t$TARGET_NEW\"; exit 4; }\nTARGET_FINAL=\"$TARGET_NEW\"",
      "mkdir -p -- \"$(dirname -- \"$TARGET_FINAL\")\"",
      "ABS_OLD=$(real_path \"$TARGET\")",
      "cp -a -- \"$TARGET\" \"$TARGET_FINAL\"",
      "ABS_NEW=$(real_path \"$TARGET_FINAL\")",
      "printf 'META\\tpath\\t%s\\n' \"$ABS_OLD\"",
      "printf 'META\\tnewPath\\t%s\\n' \"$ABS_NEW\"",
      "printf 'META\\taction\\tcopy\\n'",
      "echo '远程项目已复制'"
    );
  }
  return lines.join("\n") + "\n";
}

function parseRemoteFileListOutput(stdout) {
  const result = {
    cwd: "",
    parent: "",
    entries: []
  };
  String(stdout || "")
    .split(/\r?\n/g)
    .forEach((line) => {
      const raw = String(line || "");
      if (!raw) return;
      const parts = raw.split("\t");
      if (parts[0] === "ERROR") {
        const message = parts.slice(1).join(" ").trim() || "远程目录读取失败";
        throw createHttpError(400, message);
      }
      if (parts[0] === "META" && parts.length >= 3) {
        if (parts[1] === "cwd") result.cwd = parts.slice(2).join("\t");
        if (parts[1] === "parent") result.parent = parts.slice(2).join("\t");
        return;
      }
      if (parts[0] === "ENTRY" && parts.length >= 5) {
        const kind = String(parts[1] || "").trim();
        const size = Number.parseInt(String(parts[2] || "0"), 10);
        const mtimeSec = Number.parseInt(String(parts[3] || "0"), 10);
        const permission = parts.length >= 7 ? String(parts[4] || "").trim() : "";
        const ownerGroup = parts.length >= 7 ? String(parts[5] || "").trim() : "";
        const name = parts.length >= 7 ? parts.slice(6).join("\t") : parts.slice(4).join("\t");
        if (!name || name === "." || name === "..") return;
        result.entries.push({
          kind: kind === "dir" || kind === "symlink" ? kind : "file",
          name,
          size: Number.isFinite(size) ? size : 0,
          mtimeSec: Number.isFinite(mtimeSec) ? mtimeSec : 0,
          permission: permission || "-",
          ownerGroup: ownerGroup || "-"
        });
      }
    });

  result.entries.sort((a, b) => {
    const aRank = a.kind === "dir" ? 0 : a.kind === "symlink" ? 1 : 2;
    const bRank = b.kind === "dir" ? 0 : b.kind === "symlink" ? 1 : 2;
    return aRank - bRank || a.name.localeCompare(b.name, "zh-CN");
  });
  return result;
}

function parseRemoteFileActionOutput(stdout) {
  const result = {
    path: "",
    newPath: "",
    action: ""
  };
  String(stdout || "")
    .split(/\r?\n/g)
    .forEach((line) => {
      const raw = String(line || "");
      if (!raw) return;
      const parts = raw.split("\t");
      if (parts[0] === "ERROR") {
        const detail = parts.slice(1).join(" ").trim() || "远程文件操作失败";
        throw createHttpError(400, detail);
      }
      if (parts[0] === "META" && parts.length >= 3) {
        const value = parts.slice(2).join("\t");
        if (parts[1] === "path") result.path = value;
        if (parts[1] === "newPath") result.newPath = value;
        if (parts[1] === "action") result.action = value;
      }
    });
  return result;
}

function buildRemoteReadTextScript(remotePath, maxBytes) {
  const max = clampInt(maxBytes, sshRemoteTextMaxBytes, 1024, 5 * 1024 * 1024);
  return [
    "set -eu",
    buildRemotePathResolveScript("TARGET", remotePath),
    "[ -e \"$TARGET\" ] || { echo \"ERROR\\tNOT_FOUND\\t$TARGET\"; exit 3; }",
    "[ -f \"$TARGET\" ] || { echo \"ERROR\\tNOT_FILE\\t$TARGET\"; exit 4; }",
    "command -v base64 >/dev/null 2>&1 || { echo \"ERROR\\tBASE64_MISSING\\tbase64\"; exit 5; }",
    "SIZE=$(wc -c < \"$TARGET\" 2>/dev/null || printf '0')",
    `if [ "$SIZE" -gt "${max}" ]; then echo "ERROR\\tTOO_LARGE\\t$SIZE"; exit 6; fi`,
    "DIR=$(dirname -- \"$TARGET\")",
    "BASE=$(basename -- \"$TARGET\")",
    "if cd -- \"$DIR\" 2>/dev/null; then ABS_PATH=\"$(pwd -P 2>/dev/null || pwd)/$BASE\"; else ABS_PATH=\"$TARGET\"; fi",
    "MTIME=$(stat -c %Y \"$TARGET\" 2>/dev/null || stat -f %m \"$TARGET\" 2>/dev/null || date -r \"$TARGET\" +%s 2>/dev/null || printf '0')",
    "printf 'META\\tpath\\t%s\\n' \"$ABS_PATH\"",
    "printf 'META\\tsize\\t%s\\n' \"$SIZE\"",
    "printf 'META\\tmtime\\t%s\\n' \"$MTIME\"",
    "printf 'DATA\\t'",
    "base64 \"$TARGET\" | tr -d '\\n'",
    "printf '\\n'"
  ].join("\n") + "\n";
}

function parseRemoteReadTextOutput(stdout) {
  const result = {
    path: "",
    size: 0,
    mtimeSec: 0,
    contentBase64: ""
  };
  String(stdout || "")
    .split(/\r?\n/g)
    .forEach((line) => {
      const raw = String(line || "");
      if (!raw) return;
      const parts = raw.split("\t");
      if (parts[0] === "ERROR") {
        const code = String(parts[1] || "").trim();
        const detail = String(parts[2] || "").trim();
        if (code === "TOO_LARGE") {
          throw createHttpError(400, `文件过大：${detail || "未知大小"} 字节`);
        }
        throw createHttpError(400, detail || code || "远程文本读取失败");
      }
      if (parts[0] === "META" && parts.length >= 3) {
        const value = parts.slice(2).join("\t");
        if (parts[1] === "path") result.path = value;
        if (parts[1] === "size") result.size = Number.parseInt(value, 10) || 0;
        if (parts[1] === "mtime") result.mtimeSec = Number.parseInt(value, 10) || 0;
        return;
      }
      if (parts[0] === "DATA" && parts.length >= 2) {
        result.contentBase64 = parts.slice(1).join("\t");
      }
    });
  return result;
}

function buildRemoteWriteTextScript(remotePath, contentBase64) {
  const rawContent = String(contentBase64 || "");
  return [
    "set -eu",
    buildRemotePathResolveScript("TARGET", remotePath),
    "command -v base64 >/dev/null 2>&1 || { echo \"ERROR\\tBASE64_MISSING\\tbase64\"; exit 5; }",
    "DIR=$(dirname -- \"$TARGET\")",
    "BASE=$(basename -- \"$TARGET\")",
    "mkdir -p -- \"$DIR\"",
    "TMP_FILE=\"$DIR/.openclaw-write-$$-$BASE.tmp\"",
    "cat > \"$TMP_FILE.b64\" <<'__OPENCLAW_B64__'",
    rawContent,
    "__OPENCLAW_B64__",
    "base64 -d \"$TMP_FILE.b64\" > \"$TMP_FILE\" 2>/dev/null || { rm -f -- \"$TMP_FILE.b64\" \"$TMP_FILE\"; echo \"ERROR\\tDECODE_FAILED\\tbase64\"; exit 6; }",
    "mv -- \"$TMP_FILE\" \"$TARGET\"",
    "rm -f -- \"$TMP_FILE.b64\"",
    "if cd -- \"$DIR\" 2>/dev/null; then ABS_PATH=\"$(pwd -P 2>/dev/null || pwd)/$BASE\"; else ABS_PATH=\"$TARGET\"; fi",
    "printf 'META\\tpath\\t%s\\n' \"$ABS_PATH\"",
    "printf 'META\\taction\\twrite\\n'",
    "echo '文本内容已保存'"
  ].join("\n") + "\n";
}

function looksLikeUtf8TextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (!buffer.length) return true;
  for (const byte of buffer) {
    if (byte === 0) return false;
  }
  const decoded = buffer.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(buffer)) return false;
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte < 32 && ![9, 10, 13, 12, 8].includes(byte)) suspicious += 1;
  }
  return suspicious / buffer.length < 0.02;
}

function loadLocalPublicKey(preferredPath, inlineValue) {
  const providedValue = String(inlineValue || "").trim();
  if (providedValue) {
    return {
      path: "",
      publicKey: providedValue
    };
  }

  const candidates = [];
  const explicit = String(preferredPath || "").trim();
  if (explicit) {
    candidates.push(expandHomeDir(explicit));
  }
  [
    "~/.ssh/id_ed25519.pub",
    "~/.ssh/id_rsa.pub",
    "~/.ssh/id_ecdsa.pub",
    "~/.ssh/id_dsa.pub"
  ].forEach((item) => {
    const resolved = expandHomeDir(item);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  });

  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const content = String(fs.readFileSync(candidate, "utf8") || "").trim();
      if (!content) continue;
      return {
        path: candidate,
        publicKey: content
      };
    } catch (_error) {
      // try next candidate
    }
  }

  throw createHttpError(404, "未找到本机公钥，请填写公钥内容或指定 .pub 路径");
}

function deriveSshPublicKeyFromPrivateKeyText(privateKeyText) {
  let tempKeyPath = "";
  try {
    tempKeyPath = writeTempSshPrivateKey(privateKeyText);
    const result = spawnSync("ssh-keygen", ["-y", "-f", tempKeyPath], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 256 * 1024,
      env: process.env
    });
    const stdout = String(result.stdout || "").trim();
    const stderr = String(result.stderr || "").trim();
    if (result.status !== 0 || !stdout) {
      const detail = stderr || stdout || "ssh-keygen 执行失败";
      throw createHttpError(400, detail);
    }
    if (!/^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/=]+(?:\s+.+)?$/.test(stdout)) {
      throw createHttpError(400, "生成的公钥格式不正确，请确认私钥内容有效");
    }
    return stdout;
  } finally {
    cleanupFileSafe(tempKeyPath);
  }
}

function buildAuthorizedKeyInstallScript(publicKey) {
  const escaped = escapeShellSingleQuoted(publicKey);
  return [
    "set -eu",
    "umask 077",
    "SSH_DIR=\"$HOME/.ssh\"",
    "AUTH_FILE=\"$SSH_DIR/authorized_keys\"",
    "mkdir -p \"$SSH_DIR\"",
    "chmod 700 \"$SSH_DIR\"",
    "touch \"$AUTH_FILE\"",
    "chmod 600 \"$AUTH_FILE\"",
    `KEY='${escaped}'`,
    "if grep -Fqx -- \"$KEY\" \"$AUTH_FILE\"; then",
    "  echo \"公钥已存在，无需重复写入\"",
    "else",
    "  printf '%s\\n' \"$KEY\" >> \"$AUTH_FILE\"",
    "  echo \"公钥已追加到 authorized_keys\"",
    "fi"
  ].join("\n") + "\n";
}

function buildAuthorizedKeyCheckScript(publicKey) {
  const escaped = escapeShellSingleQuoted(publicKey);
  return [
    "set -eu",
    "SSH_DIR=\"$HOME/.ssh\"",
    "AUTH_FILE=\"$SSH_DIR/authorized_keys\"",
    "LINE_COUNT='0'",
    "if [ -f \"$AUTH_FILE\" ]; then",
    "  LINE_COUNT=$(wc -l < \"$AUTH_FILE\" 2>/dev/null || printf '0')",
    "fi",
    `KEY='${escaped}'`,
    "printf '__OPENCLAW_AUTH_FILE__%s\\n' \"$AUTH_FILE\"",
    "printf '__OPENCLAW_AUTH_LINES__%s\\n' \"$LINE_COUNT\"",
    "if [ -f \"$AUTH_FILE\" ] && grep -Fqx -- \"$KEY\" \"$AUTH_FILE\"; then",
    "  printf '__OPENCLAW_KEY_EXISTS__\\n'",
    "  echo '当前主机已存在这条公钥'",
    "else",
    "  printf '__OPENCLAW_KEY_MISSING__\\n'",
    "  echo '当前主机还没有这条公钥'",
    "fi"
  ].join("\n") + "\n";
}

function parseSshPublicKeyMeta(publicKey) {
  const parts = String(publicKey || "").trim().split(/\s+/);
  return {
    keyType: String(parts[0] || "").trim(),
    keyComment: parts.length > 2 ? parts.slice(2).join(" ").trim() : ""
  };
}

function escapeShellSingleQuoted(value) {
  return String(value || "").replace(/'/g, `'\"'\"'`);
}

function resolveTerminalCwdUnrestricted(rawCwd, defaultRoot) {
  const fallback = path.normalize(String(defaultRoot || projectsConfigDefaults.defaultRoot || process.cwd()));
  const value = String(rawCwd || "").trim();
  const target = value ? expandHomeDir(value) : fallback;
  const absolute = path.isAbsolute(target) ? target : path.resolve(fallback, target);
  const normalized = path.normalize(absolute);
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    const error = new Error(`cwd 不存在：${normalized}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

async function handleDiscoverModels(req, res) {
  try {
    const payload = await readJsonBody(req);
    const provider = String(payload.provider || "custom");
    const baseUrl = String(payload.baseUrl || "").trim();
    const apiKey = String(payload.apiKey || "").trim();

    if (!baseUrl) {
      sendJson(res, 400, { error: "缺少接口地址（baseUrl）" });
      return;
    }

    if (!apiKey && provider !== "ollama") {
      sendJson(res, 400, { error: "缺少 API 密钥（apiKey）" });
      return;
    }

    const models = await discoverProviderModels({ provider, baseUrl, apiKey });
    sendJson(res, 200, { models });
  } catch (error) {
    sendJson(res, 502, { error: error.message || "拉取模型失败" });
  }
}

async function handleTestModel(req, res) {
  try {
    const payload = await readJsonBody(req);
    const provider = String(payload.provider || "custom").trim();
    const model = String(payload.model || "").trim();
    const baseUrl = String(payload.baseUrl || "").trim();
    const apiKey = String(payload.apiKey || "").trim();

    if (!model) {
      sendJson(res, 400, { error: "缺少模型 ID（model）" });
      return;
    }
    if (!baseUrl) {
      sendJson(res, 400, { error: "缺少接口地址（baseUrl）" });
      return;
    }
    if (!apiKey && provider !== "ollama") {
      sendJson(res, 400, { error: "缺少 API 密钥（apiKey）" });
      return;
    }

    const startedAt = Date.now();
    const text = await chatWithProvider({
      provider,
      model,
      baseUrl,
      apiKey,
      messages: [{ role: "user", content: "ping" }],
      systemPrompt: "你是连通性测试助手，请仅回复 ping-ok。",
      temperature: 0,
      maxTokens: 16,
      topP: 1
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    sendJson(res, 200, {
      ok: true,
      provider,
      model,
      latencyMs,
      preview: String(text || "").slice(0, 80)
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 502;
    sendJson(res, statusCode, { error: error.message || "连通性测试失败" });
  }
}

async function handleGetModelConsoleConfig(res) {
  try {
    const state = loadModelConsoleConfig();
    sendJson(res, 200, {
      state,
      path: modelConsoleConfigPath
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取模型配置失败" });
  }
}

async function handleSaveModelConsoleConfig(req, res) {
  try {
    const payload = await readJsonBody(req);
    const source = payload && typeof payload === "object" && payload.state ? payload.state : payload;
    const state = normalizeModelConsoleState(source);
    saveModelConsoleConfig(state);
    sendJson(res, 200, {
      ok: true,
      state,
      path: modelConsoleConfigPath
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "保存模型配置失败" });
  }
}

async function handleChat(req, res) {
  try {
    const payload = await readJsonBody(req);
    const provider = String(payload.provider || "custom");
    const model = String(payload.model || "").trim();
    const baseUrl = String(payload.baseUrl || "").trim();
    const apiKey = String(payload.apiKey || "").trim();
    const systemPrompt = String(payload.systemPrompt || "").trim();
    const temperature = clampNumber(payload.temperature, 0.7, 0, 2);
    const maxTokens = clampInt(payload.maxTokens, 1024, 1, 32000);
    const topP = clampNumber(payload.topP, 1, 0, 1);
    const useStartupSequence = payload.useStartupSequence !== false;
    const rawProjectPath = String(payload.projectPath || "").trim();
    const messages = normalizeChatMessages(payload.messages);
    const latestUserMessage = findLatestUserMessage(messages);
    const projectsConfig = loadProjectsConfig();
    const projectPath = rawProjectPath
      ? resolveProjectPathForRequest(rawProjectPath, projectsConfig)
      : "";
    const projectContext = buildGlobalWorkspaceContext(projectPath);
    const attachments = normalizeIncomingAttachments(payload.attachments);

    if (!messages.length) {
      sendJson(res, 400, { error: "消息列表为空（messages）" });
      return;
    }

    const taskResult = await tryExecuteTaskFromText({
      text: latestUserMessage?.content || "",
      config: loadTaskExecutorConfig(),
      cwd: projectPath || root,
      resolveNaturalLanguageCommand: async (text) =>
        resolveNaturalLanguageCommandByModel({
          text,
          provider,
          model,
          baseUrl,
          apiKey
        })
    });
    if (taskResult.handled) {
      appendGlobalMemoryEntrySafe(projectPath, {
        userText: latestUserMessage?.content || "",
        assistantText: taskResult.reply,
        mode: "task"
      });
      appendChatHistoryEntry({
        ts: new Date().toISOString(),
        mode: "task",
        provider,
        model,
        projectPath,
        userText: latestUserMessage?.content || "",
        assistantText: taskResult.reply
      });
      sendJson(res, 200, {
        message: taskResult.reply,
        taskExecutor: {
          ...taskResult.meta,
          handled: true,
          ok: !!taskResult.ok
        },
        project: buildProjectResponse(projectPath, projectContext.diagnostics)
      });
      return;
    }

    if (!model) {
      sendJson(res, 400, { error: "缺少模型 ID（model）" });
      return;
    }
    if (!baseUrl) {
      sendJson(res, 400, { error: "缺少接口地址（baseUrl）" });
      return;
    }
    if (!apiKey && provider !== "ollama") {
      sendJson(res, 400, { error: "缺少 API 密钥（apiKey）" });
      return;
    }

    const startupSequence = useStartupSequence
      ? buildStartupSequenceContext(loadStartupSequenceConfig())
      : { text: "", diagnostics: { enabled: false, skipped: true } };
    const attachmentsContext = await buildAttachmentsContext({
      projectPath,
      attachments,
      query: latestUserMessage?.content || ""
    });
    const mergedSystemPrompt = mergePromptText(
      mergePromptText(systemPrompt, startupSequence.text),
      projectContext.text
    );
    const finalSystemPrompt = mergePromptText(mergedSystemPrompt, attachmentsContext);

    const text = await chatWithProvider({
      provider,
      model,
      baseUrl,
      apiKey,
      messages,
      systemPrompt: finalSystemPrompt,
      temperature,
      maxTokens,
      topP
    });
    appendGlobalMemoryEntrySafe(projectPath, {
      userText: latestUserMessage?.content || "",
      assistantText: text,
      mode: "chat"
    });
    appendChatHistoryEntry({
      ts: new Date().toISOString(),
      mode: "chat",
      provider,
      model,
      projectPath,
      userText: latestUserMessage?.content || "",
      assistantText: text
    });
    sendJson(res, 200, {
      message: text,
      startupSequence: startupSequence.diagnostics,
      project: buildProjectResponse(projectPath, projectContext.diagnostics)
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 502;
    sendJson(res, statusCode, { error: error.message || "对话失败" });
  }
}

function getTerminalAllowedCommands() {
  return new Set([
    "pwd",
    "ls",
    "whoami",
    "id",
    "uname",
    "date",
    "uptime",
    "df",
    "free",
    "ps",
    "ss",
    "cat",
    "head",
    "tail",
    "rg",
    "systemctl",
    "journalctl",
    "node",
    "npm",
    "openclaw"
  ]);
}

function buildTerminalEnv() {
  const env = { ...process.env };
  // Avoid accidental side effects from interactive shells.
  env.LC_ALL = env.LC_ALL || "C.UTF-8";
  env.LANG = env.LANG || "C.UTF-8";
  return env;
}

function resolveTerminalCwd(rawCwd, defaultRoot, allowedRoots) {
  const fallback = path.normalize(String(defaultRoot || projectsConfigDefaults.defaultRoot));
  const value = String(rawCwd || "").trim();
  const target = value ? expandHomeDir(value) : fallback;
  const absolute = path.isAbsolute(target) ? target : path.resolve(fallback, target);
  const normalized = path.normalize(absolute);
  if (!isPathUnderAllowedRoots(normalized, allowedRoots)) {
    const error = new Error(`cwd 不在允许范围内，仅允许：${allowedRoots.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    const error = new Error(`cwd 不存在：${normalized}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function truncateText(text, limit) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  return value.slice(0, limit) + `\n...[输出已截断，最多 ${limit} 字符]\n`;
}

function tokenizeTerminalCommand(input) {
  const source = String(input || "");
  // Block obvious shell metacharacters to avoid turning this into a remote shell.
  if (/[;&|><`$()]/.test(source)) {
    const error = new Error("命令包含不允许的 shell 符号（;&|><`$()）");
    error.statusCode = 400;
    throw error;
  }

  const out = [];
  let buf = "";
  let quote = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) {
        quote = "";
        continue;
      }
      if (ch === "\\" && quote === '"' && i + 1 < source.length) {
        const next = source[i + 1];
        buf += next;
        i += 1;
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    if (ch === "\\" && i + 1 < source.length) {
      buf += source[i + 1];
      i += 1;
      continue;
    }
    buf += ch;
  }
  if (quote) {
    const error = new Error("引号未闭合");
    error.statusCode = 400;
    throw error;
  }
  if (buf) out.push(buf);
  return out.map((t) => t.trim()).filter(Boolean);
}

function validateTerminalCommand(cmd, args) {
  const allowed = getTerminalAllowedCommands();
  if (!allowed.has(cmd)) {
    const error = new Error(`命令不在白名单：${cmd}`);
    error.statusCode = 400;
    throw error;
  }

  if (cmd === "systemctl") {
    validateTerminalSystemctl(args);
    return;
  }
  if (cmd === "journalctl") {
    validateTerminalJournalctl(args);
    return;
  }
  if (cmd === "cat" || cmd === "head" || cmd === "tail" || cmd === "rg") {
    validateTerminalPathArgs(args);
    return;
  }
}

function validateTerminalSystemctl(args) {
  const list = Array.isArray(args) ? args : [];
  const hasSystem = list.includes("--system");
  if (hasSystem) {
    const error = new Error("禁止使用 systemctl --system");
    error.statusCode = 400;
    throw error;
  }
  const sub = list.find((item) => !item.startsWith("-")) || "";
  const allowedSub = new Set(["status", "is-active", "list-units", "list-timers", "show"]);
  if (!sub || !allowedSub.has(sub)) {
    const error = new Error("systemctl 仅允许：status / is-active / list-units / list-timers / show");
    error.statusCode = 400;
    throw error;
  }
  if (!list.includes("--user")) {
    const error = new Error("systemctl 必须带 --user");
    error.statusCode = 400;
    throw error;
  }
}

function validateTerminalJournalctl(args) {
  const list = Array.isArray(args) ? args : [];
  if (list.includes("--system")) {
    const error = new Error("禁止使用 journalctl --system");
    error.statusCode = 400;
    throw error;
  }
}

function validateTerminalPathArgs(args) {
  const projectsConfig = loadProjectsConfig();
  const allowedRoots = Array.isArray(projectsConfig.allowedRoots) ? projectsConfig.allowedRoots : [];
  (Array.isArray(args) ? args : []).forEach((arg) => {
    const value = String(arg || "").trim();
    if (!value) return;
    if (value === "-" || value.startsWith("-")) return;
    const expanded = expandHomeDir(value);
    if (!expanded.includes("/") && !expanded.startsWith(".")) return;
    const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(projectsConfig.defaultRoot, expanded);
    const normalized = path.normalize(absolute);
    if (!isPathUnderAllowedRoots(normalized, allowedRoots)) {
      const error = new Error(`路径不在允许范围内：${value}`);
      error.statusCode = 400;
      throw error;
    }
  });
}

async function handleGetTaskExecutor(res) {
  try {
    sendJson(res, 200, {
      config: loadTaskExecutorConfig(),
      path: getTaskExecutorConfigPath()
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取任务执行配置失败" });
  }
}

async function handleSaveTaskExecutor(req, res) {
  try {
    const payload = await readJsonBody(req);
    const config = normalizeTaskExecutorConfig(payload || {});
    saveTaskExecutorConfig(config);
    sendJson(res, 200, {
      ok: true,
      config,
      path: getTaskExecutorConfigPath()
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "保存任务执行配置失败" });
  }
}

async function handleGetProjectsConfig(res) {
  try {
    sendJson(res, 200, {
      config: loadProjectsConfig(),
      path: projectsConfigPath
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取项目配置失败" });
  }
}

async function handleListProjects(res) {
  try {
    const projectsConfig = loadProjectsConfig();
    const workspace = ensureGlobalWorkspaceFiles();
    const projectsState = loadProjectsState();
    const items = listProjectsFromRoots(projectsConfig.allowedRoots);
    const archivedSet = new Set(projectsState.archivedPaths.map((item) => path.resolve(item)));
    const activeItems = items.filter((projectPath) => !archivedSet.has(path.resolve(projectPath)));
    const archivedItems = items.filter((projectPath) => archivedSet.has(path.resolve(projectPath)));

    const projects = activeItems.map((projectPath) => {
      return {
        name: path.basename(projectPath),
        path: projectPath,
        workspace: {
          dir: workspace.workspaceDir,
          files: workspace.files
        }
      };
    });
    const archivedProjects = archivedItems.map((projectPath) => ({
      name: path.basename(projectPath),
      path: projectPath
    }));
    sendJson(res, 200, {
      projects,
      archivedProjects,
      roots: projectsConfig.allowedRoots
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取项目列表失败" });
  }
}

async function handleArchiveProject(req, res) {
  try {
    const payload = await readJsonBody(req);
    const projectsConfig = loadProjectsConfig();
    const projectPath = resolveProjectPathForRequest(payload.projectPath, projectsConfig);
    const state = loadProjectsState();
    const next = new Set(state.archivedPaths.map((item) => path.resolve(item)));
    next.add(path.resolve(projectPath));
    saveProjectsState({ archivedPaths: Array.from(next) });
    sendJson(res, 200, { ok: true, archived: true, projectPath });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "归档项目失败" });
  }
}

async function handleRestoreProject(req, res) {
  try {
    const payload = await readJsonBody(req);
    const projectsConfig = loadProjectsConfig();
    const projectPath = resolveProjectPathForRequest(payload.projectPath, projectsConfig);
    const state = loadProjectsState();
    const removeTarget = path.resolve(projectPath);
    const archivedPaths = state.archivedPaths.filter((item) => path.resolve(item) !== removeTarget);
    saveProjectsState({ archivedPaths });
    sendJson(res, 200, { ok: true, archived: false, projectPath });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "恢复项目失败" });
  }
}

async function handleCreateProject(req, res) {
  try {
    const payload = await readJsonBody(req);
    const projectsConfig = loadProjectsConfig();
    const name = normalizeProjectName(payload.name);
    const parentDir = resolveProjectParentDir(payload.parentDir, projectsConfig);
    if (path.basename(parentDir) === name) {
      sendJson(res, 400, {
        error: `父目录末级与项目名相同（${name}），会形成重复目录。请将工作目录改为上一级目录。`
      });
      return;
    }
    if (!isPathUnderAllowedRoots(parentDir, projectsConfig.allowedRoots)) {
      sendJson(res, 400, {
        error: `目标目录不在允许范围内，仅允许：${projectsConfig.allowedRoots.join(", ")}`
      });
      return;
    }

    const projectPath = path.join(parentDir, name);
    if (!isPathUnderAllowedRoots(projectPath, projectsConfig.allowedRoots)) {
      sendJson(res, 400, {
        error: `项目目录不在允许范围内，仅允许：${projectsConfig.allowedRoots.join(", ")}`
      });
      return;
    }

    if (fs.existsSync(projectPath)) {
      sendJson(res, 409, { error: `项目已存在：${projectPath}` });
      return;
    }

    const template = normalizeProjectTemplate(payload.template);
    fs.mkdirSync(parentDir, { recursive: true });
    fs.mkdirSync(projectPath);
    const createdFiles = scaffoldProjectFiles(projectPath, name, template);
    const workspace = ensureGlobalWorkspaceFiles();

    sendJson(res, 200, {
      ok: true,
      project: {
        name,
        path: projectPath,
        parentDir,
        template,
        createdFiles,
        workspace: {
          dir: workspace.workspaceDir,
          files: workspace.files
        }
      }
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "创建项目失败" });
  }
}

async function handleGetChatHistory(req, res) {
  try {
    const params = new URL(req.url || "", "http://localhost").searchParams;
    const rawProjectPath = String(params.get("projectPath") || "").trim();
    if (!rawProjectPath) {
      sendJson(res, 400, { error: "缺少 projectPath 参数" });
      return;
    }
    const projectsConfig = loadProjectsConfig();
    const projectPath = resolveProjectPathForRequest(rawProjectPath, projectsConfig);
    const store = loadChatHistoryStore();
    const entries = Array.isArray(store.projects[projectPath]) ? store.projects[projectPath] : [];
    sendJson(res, 200, {
      projectPath,
      entries,
      messages: historyEntriesToMessages(entries)
    });
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "读取备份对话失败" });
  }
}

async function handleGetStartupSequence(_req, res) {
  try {
    const config = loadStartupSequenceConfig();
    const preview = buildStartupSequenceContext(config);
    sendJson(res, 200, {
      config,
      preview: preview.diagnostics
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取启动序列失败" });
  }
}

async function handleSaveStartupSequence(req, res) {
  try {
    const payload = await readJsonBody(req);
    const config = normalizeStartupSequenceConfig(payload || {});
    saveStartupSequenceConfig(config);
    const preview = buildStartupSequenceContext(config);
    sendJson(res, 200, {
      ok: true,
      config,
      preview: preview.diagnostics
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "保存启动序列失败" });
  }
}

async function handleGetIntegrationsConfig(res) {
  try {
    const bridgeConfig = loadBridgeConfigForUi();
    const env = loadBridgeEnvForUi();
    const service = getBridgeServiceStatus();
    sendJson(res, 200, {
      bridgeConfig,
      env,
      service,
      paths: {
        bridgeConfigPath,
        bridgeEnvPath
      }
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取配置失败" });
  }
}

async function handleSaveIntegrationsConfig(req, res) {
  try {
    const payload = await readJsonBody(req);
    const bridgeConfig = normalizeBridgeConfigForUi(payload.bridgeConfig || {});
    const currentEnv = loadBridgeEnvForUi();
    const incomingEnv = payload.env && typeof payload.env === "object" ? payload.env : {};
    const env = normalizeBridgeEnvForUi({ ...currentEnv, ...incomingEnv });

    if (!bridgeConfig.model.provider || !bridgeConfig.model.baseUrl || !bridgeConfig.model.model) {
      sendJson(res, 400, { error: "模型配置缺失：model.provider / model.baseUrl / model.model" });
      return;
    }

    fs.writeFileSync(bridgeConfigPath, `${JSON.stringify(bridgeConfig, null, 2)}\n`, "utf8");
    saveBridgeEnvForUi(env);

    sendJson(res, 200, {
      ok: true,
      service: getBridgeServiceStatus()
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "保存配置失败" });
  }
}

async function handleGetIntegrationsService(res) {
  try {
    sendJson(res, 200, getBridgeServiceStatus());
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取服务状态失败" });
  }
}

async function handleIntegrationsServiceAction(req, res) {
  try {
    const payload = await readJsonBody(req);
    const action = String(payload.action || "").trim();
    if (!["start", "stop", "restart", "status"].includes(action)) {
      sendJson(res, 400, { error: "不支持的 action，允许值：start/stop/restart/status" });
      return;
    }

    const service = getBridgeServiceStatus();
    if (!service.available) {
      sendJson(res, 400, { error: "当前系统不可用 systemctl --user，无法管理服务" });
      return;
    }

    let commandResult = { ok: true, stdout: "", stderr: "" };
    if (action !== "status") {
      commandResult = runSystemctlUser([action, bridgeServiceName]);
      if (!commandResult.ok) {
        sendJson(res, 500, {
          error: commandResult.stderr || commandResult.stdout || `${action} 失败`,
          service: getBridgeServiceStatus()
        });
        return;
      }
    }

    sendJson(res, 200, {
      ok: true,
      action,
      commandResult,
      service: getBridgeServiceStatus()
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务操作失败" });
  }
}

async function handleIntegrationsTest(req, res) {
  try {
    const payload = await readJsonBody(req);
    const type = String(payload.type || "").trim();
    const bridgeConfig = normalizeBridgeConfigForUi(payload.bridgeConfig || loadBridgeConfigForUi());
    const env = normalizeBridgeEnvForUi(payload.env || loadBridgeEnvForUi());

    if (type === "telegram") {
      const token = resolveSecretInput(bridgeConfig.telegram.botToken, env);
      if (!token) {
        sendJson(res, 400, { error: "Telegram botToken 为空（可填明文或 $TG_BOT_TOKEN）" });
        return;
      }
      const apiBase = String(bridgeConfig.telegram.apiBase || "https://api.telegram.org").trim();
      const data = await requestJson(`${apiBase}/bot${token}/getMe`, { method: "GET" });
      if (!data.ok) {
        throw new Error(data.description || "Telegram getMe 失败");
      }
      sendJson(res, 200, {
        ok: true,
        type,
        result: {
          id: data.result?.id || "",
          username: data.result?.username || "",
          firstName: data.result?.first_name || ""
        }
      });
      return;
    }
    sendJson(res, 400, { error: "当前仅支持测试 telegram" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "连通性测试失败" });
  }
}

async function handleUploadAttachment(req, res) {
  try {
    const payload = await readJsonBody(req, { maxBytes: attachmentUploadMaxBytes });
    const rawProjectPath = String(payload.projectPath || "").trim();
    const name = String(payload.name || "").trim() || "untitled.txt";
    const content = String(payload.content || "");

    if (!rawProjectPath) {
      sendJson(res, 400, { error: "缺少 projectPath" });
      return;
    }
    if (!content.trim()) {
      sendJson(res, 400, { error: "文件内容为空" });
      return;
    }

    const projectsConfig = loadProjectsConfig();
    const projectPath = resolveProjectPathForRequest(rawProjectPath, projectsConfig);

    const { attachmentDir, indexPath } = ensureAttachmentDirs(projectPath);
    const id = buildAttachmentStorageId({ name, content });
    const safeName = sanitizeAttachmentFileName(name);
    const filePath = path.join(attachmentDir, `${id}-${safeName}`);

    fs.writeFileSync(filePath, content, "utf8");

    const entry = {
      id,
      name,
      fileName: path.basename(filePath),
      charCount: content.length,
      createdAt: new Date().toISOString()
    };
    upsertAttachmentIndex(indexPath, entry);

    sendJson(res, 200, {
      ok: true,
      attachment: entry
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "附件上传失败" });
  }
}

async function handleGetFileManagerInfo(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    sendJson(res, 200, {
      ok: true,
      root: fileManagerRoot,
      maxUploadBytes: fileManagerUploadMaxBytes,
      chunkUpload: {
        enabled: true,
        chunkBytes: fileManagerChunkUploadChunkBytes,
        sessionTtlMs: fileManagerChunkUploadSessionTtlMs
      },
      user: auth
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取文件管理信息失败" });
  }
}

async function handleListFileManagerItems(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const { query } = parseUrl(req.url || "/api/files/list");
    const searchText = String(query.q || "").trim();
    const category = normalizeFileManagerCategory(String(query.category || ""));
    const ext = normalizeFileExtension(String(query.ext || ""));
    const folder = normalizeFileManagerFolderPrefix(String(query.folder || ""));
    const limit = clampInt(query.limit, fileManagerListMaxItems, 50, fileManagerListMaxItems);
    const result = listFileManagerItems({ searchText, category, ext, folder, limit });
    sendJson(res, 200, {
      ok: true,
      ...result,
      folder,
      root: fileManagerRoot,
      user: auth
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "读取文件列表失败" });
  }
}

async function handleGetFileManagerTree(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const { query } = parseUrl(req.url || "/api/files/tree");
    const maxNodes = clampInt(query.maxNodes, 4000, 200, 30000);
    const tree = buildFileManagerTree({ maxNodes });
    sendJson(res, 200, {
      ok: true,
      root: fileManagerRoot,
      tree,
      user: auth
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "读取文件夹树失败" });
  }
}

async function handleUploadFileManagerItem(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const { query } = parseUrl(req.url || "/api/files/upload");
    const originalName = String(query.name || query.filename || "").trim();
    if (!originalName) {
      throw createHttpError(400, "缺少文件名参数（name）");
    }

    const safeName = sanitizeUploadFileName(originalName);
    const ext = extractNormalizedExtension(safeName);
    const category = classifyFileByExtension(ext);
    const targetDir = buildFileManagerStorageDir(category, safeName, new Date());
    fs.mkdirSync(targetDir, { recursive: true });

    const targetPath = buildUniqueFilePath(targetDir, safeName);
    const bytesWritten = await streamRequestBodyToFile(req, targetPath, {
      maxBytes: fileManagerUploadMaxBytes
    });
    if (!bytesWritten) {
      try {
        fs.unlinkSync(targetPath);
      } catch (_error) {
        // ignore cleanup error
      }
      throw createHttpError(400, "文件内容为空");
    }
    const stat = fs.statSync(targetPath);
    const relativePath = toFileManagerRelativePath(targetPath);
    upsertFileManagerIndexEntryFromStat(relativePath, stat);

    sendJson(res, 200, {
      ok: true,
      file: {
        path: relativePath,
        name: path.basename(targetPath),
        category,
        ext,
        mime: getMimeTypeByFileName(path.basename(targetPath)),
        previewType: getFileManagerPreviewType(path.basename(targetPath)),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        downloadUrl: buildFileManagerDownloadUrl(relativePath),
        shareUrl: buildFileManagerPublicShareUrl(relativePath)
      },
      user: auth
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "上传文件失败" });
  }
}

async function handleStartFileManagerChunkUpload(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    cleanupStaleFileManagerChunkUploads();
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const originalName = String(payload.name || payload.filename || "").trim();
    if (!originalName) {
      throw createHttpError(400, "缺少文件名参数（name）");
    }
    const totalSize = Math.max(0, Number(payload.size || 0));
    if (!Number.isFinite(totalSize) || totalSize <= 0) {
      throw createHttpError(400, "文件大小无效");
    }
    const chunkBytes = clampInt(
      Number(payload.chunkBytes || fileManagerChunkUploadChunkBytes),
      fileManagerChunkUploadChunkBytes,
      256 * 1024,
      fileManagerChunkUploadChunkBytes
    );
    const totalChunks = Math.max(1, Math.ceil(totalSize / chunkBytes));
    const safeName = sanitizeUploadFileName(originalName);
    const ext = extractNormalizedExtension(safeName);
    const category = classifyFileByExtension(ext);
    const uploadId = `fu-${Date.now()}-${randomBase64Url(8)}`;
    const sessionDir = getFileManagerChunkUploadSessionDir(uploadId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const manifest = {
      id: uploadId,
      originalName,
      safeName,
      ext,
      category,
      totalSize,
      chunkBytes,
      totalChunks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      receivedChunks: {}
    };
    saveFileManagerChunkUploadManifest(uploadId, manifest);

    sendJson(res, 200, {
      ok: true,
      uploadId,
      chunkBytes,
      totalChunks,
      totalSize
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "初始化分片上传失败" });
  }
}

async function handleUploadFileManagerChunkPart(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const { query } = parseUrl(req.url || "/api/files/upload/chunk/part");
    const uploadId = String(query.uploadId || "").trim();
    const chunkIndex = Number(query.chunkIndex);
    if (!uploadId) {
      throw createHttpError(400, "缺少 uploadId");
    }
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw createHttpError(400, "chunkIndex 非法");
    }

    const manifest = loadFileManagerChunkUploadManifest(uploadId);
    if (!manifest) {
      throw createHttpError(404, "上传会话不存在或已过期");
    }
    if (chunkIndex >= manifest.totalChunks) {
      throw createHttpError(400, "chunkIndex 超出范围");
    }

    const expectedChunkSize = getExpectedChunkSize(manifest, chunkIndex);
    if (expectedChunkSize <= 0) {
      throw createHttpError(400, "分片大小无效");
    }
    const partPath = getFileManagerChunkUploadPartPath(uploadId, chunkIndex);
    if (fs.existsSync(partPath)) {
      fs.unlinkSync(partPath);
    }
    const bytesWritten = await streamRequestBodyToFile(req, partPath, {
      maxBytes: expectedChunkSize + 16 * 1024
    });
    if (bytesWritten !== expectedChunkSize) {
      try {
        fs.unlinkSync(partPath);
      } catch (_error) {
        // ignore cleanup error
      }
      throw createHttpError(400, `分片大小不匹配，期望 ${expectedChunkSize} 字节，实际 ${bytesWritten} 字节`);
    }

    manifest.receivedChunks = manifest.receivedChunks && typeof manifest.receivedChunks === "object"
      ? manifest.receivedChunks
      : {};
    manifest.receivedChunks[String(chunkIndex)] = bytesWritten;
    manifest.updatedAt = new Date().toISOString();
    saveFileManagerChunkUploadManifest(uploadId, manifest);

    sendJson(res, 200, {
      ok: true,
      uploadId,
      chunkIndex,
      bytesWritten,
      uploadedBytes: getFileManagerChunkUploadedBytes(manifest),
      totalSize: manifest.totalSize
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "上传分片失败" });
  }
}

async function handleFinishFileManagerChunkUpload(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const uploadId = String(payload.uploadId || "").trim();
    if (!uploadId) {
      throw createHttpError(400, "缺少 uploadId");
    }
    const manifest = loadFileManagerChunkUploadManifest(uploadId);
    if (!manifest) {
      throw createHttpError(404, "上传会话不存在或已过期");
    }

    for (let index = 0; index < manifest.totalChunks; index += 1) {
      const expected = getExpectedChunkSize(manifest, index);
      const got = Number(manifest.receivedChunks?.[String(index)] || 0);
      if (got !== expected) {
        throw createHttpError(400, `仍有分片未完成：第 ${index + 1}/${manifest.totalChunks} 片`);
      }
      const partPath = getFileManagerChunkUploadPartPath(uploadId, index);
      if (!fs.existsSync(partPath)) {
        throw createHttpError(400, `分片文件缺失：第 ${index + 1}/${manifest.totalChunks} 片`);
      }
    }

    const targetDir = buildFileManagerStorageDir(manifest.category, manifest.safeName, new Date());
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = buildUniqueFilePath(targetDir, manifest.safeName);
    const fd = fs.openSync(targetPath, "wx");
    try {
      for (let index = 0; index < manifest.totalChunks; index += 1) {
        const partPath = getFileManagerChunkUploadPartPath(uploadId, index);
        const data = fs.readFileSync(partPath);
        if (data.length) {
          fs.writeSync(fd, data);
        }
      }
    } catch (error) {
      try {
        fs.closeSync(fd);
      } catch (_error) {
        // ignore
      }
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      } catch (_error) {
        // ignore
      }
      throw error;
    }
    fs.closeSync(fd);
    const stat = fs.statSync(targetPath);
    if (!stat.size) {
      try {
        fs.unlinkSync(targetPath);
      } catch (_error) {
        // ignore
      }
      throw createHttpError(400, "文件内容为空");
    }

    const relativePath = toFileManagerRelativePath(targetPath);
    upsertFileManagerIndexEntryFromStat(relativePath, stat);
    removeFileManagerChunkUploadSession(uploadId);

    sendJson(res, 200, {
      ok: true,
      file: {
        path: relativePath,
        name: path.basename(targetPath),
        category: manifest.category,
        ext: manifest.ext,
        mime: getMimeTypeByFileName(path.basename(targetPath)),
        previewType: getFileManagerPreviewType(path.basename(targetPath)),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        downloadUrl: buildFileManagerDownloadUrl(relativePath),
        shareUrl: buildFileManagerPublicShareUrl(relativePath)
      },
      user: auth
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "合并分片失败" });
  }
}

async function handlePreviewFileManagerItem(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    const { query } = parseUrl(req.url || "/api/files/preview");
    const relativePath = String(query.path || "").trim();
    if (!relativePath) {
      throw createHttpError(400, "缺少 path 参数");
    }
    const filePath = resolveFileManagerPath(relativePath, { mustExist: true, allowDirectory: false });
    const fileName = path.basename(filePath);
    const previewType = getFileManagerPreviewType(fileName);
    const mime = getMimeTypeByFileName(fileName);

    if (previewType === "image" || previewType === "pdf") {
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
        "Content-Disposition": "inline"
      });
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: "读取预览文件失败" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
      return;
    }

    if (previewType === "text") {
      const textPreview = readTextPreviewFromFile(filePath, {
        maxBytes: fileManagerPreviewTextMaxBytes,
        maxChars: fileManagerPreviewTextMaxChars
      });
      sendJson(res, 200, {
        ok: true,
        type: "text",
        path: relativePath,
        name: fileName,
        mime,
        content: textPreview.content,
        truncated: textPreview.truncated,
        totalBytes: textPreview.totalBytes,
        readBytes: textPreview.readBytes,
        maxBytes: fileManagerPreviewTextMaxBytes,
        maxChars: fileManagerPreviewTextMaxChars
      });
      return;
    }

    throw createHttpError(415, "该文件类型暂不支持在线预览");
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "文件预览失败" });
  }
}

async function handleDownloadFileManagerItem(req, res) {
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const { query } = parseUrl(req.url || "/api/files/download");
    const shareToken = String(query.share || "").trim();
    let relativePath = String(query.path || "").trim();

    if (shareToken) {
      const tokenResult = consumeFileManagerShareLink(shareToken);
      if (!tokenResult.ok) {
        throw createHttpError(tokenResult.statusCode || 403, tokenResult.message || "分享链接无效");
      }
      relativePath = tokenResult.path;
    } else {
      if (!relativePath) {
        throw createHttpError(400, "缺少 path 参数");
      }
      const hasShareSignature = !!String(query.sig || "").trim() || !!String(query.expires || "").trim();
      if (hasShareSignature) {
        const verification = verifyFileManagerDownloadSignature(relativePath, query);
        if (!verification.ok) {
          throw createHttpError(403, verification.message || "分享链接无效");
        }
      } else {
        const auth = ensureFileManagerAuth(req, res, { api: true });
        if (!auth) return;
      }
    }

    const filePath = resolveFileManagerPath(relativePath, { mustExist: true, allowDirectory: false });
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const mime = getMimeTypeByFileName(fileName);
    const totalSize = Math.max(0, Number(stat.size || 0));
    const rangeHeader = String(req?.headers?.range || "").trim();
    const range = rangeHeader ? parseHttpByteRange(rangeHeader, totalSize) : null;
    if (rangeHeader && !range) {
      res.writeHead(416, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${totalSize}`
      });
      res.end(JSON.stringify({ error: "Range 无效或超出文件大小" }));
      return;
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : Math.max(0, totalSize - 1);
    const contentLength = totalSize > 0 ? end - start + 1 : 0;
    const headers = {
      "Content-Type": mime,
      "Content-Length": contentLength,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes"
    };
    if (range) {
      headers["Content-Range"] = `bytes ${start}-${end}/${totalSize}`;
    }
    res.writeHead(range ? 206 : 200, headers);

    if (totalSize <= 0) {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("error", () => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "读取文件失败" });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "下载文件失败" });
  }
}

async function handleDeleteFileManagerItems(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const payload = await readJsonBody(req, { maxBytes: 512 * 1024 });
    const pathsInput = Array.isArray(payload.paths)
      ? payload.paths
      : payload.path
        ? [payload.path]
        : [];
    const targets = Array.from(new Set(pathsInput.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 300);
    if (!targets.length) {
      throw createHttpError(400, "请至少传入一个文件 path");
    }

    const deleted = [];
    const failed = [];

    targets.forEach((relativePath) => {
      try {
        const filePath = resolveFileManagerPath(relativePath, { mustExist: true, allowDirectory: false });
        fs.unlinkSync(filePath);
        removeFileManagerIndexEntry(relativePath);
        deleted.push(relativePath);
      } catch (error) {
        failed.push({
          path: relativePath,
          error: error?.message || "删除失败"
        });
      }
    });

    sendJson(res, 200, {
      ok: true,
      deleted,
      failed,
      user: auth
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "删除文件失败" });
  }
}

async function handleRenameFileManagerItem(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const oldPath = String(payload.path || "").trim();
    const newNameRaw = String(payload.newName || "").trim();
    if (!oldPath || !newNameRaw) {
      throw createHttpError(400, "缺少 path 或 newName");
    }

    const sourcePath = resolveFileManagerPath(oldPath, { mustExist: true, allowDirectory: false });
    const oldRelativePath = toFileManagerRelativePath(sourcePath);
    const newName = sanitizeUploadFileName(newNameRaw);
    const ext = extractNormalizedExtension(newName);
    const category = classifyFileByExtension(ext);
    const sourceCategory = classifyFileByExtension(extractNormalizedExtension(path.basename(sourcePath)));
    const sourceDir = path.dirname(sourcePath);
    const keepSourceDir = sourceCategory === category;
    const targetDir = keepSourceDir
      ? sourceDir
      : buildFileManagerStorageDir(category, newName, new Date());
    fs.mkdirSync(targetDir, { recursive: true });

    const targetPath = buildUniqueFilePath(targetDir, newName);
    fs.renameSync(sourcePath, targetPath);
    const stat = fs.statSync(targetPath);
    const relativePath = toFileManagerRelativePath(targetPath);
    removeFileManagerIndexEntry(oldRelativePath);
    upsertFileManagerIndexEntryFromStat(relativePath, stat);

    sendJson(res, 200, {
      ok: true,
      file: {
        path: relativePath,
        name: path.basename(targetPath),
        category,
        ext,
        mime: getMimeTypeByFileName(path.basename(targetPath)),
        previewType: getFileManagerPreviewType(path.basename(targetPath)),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        downloadUrl: buildFileManagerDownloadUrl(relativePath),
        shareUrl: buildFileManagerPublicShareUrl(relativePath)
      },
      user: auth
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "重命名文件失败" });
  }
}

async function handleCreateFileManagerFolder(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const parent = String(payload.parent || "").trim();
    const name = sanitizeFolderSegment(String(payload.name || "").trim());
    if (!name) {
      throw createHttpError(400, "文件夹名称不能为空");
    }

    const parentPath = parent ? resolveFileManagerPath(parent, { mustExist: true, allowDirectory: true }) : fileManagerRoot;
    const folderPath = path.join(parentPath, name);
    if (!isPathInside(folderPath, fileManagerRoot)) {
      throw createHttpError(400, "目标路径不在共享目录内");
    }
    fs.mkdirSync(folderPath, { recursive: true });

    sendJson(res, 200, {
      ok: true,
      folder: {
        path: toFileManagerRelativePath(folderPath),
        name
      },
      user: auth
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "创建文件夹失败" });
  }
}

async function handleCreateFileManagerShareLink(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    ensureFileManagerIndexReady();
    const payload = await readJsonBody(req, { maxBytes: 64 * 1024 });
    const relativePathRaw = String(payload.path || "").trim();
    if (!relativePathRaw) {
      throw createHttpError(400, "缺少 path 参数");
    }
    const filePath = resolveFileManagerPath(relativePathRaw, { mustExist: true, allowDirectory: false });
    const relativePath = toFileManagerRelativePath(filePath);
    const share = createFileManagerShareLink(relativePath, {
      mode: payload.mode,
      ttlSec: payload.ttlSec,
      createdBy: auth.email || auth.role || "unknown"
    });
    sendJson(res, 200, {
      ok: true,
      share,
      user: auth
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "创建分享链接失败" });
  }
}

async function handleZipFileManagerItems(req, res) {
  const auth = ensureFileManagerAuth(req, res, { api: true });
  if (!auth) return;
  try {
    ensureFileManagerRoot();
    const payload = await readJsonBody(req, { maxBytes: 2 * 1024 * 1024 });
    const name = sanitizeArchiveName(String(payload.name || "").trim() || `share-${Date.now()}`);
    const pathsInput = Array.isArray(payload.paths) ? payload.paths : [];
    const relativePaths = Array.from(new Set(pathsInput.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 500);
    if (!relativePaths.length) {
      throw createHttpError(400, "请选择至少一个文件进行打包");
    }

    const zipTargets = relativePaths.map((relativePath) => {
      const filePath = resolveFileManagerPath(relativePath, { mustExist: true, allowDirectory: false });
      return `./${toFileManagerRelativePath(filePath)}`;
    });

    const tempDir = ensureFileManagerTempDir();
    const zipPath = path.join(tempDir, `${Date.now()}-${randomBase64Url(8)}.zip`);
    const zipResult = spawnSync("zip", ["-q", "-r", zipPath, "--", ...zipTargets], {
      cwd: fileManagerRoot,
      encoding: "utf8"
    });
    if (zipResult.status !== 0 || !fs.existsSync(zipPath)) {
      const detail = String(zipResult.stderr || zipResult.stdout || "").trim();
      throw createHttpError(500, detail || "zip 打包失败");
    }

    const stat = fs.statSync(zipPath);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.zip`)}`,
      "Cache-Control": "no-store"
    });
    const stream = fs.createReadStream(zipPath);
    stream.on("close", () => {
      try {
        fs.unlinkSync(zipPath);
      } catch (_error) {
        // ignore cleanup error
      }
    });
    stream.on("error", () => {
      try {
        fs.unlinkSync(zipPath);
      } catch (_error) {
        // ignore cleanup error
      }
      if (!res.headersSent) {
        sendJson(res, 500, { error: "读取打包文件失败" });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, statusCode, { error: error.message || "打包下载失败" });
  }
}

function ensureFileManagerRoot() {
  fs.mkdirSync(fileManagerRoot, { recursive: true });
  ensureFileManagerTempDir();
}

function ensureFileManagerTempDir() {
  const tempDir = path.join(fileManagerRoot, fileManagerMetaDirName, fileManagerTempDirName);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ensureFileManagerChunkUploadRoot() {
  const dir = path.join(ensureFileManagerTempDir(), fileManagerChunkUploadDirName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFileManagerChunkUploadSessionDir(uploadId) {
  const safeId = String(uploadId || "").trim();
  if (!/^fu-[A-Za-z0-9_-]{8,80}$/.test(safeId)) {
    throw createHttpError(400, "uploadId 非法");
  }
  return path.join(ensureFileManagerChunkUploadRoot(), safeId);
}

function getFileManagerChunkUploadManifestPath(uploadId) {
  return path.join(getFileManagerChunkUploadSessionDir(uploadId), "manifest.json");
}

function getFileManagerChunkUploadPartPath(uploadId, chunkIndex) {
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0) {
    throw createHttpError(400, "chunkIndex 非法");
  }
  return path.join(getFileManagerChunkUploadSessionDir(uploadId), `part-${index}.bin`);
}

function saveFileManagerChunkUploadManifest(uploadId, manifestInput) {
  const manifestPath = getFileManagerChunkUploadManifestPath(uploadId);
  const manifest = normalizeFileManagerChunkUploadManifest(manifestInput);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function loadFileManagerChunkUploadManifest(uploadId) {
  try {
    const manifestPath = getFileManagerChunkUploadManifestPath(uploadId);
    if (!fs.existsSync(manifestPath)) return null;
    const raw = loadJsonFileSafe(manifestPath);
    const manifest = normalizeFileManagerChunkUploadManifest(raw);
    if (manifest.id !== String(uploadId || "").trim()) return null;
    const updatedAtMs = Date.parse(manifest.updatedAt || manifest.createdAt || "");
    if (!Number.isFinite(updatedAtMs) || updatedAtMs + fileManagerChunkUploadSessionTtlMs < Date.now()) {
      removeFileManagerChunkUploadSession(uploadId);
      return null;
    }
    return manifest;
  } catch (_error) {
    return null;
  }
}

function normalizeFileManagerChunkUploadManifest(input) {
  const source = input && typeof input === "object" ? input : {};
  const id = String(source.id || "").trim();
  const safeName = sanitizeUploadFileName(String(source.safeName || source.originalName || "upload.bin"));
  const ext = extractNormalizedExtension(safeName);
  const category = classifyFileByExtension(ext);
  const totalSize = Math.max(0, Number(source.totalSize || 0));
  const chunkBytes = clampInt(
    Number(source.chunkBytes || fileManagerChunkUploadChunkBytes),
    fileManagerChunkUploadChunkBytes,
    256 * 1024,
    fileManagerChunkUploadChunkBytes
  );
  const totalChunks = Math.max(1, Math.ceil(totalSize / chunkBytes));
  const receivedChunks = {};
  if (source.receivedChunks && typeof source.receivedChunks === "object") {
    Object.entries(source.receivedChunks).forEach(([key, value]) => {
      const index = Number(key);
      const size = Number(value || 0);
      if (!Number.isInteger(index) || index < 0 || index >= totalChunks) return;
      if (!Number.isFinite(size) || size <= 0) return;
      receivedChunks[String(index)] = size;
    });
  }
  return {
    id,
    originalName: String(source.originalName || safeName).trim(),
    safeName,
    ext,
    category,
    totalSize,
    chunkBytes,
    totalChunks,
    createdAt: String(source.createdAt || "").trim() || new Date().toISOString(),
    updatedAt: String(source.updatedAt || "").trim() || new Date().toISOString(),
    receivedChunks
  };
}

function getExpectedChunkSize(manifest, chunkIndex) {
  const index = Number(chunkIndex);
  const totalSize = Math.max(0, Number(manifest?.totalSize || 0));
  const chunkBytes = Math.max(1, Number(manifest?.chunkBytes || fileManagerChunkUploadChunkBytes));
  const totalChunks = Math.max(1, Number(manifest?.totalChunks || 1));
  if (!Number.isInteger(index) || index < 0 || index >= totalChunks) return 0;
  if (index === totalChunks - 1) {
    const used = chunkBytes * (totalChunks - 1);
    return Math.max(0, totalSize - used);
  }
  return Math.min(chunkBytes, totalSize);
}

function getFileManagerChunkUploadedBytes(manifest) {
  const received = manifest?.receivedChunks && typeof manifest.receivedChunks === "object"
    ? manifest.receivedChunks
    : {};
  return Object.values(received).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function removeFileManagerChunkUploadSession(uploadId) {
  try {
    const dir = getFileManagerChunkUploadSessionDir(uploadId);
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_error) {
    // ignore
  }
}

function cleanupStaleFileManagerChunkUploads() {
  try {
    const rootDir = ensureFileManagerChunkUploadRoot();
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!entry.isDirectory()) return;
      const sessionId = String(entry.name || "").trim();
      if (!/^fu-[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
        return;
      }
      const manifestPath = path.join(rootDir, sessionId, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        fs.rmSync(path.join(rootDir, sessionId), { recursive: true, force: true });
        return;
      }
      const raw = loadJsonFileSafe(manifestPath);
      const updatedAtMs = Date.parse(String(raw?.updatedAt || raw?.createdAt || "").trim());
      if (!Number.isFinite(updatedAtMs) || updatedAtMs + fileManagerChunkUploadSessionTtlMs < Date.now()) {
        fs.rmSync(path.join(rootDir, sessionId), { recursive: true, force: true });
      }
    });
  } catch (_error) {
    // ignore cleanup errors
  }
}

function ensureFileManagerIndexReady() {
  if (fileManagerIndexDb) return fileManagerIndexDb;
  ensureFileManagerRoot();
  const dbPath = path.join(fileManagerRoot, fileManagerMetaDirName, fileManagerDbFileName);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA temp_store = MEMORY;");
  db.exec(
    [
      `CREATE TABLE IF NOT EXISTS ${fileManagerIndexMetaTable} (`,
      `  key TEXT PRIMARY KEY,`,
      `  value TEXT NOT NULL`,
      `);`,
      `CREATE TABLE IF NOT EXISTS ${fileManagerIndexTable} (`,
      `  rel_path TEXT PRIMARY KEY,`,
      `  name TEXT NOT NULL,`,
      `  ext TEXT NOT NULL,`,
      `  category TEXT NOT NULL,`,
      `  size INTEGER NOT NULL,`,
      `  mtime_ms INTEGER NOT NULL,`,
      `  search_text TEXT NOT NULL DEFAULT ''`,
      `);`,
      `CREATE TABLE IF NOT EXISTS ${fileManagerShareTable} (`,
      `  token TEXT PRIMARY KEY,`,
      `  rel_path TEXT NOT NULL,`,
      `  mode TEXT NOT NULL,`,
      `  expires_at INTEGER NOT NULL DEFAULT 0,`,
      `  max_uses INTEGER NOT NULL DEFAULT 0,`,
      `  used_count INTEGER NOT NULL DEFAULT 0,`,
      `  created_at INTEGER NOT NULL,`,
      `  last_used_at INTEGER NOT NULL DEFAULT 0,`,
      `  created_by TEXT NOT NULL DEFAULT ''`,
      `);`,
      `CREATE INDEX IF NOT EXISTS idx_${fileManagerIndexTable}_mtime ON ${fileManagerIndexTable}(mtime_ms DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_${fileManagerIndexTable}_category ON ${fileManagerIndexTable}(category);`,
      `CREATE INDEX IF NOT EXISTS idx_${fileManagerIndexTable}_ext ON ${fileManagerIndexTable}(ext);`,
      `CREATE INDEX IF NOT EXISTS idx_${fileManagerIndexTable}_name ON ${fileManagerIndexTable}(name);`,
      `CREATE INDEX IF NOT EXISTS idx_${fileManagerShareTable}_path ON ${fileManagerShareTable}(rel_path);`,
      `CREATE INDEX IF NOT EXISTS idx_${fileManagerShareTable}_expires ON ${fileManagerShareTable}(expires_at);`
    ].join("\n")
  );

  const columns = db.prepare(`PRAGMA table_info(${fileManagerIndexTable})`).all();
  const hasSearchText = columns.some((item) => String(item?.name || "") === "search_text");
  if (!hasSearchText) {
    db.exec(`ALTER TABLE ${fileManagerIndexTable} ADD COLUMN search_text TEXT NOT NULL DEFAULT '';`);
  }
  db.exec(
    `UPDATE ${fileManagerIndexTable}
     SET category = CASE
       WHEN LOWER(category) = 'file.noext' THEN '${fileManagerNoExtLabel}'
       WHEN LOWER(category) LIKE 'file.%' THEN SUBSTR(LOWER(category), 6)
       ELSE LOWER(category)
     END;`
  );
  db.exec(
    `UPDATE ${fileManagerIndexTable}
     SET search_text = LOWER(COALESCE(name, '') || ' ' || COALESCE(rel_path, '') || ' ' || COALESCE(category, '') || ' ' || COALESCE(ext, ''))
     ;`
  );
  const flattenResult = flattenFileManagerStorageLayout(db);
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(`DELETE FROM ${fileManagerShareTable} WHERE (expires_at > 0 AND expires_at < ?) OR (max_uses > 0 AND used_count >= max_uses)`).run(nowSec);

  fileManagerIndexDb = db;
  const indexedAt = db.prepare(`SELECT value FROM ${fileManagerIndexMetaTable} WHERE key = ?`).get(fileManagerIndexBootstrapKey);
  if (!indexedAt?.value || Number(flattenResult?.movedCount || 0) > 0) {
    rebuildFileManagerIndexFromDisk(db);
  }
  return db;
}

function rebuildFileManagerIndexFromDisk(dbInstance = null) {
  const db = dbInstance || ensureFileManagerIndexReady();
  const insertStmt = db.prepare(
    [
      `INSERT INTO ${fileManagerIndexTable}`,
      `(rel_path, name, ext, category, size, mtime_ms, search_text)`,
      `VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `ON CONFLICT(rel_path) DO UPDATE SET`,
      `name = excluded.name,`,
      `ext = excluded.ext,`,
      `category = excluded.category,`,
      `size = excluded.size,`,
      `mtime_ms = excluded.mtime_ms,`,
      `search_text = excluded.search_text`
    ].join(" ")
  );
  const upsertMetaStmt = db.prepare(
    [
      `INSERT INTO ${fileManagerIndexMetaTable} (key, value)`,
      `VALUES (?, ?)`,
      `ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ].join(" ")
  );

  const stack = [fileManagerRoot];
  db.exec(`BEGIN IMMEDIATE; DELETE FROM ${fileManagerIndexTable};`);
  try {
    while (stack.length) {
      const currentDir = stack.pop();
      if (!currentDir) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (_error) {
        continue;
      }
      entries.forEach((entry) => {
        if (entry.name === fileManagerMetaDirName) return;
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          return;
        }
        if (!entry.isFile() || entry.isSymbolicLink()) return;
        let stat = null;
        try {
          stat = fs.statSync(absolutePath);
        } catch (_error) {
          return;
        }
        if (!stat?.isFile()) return;
        const relativePath = normalizeFileManagerIndexPath(toFileManagerRelativePath(absolutePath));
        if (!relativePath) return;
        const name = path.basename(relativePath);
        const ext = extractNormalizedExtension(name);
        const category = classifyFileByExtension(ext);
        const mtimeMs = Math.max(0, Math.round(Number(stat.mtimeMs || 0)));
        const searchText = buildFileManagerSearchText({
          name,
          path: relativePath,
          ext,
          category
        });
        insertStmt.run(relativePath, name, ext, category, Number(stat.size || 0), mtimeMs, searchText);
      });
    }
    upsertMetaStmt.run(fileManagerIndexBootstrapKey, new Date().toISOString());
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch (_rollbackError) {
      // ignore rollback error
    }
    throw error;
  }
}

function buildFileManagerSearchText(item) {
  const name = String(item?.name || "").toLowerCase();
  const relativePath = String(item?.path || "").toLowerCase();
  const category = String(item?.category || "").toLowerCase();
  const ext = String(item?.ext || "").toLowerCase();
  return `${name} ${relativePath} ${category} ${ext}`.trim();
}

function normalizeFileManagerIndexPath(relativePath) {
  const value = String(relativePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!value) return "";
  const segments = value.split("/").filter(Boolean);
  if (!segments.length) return "";
  if (segments.some((segment) => segment === "." || segment === ".." || segment === fileManagerMetaDirName)) {
    return "";
  }
  return segments.join("/");
}

function upsertFileManagerIndexEntryFromStat(relativePath, statInput = null) {
  const db = ensureFileManagerIndexReady();
  const normalizedPath = normalizeFileManagerIndexPath(relativePath);
  if (!normalizedPath) {
    throw createHttpError(400, "文件路径非法，无法写入索引");
  }
  const absolutePath = path.resolve(fileManagerRoot, normalizedPath);
  if (!isPathInside(absolutePath, fileManagerRoot)) {
    throw createHttpError(400, "文件路径超出共享目录，无法写入索引");
  }
  const stat = statInput && typeof statInput === "object" ? statInput : fs.statSync(absolutePath);
  if (!stat?.isFile?.()) {
    throw createHttpError(400, "目标路径不是文件，无法写入索引");
  }

  const name = path.basename(normalizedPath);
  const ext = extractNormalizedExtension(name);
  const category = classifyFileByExtension(ext);
  const mtimeMs = Math.max(0, Math.round(Number(stat.mtimeMs || 0)));
  const searchText = buildFileManagerSearchText({
    name,
    path: normalizedPath,
    ext,
    category
  });

  db.prepare(
    [
      `INSERT INTO ${fileManagerIndexTable}`,
      `(rel_path, name, ext, category, size, mtime_ms, search_text)`,
      `VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `ON CONFLICT(rel_path) DO UPDATE SET`,
      `name = excluded.name,`,
      `ext = excluded.ext,`,
      `category = excluded.category,`,
      `size = excluded.size,`,
      `mtime_ms = excluded.mtime_ms,`,
      `search_text = excluded.search_text`
    ].join(" ")
  ).run(normalizedPath, name, ext, category, Number(stat.size || 0), mtimeMs, searchText);
}

function removeFileManagerIndexEntry(relativePath) {
  const normalizedPath = normalizeFileManagerIndexPath(relativePath);
  if (!normalizedPath) return;
  const db = ensureFileManagerIndexReady();
  db.prepare(`DELETE FROM ${fileManagerIndexTable} WHERE rel_path = ?`).run(normalizedPath);
}

function buildFileManagerStorageDir(categoryInput, fileName, when = new Date()) {
  const fallbackCategory = classifyFileByExtension(extractNormalizedExtension(fileName));
  const category = normalizeFileManagerCategory(categoryInput) || fallbackCategory;
  return path.join(fileManagerRoot, category);
}

function getDesiredFileManagerRelativePath(relativePath) {
  const normalizedPath = normalizeFileManagerIndexPath(relativePath);
  if (!normalizedPath) return "";
  const fileName = path.basename(normalizedPath);
  const category = classifyFileByExtension(extractNormalizedExtension(fileName));
  return normalizeFileManagerIndexPath(`${category}/${fileName}`);
}

function flattenFileManagerStorageLayout(db) {
  const stack = [fileManagerRoot];
  const movedEntries = [];
  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    entries.forEach((entry) => {
      if (entry.name === fileManagerMetaDirName) return;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        return;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) return;
      const relativePath = normalizeFileManagerIndexPath(toFileManagerRelativePath(absolutePath));
      if (!relativePath) return;
      const desiredRelativePath = getDesiredFileManagerRelativePath(relativePath);
      if (!desiredRelativePath || desiredRelativePath === relativePath) return;
      const targetDir = path.join(fileManagerRoot, path.dirname(desiredRelativePath));
      fs.mkdirSync(targetDir, { recursive: true });
      const targetPath = buildUniqueFilePath(targetDir, path.basename(desiredRelativePath));
      if (targetPath === absolutePath) return;
      fs.renameSync(absolutePath, targetPath);
      movedEntries.push({
        oldPath: relativePath,
        newPath: normalizeFileManagerIndexPath(toFileManagerRelativePath(targetPath))
      });
    });
  }
  if (!movedEntries.length) return { movedCount: 0 };

  const updateShareStmt = db.prepare(`UPDATE ${fileManagerShareTable} SET rel_path = ? WHERE rel_path = ?`);
  db.exec("BEGIN IMMEDIATE;");
  try {
    movedEntries.forEach((entry) => {
      updateShareStmt.run(entry.newPath, entry.oldPath);
    });
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch (_rollbackError) {
      // ignore rollback error
    }
    throw error;
  }

  cleanupEmptyFileManagerDirectories(fileManagerRoot);
  return { movedCount: movedEntries.length };
}

function cleanupEmptyFileManagerDirectories(currentDir) {
  if (!currentDir || currentDir === fileManagerRoot) {
    let rootEntries = [];
    try {
      rootEntries = fs.readdirSync(fileManagerRoot, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    rootEntries.forEach((entry) => {
      if (!entry.isDirectory() || entry.name === fileManagerMetaDirName) return;
      cleanupEmptyFileManagerDirectories(path.join(fileManagerRoot, entry.name));
    });
    return;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch (_error) {
    return;
  }

  entries.forEach((entry) => {
    if (!entry.isDirectory() || entry.name === fileManagerMetaDirName) return;
    cleanupEmptyFileManagerDirectories(path.join(currentDir, entry.name));
  });

  try {
    const remaining = fs.readdirSync(currentDir);
    if (!remaining.length) {
      fs.rmdirSync(currentDir);
    }
  } catch (_error) {
    // ignore cleanup error
  }
}

function escapeSqlLikePattern(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

function buildFileManagerListWhereSql(options = {}) {
  const whereParts = [];
  const whereParams = [];
  const categoryFilter = normalizeFileManagerCategory(options.categoryFilter || "");
  const extFilter = normalizeFileExtension(options.extFilter || "");
  const folderFilter = normalizeFileManagerFolderPrefix(options.folderFilter || "");
  const searchText = String(options.searchText || "").trim().toLowerCase();

  if (categoryFilter) {
    whereParts.push("category = ?");
    whereParams.push(categoryFilter);
  }
  if (extFilter) {
    whereParts.push("ext = ?");
    whereParams.push(extFilter);
  }
  if (folderFilter) {
    whereParts.push("category = ?");
    whereParams.push(folderFilter);
  }
  if (searchText) {
    const tokens = Array.from(new Set(searchText.split(/\s+/).map((item) => item.trim()).filter(Boolean))).slice(0, 8);
    tokens.forEach((token) => {
      whereParts.push("search_text LIKE ? ESCAPE '\\'");
      whereParams.push(`%${escapeSqlLikePattern(token)}%`);
    });
  }

  return {
    whereSql: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    whereParams
  };
}

function listFileManagerItems(options = {}) {
  ensureFileManagerIndexReady();
  const db = fileManagerIndexDb;
  const searchText = String(options.searchText || "").trim().toLowerCase();
  const categoryFilter = normalizeFileManagerCategory(options.category || "");
  const extFilter = normalizeFileExtension(options.ext || "");
  const folderFilter = normalizeFileManagerFolderPrefix(options.folder || "");
  const limit = clampInt(options.limit, fileManagerListMaxItems, 50, fileManagerListMaxItems);
  const { whereSql, whereParams } = buildFileManagerListWhereSql({
    searchText,
    categoryFilter,
    extFilter,
    folderFilter
  });

  const listSql = [
    `SELECT rel_path AS path, name, ext, category, size, mtime_ms`,
    `FROM ${fileManagerIndexTable}`,
    whereSql,
    `ORDER BY mtime_ms DESC`,
    `LIMIT ?`
  ]
    .filter(Boolean)
    .join(" ");
  const listRows = db.prepare(listSql).all(...whereParams, limit);
  const items = listRows.map((row) => {
    const pathValue = String(row.path || "").trim();
    const nameValue = String(row.name || "").trim();
    const mtimeMs = Number(row.mtime_ms || 0);
    return {
      path: pathValue,
      name: nameValue,
      ext: String(row.ext || "").trim(),
      category: String(row.category || "").trim(),
      mime: getMimeTypeByFileName(nameValue),
      previewType: getFileManagerPreviewType(nameValue),
      size: Number(row.size || 0),
      mtime: mtimeMs > 0 ? new Date(mtimeMs).toISOString() : new Date(0).toISOString(),
      downloadUrl: buildFileManagerDownloadUrl(pathValue),
      shareUrl: buildFileManagerPublicShareUrl(pathValue)
    };
  });

  const summarySql = [
    `SELECT COUNT(*) AS matchedCount, COALESCE(SUM(size), 0) AS totalSize`,
    `FROM ${fileManagerIndexTable}`,
    whereSql
  ]
    .filter(Boolean)
    .join(" ");
  const summary = db.prepare(summarySql).get(...whereParams) || {};
  const matchedCount = Number(summary.matchedCount || 0);
  const matchedTotalSize = Number(summary.totalSize || 0);

  const categoriesSql = [
    `SELECT category AS name, COUNT(*) AS count`,
    `FROM ${fileManagerIndexTable}`,
    whereSql,
    `GROUP BY category`,
    `ORDER BY category`
  ]
    .filter(Boolean)
    .join(" ");
  const categoriesRows = db.prepare(categoriesSql).all(...whereParams);

  return {
    items,
    stats: {
      matchedCount,
      totalSize: matchedTotalSize,
      truncated: matchedCount > items.length,
      limit
    },
    categories: categoriesRows.map((row) => ({
      name: String(row.name || "").trim(),
      count: Number(row.count || 0)
    }))
  };
}

function normalizeFileManagerCategoryLabel(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === fileManagerNoExtLabel || raw === "file.noext") return fileManagerNoExtLabel;
  const value = raw.startsWith("file.") ? raw.slice(5) : raw;
  const ext = normalizeFileExtension(value);
  return ext || "";
}

function normalizeFileManagerCategory(input) {
  return normalizeFileManagerCategoryLabel(String(input || "").trim());
}

function normalizeFileExtension(input) {
  const value = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/[^a-z0-9+_-]/g, "");
  return value.slice(0, 20);
}

function normalizeFileManagerFolderPrefix(input) {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  if (/^file\.[a-z0-9+_-]+$/i.test(raw) || /^[a-z0-9+_-]+$/i.test(raw)) {
    return normalizeFileManagerCategoryLabel(raw);
  }
  const value = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!value) return "";
  const segments = value.split("/").filter(Boolean);
  if (!segments.length) return "";
  if (segments.length !== 1) {
    throw createHttpError(400, "文件夹筛选仅支持扩展名分类路径（如 txt、pdf）");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw createHttpError(400, "文件夹路径非法");
  }
  if (segments.some((segment) => segment === fileManagerMetaDirName)) {
    throw createHttpError(400, "不允许访问系统目录");
  }
  return normalizeFileManagerCategoryLabel(segments.join("/"));
}

function extractNormalizedExtension(fileName) {
  const ext = path.extname(String(fileName || "")).replace(/^\./, "").toLowerCase();
  return normalizeFileExtension(ext);
}

function classifyFileByExtension(ext) {
  const normalizedExt = normalizeFileExtension(ext);
  if (!normalizedExt) return fileManagerNoExtLabel;
  return normalizedExt;
}

function buildFileManagerTree(options = {}) {
  ensureFileManagerIndexReady();
  const db = fileManagerIndexDb;
  const maxNodes = clampInt(options.maxNodes, 4000, 200, 30000);
  const summary = db.prepare(`SELECT COUNT(*) AS fileCount, COALESCE(SUM(size), 0) AS totalSize FROM ${fileManagerIndexTable}`).get() || {};
  const distinctCountRow = db.prepare(`SELECT COUNT(DISTINCT category) AS categoryCount FROM ${fileManagerIndexTable}`).get() || {};
  const categoryRows = db
    .prepare(
      [
        `SELECT category, COUNT(*) AS fileCount, COALESCE(SUM(size), 0) AS totalSize`,
        `FROM ${fileManagerIndexTable}`,
        `GROUP BY category`,
        `ORDER BY category`,
        `LIMIT ?`
      ].join(" ")
    )
    .all(maxNodes);

  const children = categoryRows.map((row) => ({
    path: String(row.category || "").trim(),
    name: String(row.category || "").trim(),
    fileCount: Number(row.fileCount || 0),
    totalSize: Number(row.totalSize || 0),
    children: []
  }));

  const fileCount = Number(summary.fileCount || 0);
  const totalSize = Number(summary.totalSize || 0);
  const categoryCount = Number(distinctCountRow.categoryCount || 0);
  const truncated = categoryCount > children.length;
  return {
    path: "",
    name: "全部文件",
    fileCount,
    totalSize,
    children,
    stats: {
      directoryCount: children.length + 1,
      fileCount,
      totalSize,
      maxNodes,
      truncated
    }
  };
}

function sanitizeUploadFileName(fileName) {
  const raw = path.basename(String(fileName || "").trim().replace(/\\/g, "/"));
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .slice(0, 180);
  const normalized = cleaned || `file-${Date.now()}`;
  if (normalized === "." || normalized === "..") {
    return `file-${Date.now()}.bin`;
  }
  return normalized;
}

function sanitizeFolderSegment(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const normalized = raw
    .replace(/[/\\]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 80);
  if (!normalized || normalized === "." || normalized === "..") return "";
  return normalized;
}

function sanitizeArchiveName(input) {
  const value = String(input || "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return value || "files";
}

function normalizeRemoteCollisionStrategy(input) {
  const value = String(input || "").trim().toLowerCase();
  return value === "rename" ? "rename" : "error";
}

function sanitizeArchiveEntryDirName(input) {
  const value = String(input || "")
    .trim()
    .replace(/^~\//, "home/")
    .replace(/^\/+/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\.\.(\/|$)/g, "_/")
    .replace(/^\/+|\/+$/g, "");
  return value ? path.dirname(value) === "." ? value.replace(/\//g, "_") || "root" : path.dirname(value) : "root";
}

function buildUniqueFilePath(directoryPath, fileName) {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext) || "file";
  let counter = 0;
  while (counter < 10000) {
    const candidateName = counter === 0 ? `${baseName}${ext}` : `${baseName} (${counter})${ext}`;
    const candidatePath = path.join(directoryPath, candidateName);
    if (!fs.existsSync(candidatePath)) return candidatePath;
    counter += 1;
  }
  return path.join(directoryPath, `${baseName}-${Date.now()}${ext}`);
}

function toFileManagerRelativePath(absolutePath) {
  const relative = path.relative(fileManagerRoot, absolutePath);
  return relative.split(path.sep).join("/");
}

function resolveFileManagerPath(relativePath, options = {}) {
  const value = String(relativePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!value) {
    throw createHttpError(400, "路径不能为空");
  }
  const segments = value.split("/").filter(Boolean);
  if (!segments.length) {
    throw createHttpError(400, "无效路径");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw createHttpError(400, "路径非法");
  }
  if (segments.some((segment) => segment === fileManagerMetaDirName)) {
    throw createHttpError(400, "不允许访问系统目录");
  }

  const absolutePath = path.resolve(fileManagerRoot, value);
  if (!isPathInside(absolutePath, fileManagerRoot)) {
    throw createHttpError(400, "路径超出共享目录");
  }

  if (options.mustExist) {
    if (!fs.existsSync(absolutePath)) {
      throw createHttpError(404, `文件不存在：${value}`);
    }
    const stat = fs.statSync(absolutePath);
    if (!options.allowDirectory && stat.isDirectory()) {
      throw createHttpError(400, "该路径是文件夹，不是文件");
    }
    if (options.allowDirectory && !stat.isDirectory()) {
      throw createHttpError(400, "该路径不是文件夹");
    }
  }
  return absolutePath;
}

function getFileManagerShareSecret() {
  if (fileManagerShareSecretCache) return fileManagerShareSecretCache;
  const envSecret = String(process.env.OPENCLAW_FILES_SHARE_SECRET || "").trim();
  if (envSecret) {
    fileManagerShareSecretCache = envSecret;
    return fileManagerShareSecretCache;
  }

  try {
    fs.mkdirSync(path.dirname(fileManagerShareSecretPath), { recursive: true });
    if (fs.existsSync(fileManagerShareSecretPath)) {
      const existing = String(fs.readFileSync(fileManagerShareSecretPath, "utf8") || "").trim();
      if (existing) {
        fileManagerShareSecretCache = existing;
        return fileManagerShareSecretCache;
      }
    }
    const generated = randomBase64Url(48);
    fs.writeFileSync(fileManagerShareSecretPath, `${generated}\n`, { mode: 0o600 });
    try {
      fs.chmodSync(fileManagerShareSecretPath, 0o600);
    } catch (_chmodError) {
      // ignore chmod failure
    }
    fileManagerShareSecretCache = generated;
    return fileManagerShareSecretCache;
  } catch (_error) {
    const fallback = crypto
      .createHash("sha256")
      .update(`${userHome}|${host}|${port}|openclaw-files-share`)
      .digest("hex");
    fileManagerShareSecretCache = fallback;
    return fileManagerShareSecretCache;
  }
}

function signFileManagerDownloadPath(relativePath, expiresSec) {
  const secret = getFileManagerShareSecret();
  const payload = `${relativePath}\n${Number(expiresSec) || 0}`;
  return base64UrlEncode(crypto.createHmac("sha256", secret).update(payload).digest());
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function buildFileManagerDownloadSignature(relativePath, ttlSec = fileManagerShareDefaultTtlSec) {
  const normalizedPath = normalizeFileManagerIndexPath(relativePath);
  if (!normalizedPath) return null;
  const ttl = resolveFileManagerShareTtlSeconds(ttlSec);
  const nowSec = Math.floor(Date.now() / 1000);
  const expires = ttl > 0 ? nowSec + ttl : 0;
  return {
    expires,
    sig: signFileManagerDownloadPath(normalizedPath, expires)
  };
}

function verifyFileManagerDownloadSignature(relativePath, query = {}) {
  const normalizedPath = normalizeFileManagerIndexPath(relativePath);
  if (!normalizedPath) {
    return { ok: false, message: "分享链接路径非法" };
  }
  const sig = String(query.sig || "").trim();
  const expiresText = String(query.expires || "").trim();
  if (!sig || !expiresText) {
    return { ok: false, message: "分享链接缺少签名参数" };
  }
  const expires = Number.parseInt(expiresText, 10);
  if (!Number.isFinite(expires) || expires < 0) {
    return { ok: false, message: "分享链接参数非法" };
  }
  if (expires > 0 && Math.floor(Date.now() / 1000) > expires) {
    return { ok: false, message: "分享链接已过期" };
  }
  const expected = signFileManagerDownloadPath(normalizedPath, expires);
  if (!timingSafeTextEqual(sig, expected)) {
    return { ok: false, message: "分享链接签名无效" };
  }
  return { ok: true };
}

function normalizeFileManagerShareMode(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "permanent";
  if (["permanent", "long", "forever", "persist"].includes(raw)) return "permanent";
  if (["one_time", "one-time", "onetime", "once", "single"].includes(raw)) return "one_time";
  return "";
}

function createFileManagerShareLink(relativePath, options = {}) {
  const db = ensureFileManagerIndexReady();
  const normalizedPath = normalizeFileManagerIndexPath(relativePath);
  if (!normalizedPath) {
    throw createHttpError(400, "文件路径非法，无法创建分享链接");
  }
  const mode = normalizeFileManagerShareMode(options.mode);
  if (!mode) {
    throw createHttpError(400, "mode 仅支持 permanent 或 one_time");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const createdBy = String(options.createdBy || "").trim().slice(0, 120);
  const ttlInput = options.ttlSec;
  const fallbackTtl = mode === "one_time" ? fileManagerOneTimeShareDefaultTtlSec : 0;
  const ttlSec = String(ttlInput ?? "").trim() ? resolveFileManagerShareTtlSeconds(ttlInput) : fallbackTtl;
  const expiresAt = ttlSec > 0 ? nowSec + ttlSec : 0;
  const maxUses = mode === "one_time" ? 1 : 0;
  const token = randomBase64Url(28);
  db.prepare(
    [
      `INSERT INTO ${fileManagerShareTable}`,
      `(token, rel_path, mode, expires_at, max_uses, used_count, created_at, created_by)`,
      `VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ].join(" ")
  ).run(token, normalizedPath, mode, expiresAt, maxUses, nowSec, createdBy);

  const relativeUrl = `/api/files/download?share=${encodeURIComponent(token)}`;
  const publicUrl = fileManagerPublicOrigin ? `${fileManagerPublicOrigin}${relativeUrl}` : relativeUrl;
  return {
    token,
    mode,
    path: normalizedPath,
    expiresAt: expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null,
    maxUses,
    remainingUses: maxUses > 0 ? maxUses : null,
    url: publicUrl
  };
}

function consumeFileManagerShareLink(tokenInput) {
  const token = String(tokenInput || "").trim();
  if (!token) {
    return { ok: false, statusCode: 400, message: "分享链接缺少 token" };
  }
  const db = ensureFileManagerIndexReady();
  const nowSec = Math.floor(Date.now() / 1000);
  const row = db
    .prepare(
      [
        `SELECT token, rel_path, mode, expires_at, max_uses, used_count`,
        `FROM ${fileManagerShareTable}`,
        `WHERE token = ?`
      ].join(" ")
    )
    .get(token);
  if (!row) {
    return { ok: false, statusCode: 404, message: "分享链接不存在或已失效" };
  }

  const expiresAt = Number(row.expires_at || 0);
  const maxUses = Number(row.max_uses || 0);
  const usedCount = Number(row.used_count || 0);

  if (expiresAt > 0 && nowSec > expiresAt) {
    db.prepare(`DELETE FROM ${fileManagerShareTable} WHERE token = ?`).run(token);
    return { ok: false, statusCode: 410, message: "分享链接已过期" };
  }
  if (maxUses > 0 && usedCount >= maxUses) {
    return { ok: false, statusCode: 410, message: "一次性分享链接已失效" };
  }

  if (maxUses > 0) {
    const updated = db
      .prepare(
        [
          `UPDATE ${fileManagerShareTable}`,
          `SET used_count = used_count + 1, last_used_at = ?`,
          `WHERE token = ? AND used_count < max_uses`
        ].join(" ")
      )
      .run(nowSec, token);
    if (!updated || Number(updated.changes || 0) < 1) {
      return { ok: false, statusCode: 410, message: "一次性分享链接已失效" };
    }
  } else {
    db.prepare(`UPDATE ${fileManagerShareTable} SET last_used_at = ? WHERE token = ?`).run(nowSec, token);
  }

  return {
    ok: true,
    path: String(row.rel_path || "").trim(),
    mode: String(row.mode || "permanent").trim() || "permanent"
  };
}

function buildFileManagerDownloadUrl(relativePath, options = {}) {
  const normalizedPath = normalizeFileManagerIndexPath(relativePath) || String(relativePath || "").trim().replace(/\\/g, "/");
  const params = new URLSearchParams();
  params.set("path", normalizedPath);
  const shouldSign = options.signed !== false;
  if (shouldSign) {
    const signed = buildFileManagerDownloadSignature(normalizedPath, options.ttlSec);
    if (signed) {
      params.set("expires", String(signed.expires));
      params.set("sig", signed.sig);
    }
  }
  return `/api/files/download?${params.toString()}`;
}

function buildFileManagerPublicShareUrl(relativePath, options = {}) {
  const downloadPath = buildFileManagerDownloadUrl(relativePath, {
    signed: true,
    ttlSec: options.ttlSec
  });
  if (!fileManagerPublicOrigin) return downloadPath;
  return `${fileManagerPublicOrigin}${downloadPath}`;
}

function getFileManagerPreviewType(fileName) {
  const ext = extractNormalizedExtension(fileName);
  if (ext === "pdf") return "pdf";
  if (fileManagerImagePreviewExts.has(ext)) return "image";
  if (fileManagerTextPreviewExts.has(ext)) return "text";
  const mime = getMimeTypeByFileName(fileName);
  if (String(mime).toLowerCase() === "application/pdf") return "pdf";
  if (String(mime).startsWith("text/")) return "text";
  if (String(mime).includes("json")) return "text";
  return "none";
}

function readTextPreviewFromFile(filePath, options = {}) {
  const maxBytes = clampInt(options.maxBytes, fileManagerPreviewTextMaxBytes, 1024, 50 * 1024 * 1024);
  const maxChars = clampInt(options.maxChars, fileManagerPreviewTextMaxChars, 500, 500000);
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    const totalBytes = Number(stat.size || 0);
    const readBytes = Math.min(totalBytes, maxBytes);
    const buffer = Buffer.alloc(readBytes);
    if (readBytes > 0) {
      fs.readSync(fd, buffer, 0, readBytes, 0);
    }
    let content = buffer.toString("utf8");
    let truncated = totalBytes > readBytes;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
      truncated = true;
    }
    return {
      content,
      truncated,
      totalBytes,
      readBytes
    };
  } finally {
    fs.closeSync(fd);
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseHttpByteRange(rangeHeader, totalSize) {
  const value = String(rangeHeader || "").trim();
  const size = Math.max(0, Number(totalSize || 0));
  if (!value || !value.toLowerCase().startsWith("bytes=")) return null;
  if (size <= 0) return null;
  const raw = value.slice(6).trim();
  if (!raw || raw.includes(",")) return null;
  const match = raw.match(/^(\d*)-(\d*)$/);
  if (!match) return null;
  const startText = String(match[1] || "").trim();
  const endText = String(match[2] || "").trim();
  if (!startText && !endText) return null;

  let start = 0;
  let end = size - 1;

  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - Math.floor(suffix));
    end = size - 1;
  } else {
    start = Number(startText);
    if (!Number.isFinite(start) || start < 0) return null;
    if (endText) {
      end = Number(endText);
      if (!Number.isFinite(end) || end < 0) return null;
    } else {
      end = size - 1;
    }
  }

  start = Math.floor(start);
  end = Math.floor(end);
  if (start >= size) return null;
  if (end < start) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

function normalizeIncomingAttachments(input) {
  const list = Array.isArray(input) ? input : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const storedId = String(item.storedId || item.storageId || item.id || "").trim();
      const stored = !!item.stored;
      if (!stored || !storedId) return null;
      return {
        stored: true,
        storedId,
        name: String(item.name || "").trim()
      };
    })
    .filter(Boolean);
}

function ensureAttachmentDirs(projectPath) {
  const attachmentDir = path.join(projectPath, attachmentDirName);
  fs.mkdirSync(attachmentDir, { recursive: true });
  const indexPath = path.join(attachmentDir, attachmentIndexFileName);
  return { attachmentDir, indexPath };
}

function sanitizeAttachmentFileName(name) {
  const base = String(name || "").trim() || "file.txt";
  const cleaned = base.replace(/[/\\\0]/g, "_").slice(0, 80).trim();
  return cleaned || "file.txt";
}

function buildAttachmentStorageId(input) {
  const name = String(input?.name || "").trim();
  const content = String(input?.content || "");
  const hash = crypto.createHash("sha256").update(`${name}\n${content}`).digest("hex").slice(0, 12);
  return `${Date.now().toString(36)}-${hash}`;
}

function upsertAttachmentIndex(indexPath, entry) {
  const current = loadJsonFileSafe(indexPath);
  const list = Array.isArray(current.items) ? current.items : [];
  const out = list.filter((item) => String(item?.id || "") !== entry.id);
  out.unshift(entry);
  fs.writeFileSync(indexPath, `${JSON.stringify({ items: out }, null, 2)}\n`, "utf8");
}

async function buildAttachmentsContext(input) {
  const projectPath = String(input?.projectPath || "").trim();
  const attachments = Array.isArray(input?.attachments) ? input.attachments : [];
  const query = String(input?.query || "").trim();
  if (!projectPath || !attachments.length) return "";

  const { attachmentDir, indexPath } = ensureAttachmentDirs(projectPath);
  const index = loadJsonFileSafe(indexPath);
  const items = Array.isArray(index.items) ? index.items : [];
  const byId = new Map(items.map((item) => [String(item?.id || ""), item]));

  const tokens = buildSearchTokens(query);
  let budget = attachmentContextMaxChars;
  const blocks = [];

  for (const att of attachments) {
    const id = String(att.storedId || "").trim();
    if (!id) continue;
    const meta = byId.get(id) || null;
    const fileName = meta?.fileName ? String(meta.fileName) : `${id}-${sanitizeAttachmentFileName(att.name || "file.txt")}`;
    const filePath = path.join(attachmentDir, fileName);
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, "utf8");
    const chunks = splitTextIntoChunks(raw, { maxChars: 1800, overlap: 120, maxChunks: 120 });
    const ranked = rankChunks(chunks, tokens).slice(0, 6);
    const picked = ranked.length ? ranked : chunks.slice(0, 2);

    const header = `【附件】${meta?.name || att.name || fileName}（id=${id}）`;
    const lines = [header];
    picked.forEach((c, idx) => {
      lines.push(`[片段 ${idx + 1}/${picked.length}]`, c.text);
    });
    const block = lines.join("\n");
    if (block.length > budget) break;
    blocks.push(block);
    budget -= block.length;
  }

  if (!blocks.length) return "";
  return ["以下为用户上传的大文件附件摘录（按需检索，非全文）：", blocks.join("\n\n-----\n\n")].join("\n\n");
}

function buildSearchTokens(query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return [];
  const tokens = new Set();
  // 英文/数字
  (text.match(/[a-z0-9]{2,}/g) || []).forEach((t) => tokens.add(t));
  // 中文连续片段（2+）
  (text.match(/[\u4e00-\u9fff]{2,}/g) || []).forEach((t) => {
    if (t.length <= 4) tokens.add(t);
    // 简单 bigram
    for (let i = 0; i < Math.min(12, t.length - 1); i += 1) {
      tokens.add(t.slice(i, i + 2));
    }
  });
  return Array.from(tokens).slice(0, 24);
}

function splitTextIntoChunks(text, options = {}) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const maxChars = clampInt(options.maxChars, 1800, 400, 8000);
  const overlap = clampInt(options.overlap, 120, 0, 600);
  const maxChunks = clampInt(options.maxChunks, 120, 1, 1000);

  if (!source.trim()) return [];
  const chunks = [];
  let cursor = 0;
  while (cursor < source.length && chunks.length < maxChunks) {
    const end = Math.min(source.length, cursor + maxChars);
    const slice = source.slice(cursor, end);
    chunks.push({ text: slice.trim(), start: cursor, end });
    const next = end - overlap;
    cursor = next > cursor ? next : end;
  }
  return chunks.filter((c) => c.text);
}

function rankChunks(chunks, tokens) {
  if (!tokens.length) return chunks.map((c) => ({ ...c, score: 0 }));
  const scored = chunks.map((c) => ({ ...c, score: scoreChunk(c.text, tokens) }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function scoreChunk(text, tokens) {
  const hay = String(text || "").toLowerCase();
  let score = 0;
  tokens.forEach((t) => {
    if (!t) return;
    let idx = 0;
    let count = 0;
    while ((idx = hay.indexOf(t, idx)) !== -1) {
      count += 1;
      idx += t.length;
      if (count >= 6) break;
    }
    if (count) score += 3 + count;
  });
  return score;
}

async function resolveNaturalLanguageCommandByModel(input) {
  const text = String(input?.text || "").trim();
  if (!text) return "";
  if (!looksLikeTaskRequest(text)) return "";

  const provider = String(input?.provider || "").trim();
  const model = String(input?.model || "").trim();
  const baseUrl = String(input?.baseUrl || "").trim();
  const apiKey = String(input?.apiKey || "").trim();
  if (!provider || !model || !baseUrl) return "";
  if (!apiKey && provider !== "ollama") return "";

  try {
    const raw = await chatWithProvider({
      provider,
      model,
      baseUrl,
      apiKey,
      messages: [{ role: "user", content: text }],
      systemPrompt: TASK_PLANNER_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 220,
      topP: 1
    });
    const parsed = parseTaskPlannerJson(raw);
    if (!parsed.execute) return "";
    return sanitizePlannedCommand(parsed.command);
  } catch (_error) {
    return "";
  }
}

function looksLikeTaskRequest(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.startsWith("/run ")) return true;
  const patterns = [
    /执行|运行|帮我|请帮我|请你|重启|启动|停止|安装|卸载|查看|列出|创建|删除|修改|日志|状态|目录|文件|端口|进程|权限|更新|部署|编译|测试/u,
    /\b(ls|pwd|cat|grep|find|git|npm|pnpm|yarn|node|python|docker|systemctl|journalctl|ss|ps)\b/i
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function parseTaskPlannerJson(raw) {
  const source = String(raw || "").trim();
  if (!source) return { execute: false, command: "" };
  const candidate = extractFirstJsonObject(source);
  if (!candidate) return { execute: false, command: "" };
  try {
    const parsed = JSON.parse(candidate);
    return {
      execute: !!parsed.execute,
      command: String(parsed.command || "").trim()
    };
  } catch (_error) {
    return { execute: false, command: "" };
  }
}

function extractFirstJsonObject(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return cleaned.slice(start, end + 1);
}

function sanitizePlannedCommand(command) {
  return String(command || "")
    .replace(/^`+|`+$/g, "")
    .replace(/^bash\s+-lc\s+/i, "")
    .trim();
}

async function chatWithProvider(input) {
  if (input.provider === "anthropic") {
    return chatAnthropic(input);
  }
  if (input.provider === "azure_openai") {
    return chatAzureOpenAI(input);
  }
  if (input.provider === "ollama") {
    return chatOllama(input);
  }
  return chatOpenAICompatible(input);
}

async function chatOpenAICompatible(input) {
  const endpoint = joinUrl(input.baseUrl, "chat/completions");
  const headers = { "Content-Type": "application/json" };
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

  const body = {
    model: input.model,
    messages: mergeSystemPrompt(input.messages, input.systemPrompt),
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    top_p: input.topP,
    stream: false
  };

  const data = await requestJson(endpoint, { method: "POST", headers, body });
  const text = extractOpenAIText(data);
  if (!text) {
    throw new Error("上游接口已响应，但没有返回有效回答");
  }
  return text;
}

async function chatAnthropic(input) {
  const endpoint = joinUrl(input.baseUrl, "messages");
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": input.apiKey,
    "anthropic-version": "2023-06-01"
  };

  const mapped = toAnthropicMessages(input.messages, input.systemPrompt);
  const body = {
    model: input.model,
    messages: mapped.messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    top_p: input.topP
  };
  if (mapped.system) body.system = mapped.system;

  const data = await requestJson(endpoint, { method: "POST", headers, body });
  const text = extractAnthropicText(data);
  if (!text) {
    throw new Error("Anthropic 接口已响应，但没有返回有效回答");
  }
  return text;
}

async function chatAzureOpenAI(input) {
  if (input.baseUrl.includes("{resource}") || input.baseUrl.includes("{deployment}")) {
    throw new Error("Azure 地址仍是模板，请先替换为真实 resource/deployment");
  }

  const endpoint = buildAzureChatUrl(input.baseUrl);
  const headers = {
    "Content-Type": "application/json",
    "api-key": input.apiKey
  };
  const body = {
    messages: mergeSystemPrompt(input.messages, input.systemPrompt),
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    top_p: input.topP,
    stream: false
  };

  const data = await requestJson(endpoint, { method: "POST", headers, body });
  const text = extractOpenAIText(data);
  if (!text) {
    throw new Error("Azure OpenAI 接口已响应，但没有返回有效回答");
  }
  return text;
}

async function chatOllama(input) {
  try {
    return await chatOpenAICompatible(input);
  } catch (_error) {
    const endpoint = joinUrl(input.baseUrl.replace(/\/v1\/?$/, "/"), "api/chat");
    const body = {
      model: input.model,
      messages: mergeSystemPrompt(input.messages, input.systemPrompt),
      stream: false,
      options: {
        temperature: input.temperature,
        top_p: input.topP,
        num_predict: input.maxTokens
      }
    };
    const data = await requestJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    const text = String(data.message?.content || "").trim();
    if (!text) {
      throw new Error("Ollama 接口已响应，但没有返回有效回答");
    }
    return text;
  }
}

async function discoverProviderModels({ provider, baseUrl, apiKey }) {
  if (provider === "anthropic") {
    return discoverAnthropicModels(baseUrl, apiKey);
  }
  if (provider === "azure_openai") {
    return discoverAzureModels(baseUrl, apiKey);
  }
  if (provider === "ollama") {
    return discoverOllamaModels(baseUrl, apiKey);
  }
  return discoverOpenAICompatibleModels(baseUrl, apiKey);
}

async function discoverOpenAICompatibleModels(baseUrl, apiKey) {
  const endpoint = joinUrl(baseUrl, "models");
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const data = await getJson(endpoint, headers);
  const models = normalizeModelList(data.data || data.models || []);
  if (!models.length) {
    throw new Error("接口可访问，但没有返回模型列表");
  }
  return models;
}

async function discoverAnthropicModels(baseUrl, apiKey) {
  const endpoint = joinUrl(baseUrl, "models");
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
  const data = await getJson(endpoint, headers);
  const models = normalizeModelList(data.data || data.models || []);
  if (!models.length) {
    throw new Error("Anthropic 接口未返回可用模型");
  }
  return models;
}

async function discoverAzureModels(baseUrl, apiKey) {
  if (baseUrl.includes("{resource}") || baseUrl.includes("{deployment}")) {
    throw new Error("Azure 地址仍是模板，请替换为你的真实 resource/deployment");
  }

  const rootUrl = getAzureRoot(baseUrl);
  const apiVersion = "2024-10-21";
  const endpoint = `${rootUrl}/openai/deployments?api-version=${apiVersion}`;
  const data = await getJson(endpoint, { "api-key": apiKey });
  const models = normalizeModelList(data.data || data.models || []);

  if (!models.length) {
    throw new Error("Azure 接口未返回可用部署列表");
  }
  return models;
}

async function discoverOllamaModels(baseUrl, apiKey) {
  try {
    return await discoverOpenAICompatibleModels(baseUrl, apiKey);
  } catch (_error) {
    const endpoint = joinUrl(baseUrl.replace(/\/v1\/?$/, "/"), "api/tags");
    const data = await getJson(endpoint, {});
    const models = normalizeModelList(data.models || []);
    if (!models.length) {
      throw new Error("Ollama 未返回可用模型，确认本地服务是否运行");
    }
    return models;
  }
}

function getAzureRoot(baseUrl) {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function normalizeModelList(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const normalized = items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      return String(item.id || item.model || item.name || "").trim();
    })
    .filter(Boolean);
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function joinUrl(base, pathname) {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(pathname, normalizedBase).toString();
}

function buildAzureChatUrl(baseUrl) {
  const parsed = new URL(joinUrl(baseUrl, "chat/completions"));
  if (!parsed.searchParams.get("api-version")) {
    parsed.searchParams.set("api-version", AZURE_OPENAI_API_VERSION);
  }
  return parsed.toString();
}

function mergeSystemPrompt(messages, systemPrompt) {
  const output = messages.map((item) => ({ role: item.role, content: item.content }));
  if (systemPrompt) {
    output.unshift({ role: "system", content: systemPrompt });
  }
  return output;
}

function toAnthropicMessages(messages, systemPrompt) {
  const systemParts = [];
  if (systemPrompt) systemParts.push(systemPrompt);

  const output = [];
  messages.forEach((item) => {
    if (item.role === "system") {
      systemParts.push(item.content);
      return;
    }
    output.push({ role: item.role, content: item.content });
  });

  return {
    system: systemParts.join("\n\n").trim(),
    messages: output
  };
}

function extractOpenAIText(data) {
  const first = data?.choices?.[0];
  const content = first?.message?.content ?? first?.delta?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        return String(part.text || part.content || "");
      })
      .join("")
      .trim();
  }
  return "";
}

function extractAnthropicText(data) {
  const list = Array.isArray(data?.content) ? data.content : [];
  return list
    .map((item) => (item && item.type === "text" ? String(item.text || "") : ""))
    .join("")
    .trim();
}

function normalizeChatMessages(messages) {
  const items = Array.isArray(messages) ? messages : [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const role = String(item.role || "").trim();
      const content = String(item.content || "").trim();
      if (!role || !content) return null;
      if (role !== "user" && role !== "assistant" && role !== "system") return null;
      return { role, content };
    })
    .filter(Boolean);
}

function findLatestUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages[i];
  }
  return null;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function requestJson(url, options = {}) {
  const transport = String(process.env.OPENCLAW_HTTP_TRANSPORT || process.env.BRIDGE_HTTP_TRANSPORT || "auto")
    .trim()
    .toLowerCase();
  const hasProxy = hasAnyProxyEnv();
  const useCurlInAutoMode = transport === "auto" && hasProxy && commandExists("curl");
  const shouldTryCurlFallback = transport === "fetch" && hasProxy && commandExists("curl");

  try {
    if (transport === "curl" || useCurlInAutoMode) {
      return await requestJsonByCurl(url, options);
    }
    return await requestJsonByFetch(url, options);
  } catch (error) {
    if (shouldTryCurlFallback) {
      try {
        return await requestJsonByCurl(url, options);
      } catch (curlError) {
        throw new Error(`${formatErrorMessage(error)}；curl 兜底也失败：${formatErrorMessage(curlError)}`);
      }
    }
    throw error;
  }
}

async function requestText(url, options = {}) {
  const transport = String(process.env.OPENCLAW_HTTP_TRANSPORT || process.env.BRIDGE_HTTP_TRANSPORT || "auto")
    .trim()
    .toLowerCase();
  const hasProxy = hasAnyProxyEnv();
  const useCurlInAutoMode = transport === "auto" && hasProxy && commandExists("curl");
  const shouldTryCurlFallback = transport === "fetch" && hasProxy && commandExists("curl");

  try {
    if (transport === "curl" || useCurlInAutoMode) {
      return await requestTextByCurl(url, options);
    }
    return await requestTextByFetch(url, options);
  } catch (error) {
    if (shouldTryCurlFallback) {
      try {
        return await requestTextByCurl(url, options);
      } catch (curlError) {
        throw new Error(`${formatErrorMessage(error)}；curl 兜底也失败：${formatErrorMessage(curlError)}`);
      }
    }
    throw error;
  }
}

async function requestJsonByFetch(url, options = {}) {
  const method = options.method || "GET";
  const headers = options.headers || {};
  const body = options.body;
  const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (String(error && error.name) === "AbortError") {
      throw new Error(`上游请求超时（${timeoutMs}ms）`);
    }
    throw new Error(`上游网络请求失败：${formatErrorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (_error) {
    if (!response.ok) {
      throw new Error(`上游接口错误（${response.status}）`);
    }
    throw new Error("上游接口返回了非 JSON 数据");
  }

  if (!response.ok) {
    const detail = data.error?.message || data.error || data.message || rawText.slice(0, 180);
    throw new Error(`上游接口错误（${response.status}）：${detail}`);
  }
  return data;
}

async function requestTextByFetch(url, options = {}) {
  const method = options.method || "GET";
  const headers = options.headers || {};
  const body = options.body;
  const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (String(error && error.name) === "AbortError") {
      throw new Error(`上游请求超时（${timeoutMs}ms）`);
    }
    throw new Error(`上游网络请求失败：${formatErrorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`上游接口错误（${response.status}）：${rawText.slice(0, 180) || "empty response"}`);
  }
  return rawText;
}

async function requestJsonByCurl(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = options.headers || {};
  const body = options.body;
  const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs);

  if (!commandExists("curl")) {
    throw new Error("未检测到 curl，无法使用 curl 作为网络传输");
  }

  const args = [
    "-sS",
    "-L",
    "--compressed",
    "--connect-timeout",
    String(Math.max(3, Math.ceil(Math.min(timeoutMs, 15000) / 1000))),
    "--max-time",
    String(Math.max(5, Math.ceil(timeoutMs / 1000))),
    "-X",
    method,
    url
  ];

  const headerEntries = Object.entries(headers || {});
  for (const [key, value] of headerEntries) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    args.push("-H", `${key}: ${String(value)}`);
  }

  if (body !== undefined) {
    args.push("-H", "Content-Type: application/json");
    args.push("--data-binary", JSON.stringify(body));
  }

  const statusToken = "__OPENCLAW_CURL_STATUS__";
  args.push("-w", `\\n${statusToken}%{http_code}\\n`);

  const { stdout, stderr } = await execFileAsync("curl", args, { maxBuffer: 12 * 1024 * 1024 });

  const raw = String(stdout || "");
  const tokenIndex = raw.lastIndexOf(statusToken);
  if (tokenIndex < 0) {
    throw new Error(`curl 输出异常：${String(stderr || "").trim() || "unknown"}`);
  }

  const rawBody = raw.slice(0, tokenIndex).trim();
  const statusStr = raw.slice(tokenIndex + statusToken.length).trim();
  const statusCode = clampInt(statusStr, 0, 0, 999);

  let data = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch (_error) {
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`上游接口错误（${statusCode}）`);
    }
    throw new Error("上游接口返回了非 JSON 数据");
  }

  if (statusCode < 200 || statusCode >= 300) {
    const detail = data.error?.message || data.error || data.message || String(rawBody || "").slice(0, 180);
    throw new Error(`上游接口错误（${statusCode}）：${detail}`);
  }

  return data;
}

async function requestTextByCurl(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = options.headers || {};
  const body = options.body;
  const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs);

  if (!commandExists("curl")) {
    throw new Error("未检测到 curl，无法使用 curl 作为网络传输");
  }

  const args = [
    "-sS",
    "-L",
    "--compressed",
    "--connect-timeout",
    String(Math.max(3, Math.ceil(Math.min(timeoutMs, 15000) / 1000))),
    "--max-time",
    String(Math.max(5, Math.ceil(timeoutMs / 1000))),
    "-X",
    method,
    url
  ];

  const headerEntries = Object.entries(headers || {});
  for (const [key, value] of headerEntries) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    args.push("-H", `${key}: ${String(value)}`);
  }

  if (body !== undefined) {
    args.push("-H", "Content-Type: application/json");
    args.push("--data-binary", JSON.stringify(body));
  }

  const statusToken = "__OPENCLAW_CURL_STATUS__";
  args.push("-w", `\\n${statusToken}%{http_code}\\n`);

  const { stdout, stderr } = await execFileAsync("curl", args, { maxBuffer: 20 * 1024 * 1024 });

  const raw = String(stdout || "");
  const tokenIndex = raw.lastIndexOf(statusToken);
  if (tokenIndex < 0) {
    throw new Error(`curl 输出异常：${String(stderr || "").trim() || "unknown"}`);
  }

  const rawBody = raw.slice(0, tokenIndex);
  const statusStr = raw.slice(tokenIndex + statusToken.length).trim();
  const statusCode = clampInt(statusStr, 0, 0, 999);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`上游接口错误（${statusCode}）：${String(rawBody || "").trim().slice(0, 180)}`);
  }

  return rawBody;
}

async function getJson(url, headers) {
  return requestJson(url, { method: "GET", headers });
}

function resolveRequestTimeoutMs(input) {
  if (input !== undefined) {
    return clampInt(input, 120000, 1000, 10 * 60 * 1000);
  }
  const envValue = process.env.OPENCLAW_HTTP_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || "";
  return clampInt(envValue, 120000, 1000, 10 * 60 * 1000);
}

function formatErrorMessage(error) {
  if (!error) return "unknown";
  const message = String(error.message || error.toString() || "unknown").trim();
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return message;
  const code = cause.code ? String(cause.code) : "";
  const causeMsg = String(cause.message || "").trim();
  if (code && causeMsg) return `${message} (${code}: ${causeMsg})`;
  if (code) return `${message} (${code})`;
  if (causeMsg) return `${message} (${causeMsg})`;
  return message;
}

function hasAnyProxyEnv() {
  const env = process.env;
  return !!(
    env.HTTP_PROXY ||
    env.HTTPS_PROXY ||
    env.ALL_PROXY ||
    env.http_proxy ||
    env.https_proxy ||
    env.all_proxy
  );
}

const commandExistsCache = new Map();

function commandExists(command) {
  const key = String(command || "").trim();
  if (!key) return false;
  if (commandExistsCache.has(key)) return commandExistsCache.get(key);
  try {
    const result = spawnSync("bash", ["-lc", `command -v ${escapeShell(key)}`], { encoding: "utf8" });
    const exists = result.status === 0;
    commandExistsCache.set(key, exists);
    return exists;
  } catch (_error) {
    commandExistsCache.set(key, false);
    return false;
  }
}

function escapeShell(text) {
  return String(text || "").replace(/[^a-zA-Z0-9_./-]/g, "");
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || "").trim();
        reject(new Error(detail || `执行失败: ${command}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function readJsonBody(req, options = {}) {
  return new Promise((resolve, reject) => {
    const maxBytes = clampInt(options.maxBytes, 1024 * 1024, 1024, 50 * 1024 * 1024);
    let raw = "";
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      raw += chunk;
      if (raw.length > maxBytes) {
        rejected = true;
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_error) {
        reject(new Error("请求体不是有效 JSON"));
      }
    });
    req.on("error", () => reject(new Error("读取请求体失败")));
  });
}

function readRawBody(req, options = {}) {
  return new Promise((resolve, reject) => {
    const maxBytes = clampInt(options.maxBytes, 1024 * 1024, 1024, 50 * 1024 * 1024);
    const chunks = [];
    let total = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += data.length;
      if (total > maxBytes) {
        rejected = true;
        reject(new Error("请求体过大"));
        return;
      }
      chunks.push(data);
    });
    req.on("end", () => {
      if (rejected) return;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", () => reject(new Error("读取请求体失败")));
  });
}

function resolveFileManagerUploadMaxBytes(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return 0;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return clampInt(parsed, 0, 1024 * 1024, 20 * 1024 * 1024 * 1024);
}

function resolveFileManagerShareTtlSeconds(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return 30 * 24 * 60 * 60;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) return 30 * 24 * 60 * 60;
  if (parsed <= 0) return 0;
  return clampInt(parsed, 30 * 24 * 60 * 60, 60, 3650 * 24 * 60 * 60);
}

function normalizeOptionalOrigin(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    return parsed.origin;
  } catch (_error) {
    return "";
  }
}

function normalizeWebhookProxyPath(input) {
  const raw = String(input || "").trim();
  if (!raw) return "/api/telegram/webhook";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function streamRequestBodyToFile(req, targetPath, options = {}) {
  const maxBytes = clampInt(options.maxBytes, 0, 0, 20 * 1024 * 1024 * 1024);
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const writeStream = fs.createWriteStream(targetPath, { flags: "wx" });

    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      try {
        req.unpipe(writeStream);
      } catch (_error) {
        // ignore
      }
      try {
        writeStream.destroy();
      } catch (_error) {
        // ignore
      }
      try {
        fs.unlinkSync(targetPath);
      } catch (_error) {
        // ignore
      }
      reject(error instanceof Error ? error : new Error(String(error || "上传失败")));
    };

    req.on("data", (chunk) => {
      if (settled) return;
      total += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk || ""));
      if (maxBytes > 0 && total > maxBytes) {
        finishWithError(createHttpError(413, `单文件超过限制：${maxBytes} 字节`));
      }
    });

    req.on("aborted", () => finishWithError(createHttpError(499, "上传连接中断，请重试")));
    req.on("error", () => finishWithError(new Error("读取上传数据失败")));
    writeStream.on("error", (error) => finishWithError(error));
    writeStream.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve(total);
    });

    req.pipe(writeStream);
  });
}

function getMimeTypeByFileName(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return fileDownloadMimeTypes[ext] || "application/octet-stream";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function loadBridgeConfigForUi() {
  const parsed = fs.existsSync(bridgeConfigPath)
    ? loadJsonFileSafe(bridgeConfigPath)
    : loadJsonFileSafe(bridgeExampleConfigPath);
  return normalizeBridgeConfigForUi(parsed);
}

function loadJsonFileSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
}

function loadVpnSubscriptionState() {
  const raw = loadJsonFileSafe(vpnSubscriptionsPath);
  const source = raw && typeof raw === "object" ? raw : {};
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    version: 1,
    updatedAt: String(source.updatedAt || "").trim(),
    items: normalizeVpnSubscriptionItems(items)
  };
}

function normalizeVpnSubscriptionItems(inputItems) {
  const source = Array.isArray(inputItems) ? inputItems : [];
  const now = new Date().toISOString();
  const out = [];
  const seenUrl = new Set();
  source.forEach((item) => {
    const normalized = normalizeVpnSubscriptionItem(item, now);
    if (!normalized) return;
    if (seenUrl.has(normalized.url)) return;
    seenUrl.add(normalized.url);
    out.push(normalized);
  });
  return out.slice(0, 300);
}

function normalizeVpnSubscriptionItem(input, now) {
  if (!input || typeof input !== "object") return null;
  const url = normalizeVpnSubscriptionUrl(input.url);
  if (!url) return null;
  const createdAt = String(input.createdAt || "").trim() || now || new Date().toISOString();
  const updatedAt = String(input.updatedAt || "").trim() || now || new Date().toISOString();
  const id = String(input.id || "").trim() || `vpn-sub-${randomBase64Url(8)}`;
  const hostHint = buildSubscriptionNameFromUrl(url);
  const name = String(input.name || "").trim().slice(0, 120) || hostHint;
  return {
    id,
    name,
    url,
    enabled: input.enabled !== false,
    tags: String(input.tags || "").trim().slice(0, 200),
    note: String(input.note || "").trim().slice(0, 400),
    createdAt,
    updatedAt
  };
}

function normalizeVpnSubscriptionUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

function buildSubscriptionNameFromUrl(urlText) {
  try {
    const parsed = new URL(String(urlText || "").trim());
    const host = String(parsed.hostname || "").trim();
    if (!host) return "订阅链接";
    return host.length > 80 ? host.slice(0, 80) : host;
  } catch (_error) {
    return "订阅链接";
  }
}

function saveVpnSubscriptionState(input) {
  const source = input && typeof input === "object" ? input : {};
  const items = normalizeVpnSubscriptionItems(source.items);
  const value = {
    version: 1,
    updatedAt: String(source.updatedAt || "").trim() || new Date().toISOString(),
    items
  };
  fs.mkdirSync(path.dirname(vpnSubscriptionsPath), { recursive: true });
  fs.writeFileSync(vpnSubscriptionsPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeVpnConvertExportExt(input) {
  const ext = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (ext === "yaml" || ext === "yml" || ext === "json" || ext === "conf" || ext === "txt") {
    return ext;
  }
  return "txt";
}

function normalizeVpnConvertExportMime(input, extInput) {
  const ext = normalizeVpnConvertExportExt(extInput);
  const mime = String(input || "").trim();
  if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;\s*charset=[a-z0-9-]+)?$/i.test(mime)) {
    return mime;
  }
  if (ext === "yaml" || ext === "yml") return "text/yaml; charset=utf-8";
  if (ext === "json") return "application/json; charset=utf-8";
  if (ext === "conf") return "text/plain; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function normalizeVpnConvertExportTab(input) {
  const raw = String(input || "nodes")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 24);
  return raw || "nodes";
}

function formatVpnConvertExportStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function loadVpnConvertExportMeta(id) {
  const safeId = String(id || "").trim();
  if (!safeId) return null;
  const metaPath = path.join(vpnConvertExportDir, `${safeId}.json`);
  if (!fs.existsSync(metaPath)) return null;
  const raw = loadJsonFileSafe(metaPath);
  if (!raw || typeof raw !== "object") return null;
  const normalizedId = String(raw.id || "").trim();
  const ext = normalizeVpnConvertExportExt(raw.ext || path.extname(String(raw.dataFile || "")).slice(1));
  const dataFile = path.basename(String(raw.dataFile || `${safeId}.${ext}`));
  const fileName = sanitizeUploadFileName(String(raw.fileName || `openclaw-export.${ext}`));
  const expiresAt = String(raw.expiresAt || "").trim();
  const createdAt = String(raw.createdAt || "").trim();
  if (!normalizedId || normalizedId !== safeId || !expiresAt || !createdAt) return null;
  return {
    id: safeId,
    ext,
    dataFile,
    fileName,
    mime: normalizeVpnConvertExportMime(raw.mime, ext),
    expiresAt,
    createdAt
  };
}

function removeVpnConvertExportFiles(id, meta) {
  const safeId = String(id || "").trim();
  if (!safeId) return;
  const metaPath = path.join(vpnConvertExportDir, `${safeId}.json`);
  const dataFile = path.basename(String(meta?.dataFile || `${safeId}.${normalizeVpnConvertExportExt(meta?.ext)}`));
  const dataPath = path.join(vpnConvertExportDir, dataFile);
  try {
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  } catch (_error) {
    // ignore
  }
  try {
    if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
  } catch (_error) {
    // ignore
  }
}

function cleanupVpnConvertExports(options = {}) {
  if (!fs.existsSync(vpnConvertExportDir)) return;
  const maxItems = clampInt(options.maxItems, vpnConvertExportMaxItems, 20, 5000);
  const now = Date.now();
  const metaFiles = fs
    .readdirSync(vpnConvertExportDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .filter(Boolean);
  const alive = [];
  metaFiles.forEach((fileName) => {
    const id = fileName.replace(/\.json$/i, "");
    const meta = loadVpnConvertExportMeta(id);
    if (!meta) {
      removeVpnConvertExportFiles(id);
      return;
    }
    const expiresAtMs = Date.parse(meta.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      removeVpnConvertExportFiles(id, meta);
      return;
    }
    alive.push(meta);
  });

  if (alive.length <= maxItems) return;
  alive
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, alive.length - maxItems)
    .forEach((item) => removeVpnConvertExportFiles(item.id, item));
}

function loadVpnConvertHistoryState() {
  const raw = loadJsonFileSafe(vpnConvertHistoryPath);
  const source = raw && typeof raw === "object" ? raw : {};
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    version: 1,
    updatedAt: String(source.updatedAt || "").trim(),
    items: items.map((item) => normalizeVpnConvertHistoryItem(item)).filter(Boolean).slice(0, 30)
  };
}

function normalizeVpnConvertHistoryItem(input) {
  if (!input || typeof input !== "object") return null;
  const id = String(input.id || "").trim();
  const createdAt = String(input.createdAt || "").trim();
  const inputText = String(input.input || "");
  if (!id || !createdAt || !inputText) return null;
  const summary = input.summary && typeof input.summary === "object" ? input.summary : {};
  const options = input.options && typeof input.options === "object" ? input.options : {};
  const preview = String(input.preview || "").trim() || buildVpnConvertPreview(inputText);
  const fetchedUrls = Array.isArray(input.fetchedUrls)
    ? input.fetchedUrls.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 10)
    : [];
  return {
    id,
    createdAt,
    preview: preview.slice(0, 220),
    input: inputText.slice(0, 200000),
    summary: {
      total: clampInt(summary.total, 0, 0, 5000),
      rawTotal: clampInt(summary.rawTotal, 0, 0, 5000),
      protocols: summary.protocols && typeof summary.protocols === "object" ? summary.protocols : {},
      message: String(summary.message || "").trim()
    },
    options: {
      dedupeMode: String(options.dedupeMode || "endpoint").trim().toLowerCase() || "endpoint",
      protocols: Array.isArray(options.protocols) ? options.protocols.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean).slice(0, 12) : [],
      region: String(options.region || "all").trim().toLowerCase() || "all",
      keyword: String(options.keyword || "").trim().slice(0, 120)
    },
    fetchedUrls
  };
}

function buildVpnConvertPreview(inputText) {
  const lines = String(inputText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "空白输入";
  const first = lines[0];
  if (first.length <= 120) return first;
  return `${first.slice(0, 117)}...`;
}

function saveVpnConvertHistoryState(input) {
  const state = loadVpnConvertHistoryState();
  const source = input && typeof input === "object" ? input : {};
  const nextItems = Array.isArray(source.items) ? source.items.map((item) => normalizeVpnConvertHistoryItem(item)).filter(Boolean).slice(0, 30) : state.items;
  const value = {
    version: 1,
    updatedAt: String(source.updatedAt || "").trim() || new Date().toISOString(),
    items: nextItems
  };
  fs.mkdirSync(path.dirname(vpnConvertHistoryPath), { recursive: true });
  fs.writeFileSync(vpnConvertHistoryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function saveVpnConvertHistoryEntry({ input, options, result }) {
  const inputText = String(input || "").trim();
  if (!inputText) return;
  const state = loadVpnConvertHistoryState();
  const nextEntry = normalizeVpnConvertHistoryItem({
    id: `vpn-history-${randomBase64Url(8)}`,
    createdAt: new Date().toISOString(),
    input: inputText,
    preview: buildVpnConvertPreview(inputText),
    summary: result?.summary || {},
    options: options || {},
    fetchedUrls: Array.isArray(result?.fetchedSources) ? result.fetchedSources.filter((item) => item?.ok && item?.url).map((item) => item.url) : []
  });
  if (!nextEntry) return;
  const dedupeKey = JSON.stringify({
    input: nextEntry.input,
    options: nextEntry.options
  });
  const filtered = state.items.filter((item) => JSON.stringify({ input: item.input, options: item.options }) !== dedupeKey);
  saveVpnConvertHistoryState({
    version: 1,
    updatedAt: new Date().toISOString(),
    items: [nextEntry, ...filtered].slice(0, 30)
  });
}

function loadFileManagerAuthConfig() {
  return normalizeFileManagerAuthConfig(loadJsonFileSafe(fileManagerAuthConfigPath));
}

function saveFileManagerAuthConfig(input) {
  const state = normalizeFileManagerAuthConfig(input);
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(fileManagerAuthConfigPath), { recursive: true });
  fs.writeFileSync(fileManagerAuthConfigPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function normalizeFileManagerAuthConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawUsers = Array.isArray(source.users) ? source.users : [];
  return {
    version: 1,
    updatedAt: String(source.updatedAt || "").trim(),
    users: rawUsers
      .map((item) => normalizeFileManagerAuthUser(item))
      .filter(Boolean)
  };
}

function normalizeFileManagerAuthUser(input) {
  if (!input || typeof input !== "object") return null;
  const email = normalizeFileManagerEmail(input.email, { allowEmpty: true });
  const passwordSalt = String(input.passwordSalt || "").trim();
  const passwordHash = String(input.passwordHash || "").trim();
  if (!email || !passwordSalt || !passwordHash) return null;
  return {
    id: String(input.id || `files-user-${randomBase64Url(8)}`).trim(),
    email,
    name: String(input.name || "").trim().slice(0, 80) || email.split("@")[0] || "文件管理员",
    enabled: input.enabled !== false,
    passwordSalt,
    passwordHash,
    createdAt: String(input.createdAt || "").trim() || new Date().toISOString()
  };
}

function normalizeFileManagerEmail(input, options = {}) {
  const allowEmpty = options && options.allowEmpty === true;
  const value = String(input || "").trim().toLowerCase();
  if (!value) {
    if (allowEmpty) return "";
    throw createHttpError(400, "邮箱不能为空");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw createHttpError(400, "邮箱格式不正确");
  }
  return value.slice(0, 160);
}

function normalizeFileManagerPassword(input, options = {}) {
  const allowShort = options && options.allowShort === true;
  const value = String(input || "");
  if (!value) throw createHttpError(400, "密码不能为空");
  if (!allowShort && value.length < 8) {
    throw createHttpError(400, "密码至少需要 8 位");
  }
  if (value.length > 256) {
    throw createHttpError(400, "密码过长");
  }
  return value;
}

function createFileManagerPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyFileManagerPassword(password, user) {
  const salt = String(user?.passwordSalt || "").trim();
  const expectedHash = String(user?.passwordHash || "").trim();
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return timingSafeTextEqual(actualHash, expectedHash);
}

function loadModelConsoleConfig() {
  const primary = normalizeModelConsoleState(loadJsonFileSafe(modelConsoleConfigPath));
  if (primary.models.length) return primary;

  const backup = normalizeModelConsoleState(loadJsonFileSafe(modelConsoleBackupPath));
  if (backup.models.length) {
    try {
      saveModelConsoleConfig(backup);
    } catch (_error) {
      // ignore
    }
    return backup;
  }

  const fallbackFromBridge = buildModelConsoleStateFromBridgeConfig();
  if (fallbackFromBridge.models.length) {
    try {
      saveModelConsoleConfig(fallbackFromBridge);
    } catch (_error) {
      // ignore
    }
    return fallbackFromBridge;
  }
  return primary;
}

function saveModelConsoleConfig(input) {
  const state = normalizeModelConsoleState(input);
  fs.mkdirSync(path.dirname(modelConsoleConfigPath), { recursive: true });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  try {
    if (fs.existsSync(modelConsoleConfigPath)) {
      fs.copyFileSync(modelConsoleConfigPath, modelConsoleBackupPath);
    }
  } catch (_error) {
    // ignore backup copy failure
  }
  fs.writeFileSync(modelConsoleConfigPath, serialized, "utf8");
  try {
    fs.writeFileSync(modelConsoleBackupPath, serialized, "utf8");
  } catch (_error) {
    // ignore backup write failure
  }
}

function normalizeModelConsoleState(input) {
  const source = input && typeof input === "object" ? input : {};
  const seen = new Set();
  const modelsRaw = Array.isArray(source.models) ? source.models : [];
  const models = modelsRaw
    .map((item) => normalizeModelConsoleModel(item, seen))
    .filter((item) => !!item);
  const defaultModelId = models.some((item) => item.id === source.defaultModelId)
    ? source.defaultModelId
    : models[0]?.id || "";
  return {
    version: Number.isFinite(source.version) ? source.version : 1,
    updatedAt: String(source.updatedAt || ""),
    defaultModelId,
    models
  };
}

function normalizeModelConsoleModel(input, seen) {
  if (!input || typeof input !== "object") return null;
  let id = String(input.id || "").trim() || buildModelConsoleId();
  while (seen.has(id)) {
    id = buildModelConsoleId();
  }
  seen.add(id);

  const api = input.api && typeof input.api === "object" ? input.api : {};
  const params = input.params && typeof input.params === "object" ? input.params : {};
  const provider = normalizeModelProvider(input.provider);
  return {
    id,
    name: String(input.name || "").trim() || "未命名模型",
    provider,
    model: String(input.model || "").trim(),
    baseUrl: String(input.baseUrl || api.baseUrl || "").trim(),
    apiKey: String(input.apiKey || api.apiKey || "").trim(),
    temperature: clampNumber(input.temperature ?? params.temperature, 0.7, 0, 2),
    maxTokens: clampInt(input.maxTokens ?? params.maxTokens, 1024, 1, 32000),
    topP: clampNumber(input.topP ?? params.topP, 1, 0, 1),
    enabled: input.enabled !== false,
    availableModels: normalizeModelIdList(input.availableModels)
  };
}

function normalizeModelProvider(value) {
  const provider = String(value || "").trim();
  const allowed = new Set([
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "openrouter",
    "ollama",
    "azure_openai",
    "custom"
  ]);
  return allowed.has(provider) ? provider : "custom";
}

function buildModelConsoleId() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function buildModelConsoleStateFromBridgeConfig() {
  const raw = fs.existsSync(bridgeConfigPath)
    ? loadJsonFileSafe(bridgeConfigPath)
    : loadJsonFileSafe(bridgeExampleConfigPath);
  const bridgeConfig = normalizeBridgeConfigForUi(raw);
  const env = loadBridgeEnvForUi();
  const apiKey = resolveSecretInput(bridgeConfig.model.apiKey, env) || bridgeConfig.model.apiKey;
  const provider = normalizeModelProvider(bridgeConfig.model.provider);
  const modelId = String(bridgeConfig.model.model || "").trim();
  const baseUrl = String(bridgeConfig.model.baseUrl || "").trim();
  if (!modelId || !baseUrl) {
    return {
      version: 1,
      updatedAt: "",
      defaultModelId: "",
      models: []
    };
  }
  const id = buildModelConsoleId();
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaultModelId: id,
    models: [
      {
        id,
        name: "桥接默认模型",
        provider,
        model: modelId,
        baseUrl,
        apiKey: String(apiKey || ""),
        temperature: clampNumber(bridgeConfig.model.temperature, 0.7, 0, 2),
        maxTokens: clampInt(bridgeConfig.model.maxTokens, 1024, 1, 32000),
        topP: clampNumber(bridgeConfig.model.topP, 1, 0, 1),
        enabled: true,
        availableModels: [modelId]
      }
    ]
  };
}

function normalizeBridgeConfigForUi(input) {
  const value = input && typeof input === "object" ? input : {};
  const model = value.model && typeof value.model === "object" ? value.model : {};
  const bot = value.bot && typeof value.bot === "object" ? value.bot : {};
  const telegram = value.telegram && typeof value.telegram === "object" ? value.telegram : {};

  return {
    model: {
      provider: String(model.provider || "openai").trim(),
      baseUrl: String(model.baseUrl || "").trim(),
      apiKey: String(model.apiKey || "").trim(),
      model: String(model.model || "").trim(),
      systemPrompt: String(model.systemPrompt || "").trim(),
      temperature: clampNumber(model.temperature, 0.7, 0, 2),
      maxTokens: clampInt(model.maxTokens, 1024, 1, 32000),
      topP: clampNumber(model.topP, 1, 0, 1)
    },
    bot: {
      historyTurns: clampInt(bot.historyTurns, 12, 1, 50)
    },
    telegram: {
      enabled: !!telegram.enabled,
      botToken: String(telegram.botToken || "").trim(),
      apiBase: String(telegram.apiBase || "https://api.telegram.org").trim(),
      pollTimeoutSec: clampInt(telegram.pollTimeoutSec, 20, 1, 60),
      pollIntervalMs: clampInt(telegram.pollIntervalMs, 1200, 300, 30000),
      allowedChatIds: parseStringListFlexible(telegram.allowedChatIds)
    }
  };
}

function parseStringListFlexible(input) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function loadStartupSequenceConfig() {
  const parsed = loadJsonFileSafe(startupSequencePath);
  return normalizeStartupSequenceConfig(parsed);
}

function saveStartupSequenceConfig(input) {
  const value = normalizeStartupSequenceConfig(input);
  fs.mkdirSync(path.dirname(startupSequencePath), { recursive: true });
  fs.writeFileSync(startupSequencePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeStartupSequenceConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    enabled: source.enabled === undefined ? startupSequenceDefaults.enabled : !!source.enabled,
    maxCharsPerFile: clampInt(
      source.maxCharsPerFile,
      startupSequenceDefaults.maxCharsPerFile,
      500,
      200000
    ),
    maxTotalChars: clampInt(
      source.maxTotalChars,
      startupSequenceDefaults.maxTotalChars,
      1000,
      500000
    ),
    files: normalizePathList(source.files)
  };
}

function normalizePathList(input) {
  const list = parseStringListFlexible(input);
  return Array.from(
    new Set(
      list
        .map(expandHomeDir)
        .map((filePath) => {
          const normalized = String(filePath || "").trim();
          if (!normalized) return "";
          return path.isAbsolute(normalized) ? path.normalize(normalized) : path.resolve(root, normalized);
        })
        .filter(Boolean)
    )
  ).slice(0, 40);
}

function loadProjectsConfig() {
  const parsed = loadJsonFileSafe(projectsConfigPath);
  return normalizeProjectsConfig(parsed);
}

function loadProjectsState() {
  const parsed = loadJsonFileSafe(projectsStatePath);
  return normalizeProjectsState(parsed);
}

function normalizeProjectsState(input) {
  const source = input && typeof input === "object" ? input : {};
  const list = parseStringListFlexible(source.archivedPaths);
  return {
    archivedPaths: Array.from(new Set(list.map((item) => path.normalize(expandHomeDir(item))).filter(Boolean)))
  };
}

function saveProjectsState(input) {
  const value = normalizeProjectsState(input);
  fs.mkdirSync(path.dirname(projectsStatePath), { recursive: true });
  fs.writeFileSync(projectsStatePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listProjectsFromRoots(roots) {
  const output = new Set();
  const globalWorkspaceResolved = path.resolve(globalWorkspaceDir);
  (Array.isArray(roots) ? roots : []).forEach((rootPath) => {
    const base = path.normalize(String(rootPath || "").trim());
    if (!base || !fs.existsSync(base)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    entries.forEach((entry) => {
      if (!entry?.isDirectory?.()) return;
      if (entry.name.startsWith(".")) return;
      const fullPath = path.join(base, entry.name);
      if (path.resolve(fullPath) === globalWorkspaceResolved) return;
      output.add(fullPath);
    });
  });
  return Array.from(output).sort((a, b) => a.localeCompare(b));
}

function normalizeProjectsConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const fallbackRoot = path.normalize(projectsConfigDefaults.defaultRoot);
  const defaultRoot = normalizeProjectRootPath(source.defaultRoot, fallbackRoot);
  let allowedRoots = normalizeProjectRootList(source.allowedRoots, defaultRoot);
  if (!isPathUnderAllowedRoots(defaultRoot, allowedRoots)) {
    allowedRoots = [defaultRoot, ...allowedRoots];
  }
  return {
    defaultRoot,
    allowedRoots: Array.from(new Set(allowedRoots))
  };
}

function resolveProjectPathForRequest(rawPath, projectsConfig) {
  const value = String(rawPath || "").trim();
  if (!value) return "";
  const expanded = expandHomeDir(value);
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(projectsConfig.defaultRoot, expanded);
  const normalized = path.normalize(absolute);
  if (!isPathUnderAllowedRoots(normalized, projectsConfig.allowedRoots)) {
    const error = new Error(`项目目录不在允许范围内，仅允许：${projectsConfig.allowedRoots.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    const error = new Error(`项目目录不存在：${normalized}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function getGlobalWorkspaceDir() {
  return path.normalize(globalWorkspaceDir);
}

function ensureGlobalWorkspaceFiles() {
  const workspaceDir = getGlobalWorkspaceDir();
  fs.mkdirSync(workspaceDir, { recursive: true });

  const files = [];
  projectWorkspaceFileNames.forEach((name) => {
    const targetPath = path.join(workspaceDir, name);
    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, buildWorkspaceDefaultText(name), "utf8");
    }
    files.push(targetPath);
  });
  ensureGlobalMemoryHeader(path.join(workspaceDir, "MEMORY.md"));
  return { workspaceDir, files };
}

function ensureGlobalMemoryHeader(memoryPath) {
  try {
    const raw = String(fs.readFileSync(memoryPath, "utf8") || "").replace(/\r\n/g, "\n").trim();
    const lines = raw ? raw.split("\n") : [];
    if (!lines.length || !/^#\s*MEMORY/i.test(lines[0])) {
      lines.unshift("# MEMORY");
    }
    const mustHave = [
      "- 全局工作目录：/home/weijin/codex/workspace",
      "- 存储范围：所有项目与对话"
    ];
    mustHave.forEach((line) => {
      if (!lines.some((row) => row.trim() === line)) {
        lines.push(line);
      }
    });
    const output = `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
    fs.writeFileSync(memoryPath, output, "utf8");
  } catch (_error) {
    // ignore
  }
}

function buildWorkspaceDefaultText(fileName) {
  if (fileName === "MEMORY.md") {
    return [
      "# MEMORY",
      "",
      "长期上下文记录：",
      "",
      "- 全局工作目录：/home/weijin/codex/workspace",
      "- 存储范围：所有项目与对话",
      `- 初始化时间：${new Date().toISOString()}`,
      ""
    ].join("\n");
  }

  const templatePath = path.join(root, "workspace", fileName);
  if (fs.existsSync(templatePath)) {
    try {
      const raw = fs.readFileSync(templatePath, "utf8");
      if (raw.trim()) return raw.endsWith("\n") ? raw : `${raw}\n`;
    } catch (_error) {
      // fallback below
    }
  }

  if (fileName === "SOUL.md") {
    return ["# SOUL", "", "你是当前智能体的全局长期助手。", "", "- 永远优先中文回复", "- 优先给出可执行步骤", ""].join("\n");
  }
  if (fileName === "USER.md") {
    return ["# USER", "", "用户偏好：", "", "- 使用中文沟通", "- 需要可落地、可复制的命令", ""].join("\n");
  }
  if (fileName === "BOOTSTRAP.md") {
    return ["# BOOTSTRAP", "", "启动序列：", "", "1. 先读取 /home/weijin/codex/workspace 下必读文件", "2. 再结合当前项目上下文回答", ""].join("\n");
  }
  return ["# NOTE", "", "全局落库文件", ""].join("\n");
}

function buildGlobalWorkspaceContext(projectPath) {
  const normalizedProjectPath = String(projectPath || "").trim() || "未指定项目";
  const diagnostics = {
    enabled: true,
    skipped: false,
    workspaceDir: "",
    projectPath: normalizedProjectPath,
    filesLoaded: 0,
    filesMissing: 0,
    truncated: false,
    totalChars: 0,
    loadedPaths: [],
    missingPaths: []
  };

  const ensured = ensureGlobalWorkspaceFiles();
  diagnostics.workspaceDir = ensured.workspaceDir;

  const maxCharsPerFile = 4000;
  let remaining = 12000;
  const blocks = [];

  ensured.files.forEach((filePath) => {
    if (remaining <= 0) {
      diagnostics.truncated = true;
      return;
    }
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (_error) {
      diagnostics.filesMissing += 1;
      diagnostics.missingPaths.push(filePath);
      return;
    }
    let text = String(content || "").replace(/\r\n/g, "\n").trim();
    if (!text) {
      diagnostics.filesLoaded += 1;
      diagnostics.loadedPaths.push(filePath);
      return;
    }
    if (text.length > maxCharsPerFile) {
      text = text.slice(0, maxCharsPerFile);
      diagnostics.truncated = true;
    }
    if (text.length > remaining) {
      text = text.slice(0, remaining);
      diagnostics.truncated = true;
    }
    if (!text) return;

    blocks.push(`[全局落库文件] ${filePath}\n${text}`);
    remaining -= text.length;
    diagnostics.totalChars += text.length;
    diagnostics.filesLoaded += 1;
    diagnostics.loadedPaths.push(filePath);
  });

  if (!blocks.length) return { text: "", diagnostics };
  const text = [
    `【当前项目】${normalizedProjectPath}`,
    "【全局上下文】以下是 /home/weijin/codex/workspace 的落库文件，请优先遵守并利用其中信息。",
    blocks.join("\n\n-----\n\n")
  ].join("\n\n");
  return { text, diagnostics };
}

function appendGlobalMemoryEntrySafe(projectPath, input) {
  try {
    const ensured = ensureGlobalWorkspaceFiles();
    const memoryPath = path.join(ensured.workspaceDir, "MEMORY.md");
    const userText = compactMemoryText(input?.userText || "", 1800);
    const assistantText = compactMemoryText(input?.assistantText || "", 1800);
    if (!userText && !assistantText) return;
    const mode = String(input?.mode || "chat").trim();
    const projectLine = String(projectPath || "").trim() || "未指定项目";
    const block = [
      "",
      `## ${new Date().toISOString()} [${mode}]`,
      `- 项目：${projectLine}`,
      userText ? `- 用户：${userText}` : "",
      assistantText ? `- 助手：${assistantText}` : "",
      ""
    ]
      .filter(Boolean)
      .join("\n");
    fs.appendFileSync(memoryPath, block, "utf8");
  } catch (_error) {
    // 不阻塞主流程
  }
}

function loadChatHistoryStore() {
  ensureGlobalWorkspaceFiles();
  try {
    if (!fs.existsSync(chatHistoryPath)) {
      return { version: 1, projects: {} };
    }
    const raw = fs.readFileSync(chatHistoryPath, "utf8");
    const parsed = raw ? JSON.parse(raw) : {};
    const projects = parsed && typeof parsed.projects === "object" ? parsed.projects : {};
    const normalizedProjects = {};
    Object.entries(projects).forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      normalizedProjects[key] = value
        .map((item) => normalizeHistoryEntry(item))
        .filter(Boolean);
    });
    return { version: 1, projects: normalizedProjects };
  } catch (_error) {
    return { version: 1, projects: {} };
  }
}

function saveChatHistoryStore(store) {
  const value = store && typeof store === "object" ? store : { version: 1, projects: {} };
  fs.mkdirSync(path.dirname(chatHistoryPath), { recursive: true });
  fs.writeFileSync(chatHistoryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeHistoryEntry(input) {
  if (!input || typeof input !== "object") return null;
  const projectPath = String(input.projectPath || "").trim();
  const userText = String(input.userText || "").trim();
  const assistantText = String(input.assistantText || "").trim();
  if (!projectPath || (!userText && !assistantText)) return null;
  return {
    ts: String(input.ts || new Date().toISOString()),
    mode: String(input.mode || "chat").trim() || "chat",
    provider: String(input.provider || "").trim(),
    model: String(input.model || "").trim(),
    projectPath,
    userText: compactMemoryText(userText, 6000),
    assistantText: compactMemoryText(assistantText, 6000)
  };
}

function appendChatHistoryEntry(input) {
  const entry = normalizeHistoryEntry(input);
  if (!entry) return;
  const store = loadChatHistoryStore();
  const key = entry.projectPath;
  const list = Array.isArray(store.projects[key]) ? store.projects[key] : [];
  list.push(entry);
  if (list.length > chatHistoryPerProjectLimit) {
    store.projects[key] = list.slice(list.length - chatHistoryPerProjectLimit);
  } else {
    store.projects[key] = list;
  }
  saveChatHistoryStore(store);
  appendChatHistoryLog(entry);
}

function appendChatHistoryLog(entry) {
  try {
    fs.mkdirSync(path.dirname(chatHistoryLogPath), { recursive: true });
    fs.appendFileSync(chatHistoryLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (_error) {
    // ignore
  }
}

function historyEntriesToMessages(entries) {
  const output = [];
  (Array.isArray(entries) ? entries : []).forEach((item) => {
    const entry = normalizeHistoryEntry(item);
    if (!entry) return;
    if (entry.userText) output.push({ role: "user", content: entry.userText });
    if (entry.assistantText) output.push({ role: "assistant", content: entry.assistantText });
  });
  return output;
}

function compactMemoryText(text, maxChars) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function buildProjectResponse(projectPath, diagnostics) {
  if (!projectPath) {
    return {
      enabled: false,
      path: "",
      workspaceDir: "",
      diagnostics: diagnostics || { enabled: false, skipped: true }
    };
  }
  return {
    enabled: true,
    path: projectPath,
    workspaceDir: getGlobalWorkspaceDir(),
    diagnostics: diagnostics || {}
  };
}

function normalizeProjectRootPath(input, fallbackRoot) {
  const value = String(input || "").trim();
  if (!value) return path.normalize(fallbackRoot);
  const expanded = expandHomeDir(value);
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(fallbackRoot, expanded);
  return path.normalize(absolute);
}

function normalizeProjectRootList(input, fallbackRoot) {
  const list = parseStringListFlexible(input);
  const normalized = list
    .map((item) => normalizeProjectRootPath(item, fallbackRoot))
    .filter(Boolean);
  if (!normalized.length) {
    return [path.normalize(fallbackRoot)];
  }
  return normalized;
}

function normalizeProjectName(input) {
  const name = String(input || "").trim();
  if (!name) {
    throw new Error("项目名不能为空");
  }
  if (name.length > 80) {
    throw new Error("项目名过长，最多 80 个字符");
  }
  if (/[\\/]/.test(name)) {
    throw new Error("项目名不能包含 / 或 \\");
  }
  if (name === "." || name === ".." || name.includes("..")) {
    throw new Error("项目名不能包含 ..");
  }
  if (!/^[\p{L}\p{N}._\-\s]+$/u.test(name)) {
    throw new Error("项目名仅允许中英文、数字、空格、点、下划线、连字符");
  }
  return name;
}

function resolveProjectParentDir(input, projectsConfig) {
  const raw = String(input || "").trim();
  if (!raw) return path.normalize(projectsConfig.defaultRoot);
  const expanded = expandHomeDir(raw);
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(projectsConfig.defaultRoot, expanded);
  return path.normalize(absolute);
}

function normalizeProjectTemplate(input) {
  const value = String(input || "basic").trim().toLowerCase();
  if (value === "node" || value === "python") return value;
  return "basic";
}

function scaffoldProjectFiles(projectPath, projectName, template) {
  const createdFiles = [];
  const writeFile = (relativePath, content) => {
    const absPath = path.join(projectPath, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf8");
    createdFiles.push(relativePath);
  };

  writeFile(
    "README.md",
    [
      `# ${projectName}`,
      "",
      `项目模板：${template}`,
      "",
      `创建时间：${new Date().toISOString()}`,
      ""
    ].join("\n")
  );

  writeFile(
    ".vscode/settings.json",
    `${JSON.stringify(
      {
        "workbench.sideBar.location": "left",
        "workbench.activityBar.visible": true,
        "workbench.activityBar.location": "default",
        "workbench.statusBar.visible": true,
        "chatgpt.localeOverride": "zh-cn",
        "chatgpt.openOnStartup": true
      },
      null,
      2
    )}\n`
  );
  writeFile(
    ".vscode/extensions.json",
    `${JSON.stringify(
      {
        recommendations: ["openai.chatgpt", "ms-ceintl.vscode-language-pack-zh-hans"]
      },
      null,
      2
    )}\n`
  );

  if (template === "node") {
    writeFile(
      "package.json",
      `${JSON.stringify(
        {
          name: sanitizePackageName(projectName),
          version: "0.1.0",
          private: true,
          scripts: {
            start: "node src/index.js"
          }
        },
        null,
        2
      )}\n`
    );
    writeFile(
      "src/index.js",
      [
        'console.log("Hello from OpenClaw project.");',
        ""
      ].join("\n")
    );
    writeFile(
      ".gitignore",
      ["node_modules/", ".env", "dist/", ""].join("\n")
    );
  }

  if (template === "python") {
    writeFile(
      "main.py",
      ['print("Hello from OpenClaw project.")', ""].join("\n")
    );
    writeFile("requirements.txt", "# add dependencies here\n");
    writeFile(
      ".gitignore",
      ["__pycache__/", ".venv/", ".env", "*.pyc", ""].join("\n")
    );
  }

  return createdFiles;
}

function sanitizePackageName(input) {
  const raw = String(input || "").trim().toLowerCase();
  const value = raw
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/^\.+/, "")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return value || "openclaw-project";
}

function isPathUnderAllowedRoots(targetPath, allowedRoots) {
  return allowedRoots.some((rootPath) => isPathInside(targetPath, rootPath));
}

function isPathInside(targetPath, rootPath) {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(rootPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function expandHomeDir(filePath) {
  const value = String(filePath || "").trim();
  if (value.startsWith("~/")) {
    return path.join(userHome, value.slice(2));
  }
  return value;
}

function buildStartupSequenceContext(config) {
  const normalized = normalizeStartupSequenceConfig(config);
  const diagnostics = {
    enabled: normalized.enabled,
    filesConfigured: normalized.files.length,
    filesLoaded: 0,
    filesMissing: 0,
    truncated: false,
    totalChars: 0,
    loadedPaths: [],
    missingPaths: []
  };

  if (!normalized.enabled || !normalized.files.length) {
    return { text: "", diagnostics };
  }

  let remaining = normalized.maxTotalChars;
  const blocks = [];

  normalized.files.forEach((filePath) => {
    if (remaining <= 0) {
      diagnostics.truncated = true;
      return;
    }

    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (_error) {
      diagnostics.filesMissing += 1;
      diagnostics.missingPaths.push(filePath);
      return;
    }

    const normalizedText = String(content || "").replace(/\r\n/g, "\n").trim();
    if (!normalizedText) {
      diagnostics.filesLoaded += 1;
      diagnostics.loadedPaths.push(filePath);
      return;
    }

    let limited = normalizedText;
    if (limited.length > normalized.maxCharsPerFile) {
      limited = limited.slice(0, normalized.maxCharsPerFile);
      diagnostics.truncated = true;
    }
    if (limited.length > remaining) {
      limited = limited.slice(0, remaining);
      diagnostics.truncated = true;
    }
    if (!limited) {
      diagnostics.truncated = true;
      return;
    }

    blocks.push(`[必读文件] ${filePath}\n${limited}`);
    remaining -= limited.length;
    diagnostics.totalChars += limited.length;
    diagnostics.filesLoaded += 1;
    diagnostics.loadedPaths.push(filePath);
  });

  if (!blocks.length) {
    return { text: "", diagnostics };
  }

  const text = [
    "【启动序列】以下是当前环境的必读文件内容，请先遵守其中约束再回答。",
    blocks.join("\n\n-----\n\n")
  ].join("\n\n");

  return { text, diagnostics };
}

function mergePromptText(base, extra) {
  const baseText = String(base || "").trim();
  const extraText = String(extra || "").trim();
  if (baseText && extraText) return `${baseText}\n\n${extraText}`;
  return baseText || extraText;
}

function loadBridgeEnvForUi() {
  const parsed = parseEnvText(fs.existsSync(bridgeEnvPath) ? fs.readFileSync(bridgeEnvPath, "utf8") : "");
  return normalizeBridgeEnvForUi(parsed);
}

function normalizeBridgeEnvForUi(input) {
  const source = input && typeof input === "object" ? input : {};
  const output = {};

  bridgeEnvKeys.forEach((key) => {
    output[key] = String(source[key] || "").trim();
  });

  Object.entries(source).forEach(([key, value]) => {
    if (!(key in output) && /^[A-Z_][A-Z0-9_]*$/.test(key)) {
      output[key] = String(value || "").trim();
    }
  });

  return output;
}

function parseEnvText(text) {
  const output = {};
  String(text || "")
    .split(/\r?\n/g)
    .forEach((line) => {
      const raw = line.trim();
      if (!raw || raw.startsWith("#")) return;
      const idx = raw.indexOf("=");
      if (idx <= 0) return;
      const key = raw.slice(0, idx).trim();
      let value = raw.slice(idx + 1);
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      output[key] = value.trim();
    });
  return output;
}

function saveBridgeEnvForUi(env) {
  const value = normalizeBridgeEnvForUi(env);
  fs.mkdirSync(path.dirname(bridgeEnvPath), { recursive: true });

  const orderedKeys = [
    ...bridgeEnvKeys,
    ...Object.keys(value)
      .filter((key) => !bridgeEnvKeys.includes(key))
      .sort()
  ];

  const lines = [];
  orderedKeys.forEach((key) => {
    if (!(key in value)) return;
    const normalized = String(value[key] || "").trim();
    lines.push(`${key}=${formatEnvValue(normalized)}`);
  });

  fs.writeFileSync(bridgeEnvPath, `${lines.join("\n")}\n`, "utf8");
  try {
    fs.chmodSync(bridgeEnvPath, 0o600);
  } catch (_error) {
    // ignore chmod failures on non-posix fs
  }
}

function formatEnvValue(value) {
  if (!value) return "";
  if (!/[\s#"\\]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function resolveSecretInput(rawValue, envMap) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.startsWith("$")) {
    const envName = value.slice(1).trim();
    return String(envMap?.[envName] || process.env[envName] || "").trim();
  }
  if (value.startsWith("env:")) {
    const envName = value.slice(4).trim();
    return String(envMap?.[envName] || process.env[envName] || "").trim();
  }
  return value;
}

function loadTelegramWebhookHealthState() {
  try {
    const raw = loadJsonFileSafe(telegramWebhookHealthStatePath);
    return normalizeTelegramWebhookHealthState(raw);
  } catch (_error) {
    return normalizeTelegramWebhookHealthState({});
  }
}

function normalizeTelegramWebhookHealthState(input) {
  const source = input && typeof input === "object" ? input : {};
  const counters = source.counters && typeof source.counters === "object" ? source.counters : {};
  return {
    version: 1,
    counters: {
      received: clampInt(counters.received, 0, 0, 1_000_000_000),
      forwarded: clampInt(counters.forwarded, 0, 0, 1_000_000_000),
      failed: clampInt(counters.failed, 0, 0, 1_000_000_000),
      secretMismatch: clampInt(counters.secretMismatch, 0, 0, 1_000_000_000)
    },
    lastReceivedAt: String(source.lastReceivedAt || "").trim(),
    lastForwardedAt: String(source.lastForwardedAt || "").trim(),
    lastFailedAt: String(source.lastFailedAt || "").trim(),
    lastSecretMismatchAt: String(source.lastSecretMismatchAt || "").trim(),
    lastError: String(source.lastError || "").trim().slice(0, 240),
    events: normalizeTelegramWebhookHealthEvents(source.events)
  };
}

function normalizeTelegramWebhookHealthEvents(input) {
  const list = Array.isArray(input) ? input : [];
  return list
    .map((item) => normalizeTelegramWebhookHealthEvent(item))
    .filter(Boolean)
    .slice(0, telegramWebhookHealthEventLimit);
}

function normalizeTelegramWebhookHealthEvent(input) {
  const value = input && typeof input === "object" ? input : {};
  const type = String(value.type || "").trim();
  if (!type) return null;
  return {
    time: String(value.time || "").trim() || new Date().toISOString(),
    type,
    statusCode: clampInt(value.statusCode, 0, 0, 999),
    durationMs: clampInt(value.durationMs, 0, 0, 60 * 60 * 1000),
    detail: String(value.detail || "").trim().slice(0, 240)
  };
}

function pushTelegramWebhookHealthEvent(state, input) {
  const event = normalizeTelegramWebhookHealthEvent(input);
  if (!event) return;
  const list = Array.isArray(state.events) ? state.events : [];
  state.events = [event, ...list].slice(0, telegramWebhookHealthEventLimit);
}

function saveTelegramWebhookHealthState(state) {
  const normalized = normalizeTelegramWebhookHealthState(state);
  telegramWebhookHealthState = normalized;
  try {
    fs.mkdirSync(path.dirname(telegramWebhookHealthStatePath), { recursive: true });
    fs.writeFileSync(telegramWebhookHealthStatePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  } catch (_error) {
    // ignore
  }
}

function normalizeBridgeWebhookPath(input) {
  const raw = String(input || "").trim();
  if (!raw) return "/telegram/webhook";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function extractPathFromUrl(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return normalizeWebhookProxyPath(parsed.pathname || "/");
  } catch (_error) {
    return "";
  }
}

function resolveTelegramWebhookHealthConfig() {
  const raw = fs.existsSync(bridgeConfigPath)
    ? loadJsonFileSafe(bridgeConfigPath)
    : loadJsonFileSafe(bridgeExampleConfigPath);
  const value = raw && typeof raw === "object" ? raw : {};
  const telegram = value.telegram && typeof value.telegram === "object" ? value.telegram : {};
  const webhook = telegram.webhook && typeof telegram.webhook === "object" ? telegram.webhook : {};
  const env = loadBridgeEnvForUi();

  const mode = String(telegram.mode || "polling").trim().toLowerCase() === "webhook" ? "webhook" : "polling";
  const apiBase = String(telegram.apiBase || "https://api.telegram.org")
    .trim()
    .replace(/\/+$/, "");
  const botToken = resolveSecretInput(telegram.botToken, env);
  const secretToken = resolveSecretInput(webhook.secretToken, env);
  const publicUrl = String(webhook.publicUrl || process.env.TELEGRAM_WEBHOOK_PUBLIC_URL || "").trim();
  const publicPathFromUrl = extractPathFromUrl(publicUrl);
  const bridgePath = normalizeBridgeWebhookPath(webhook.path || "/telegram/webhook");
  const listenHost = String(webhook.listenHost || "127.0.0.1").trim() || "127.0.0.1";
  const listenPort = clampInt(webhook.listenPort, 4174, 1, 65535);
  const localPathFromProxy = extractPathFromUrl(telegramWebhookLocalUrl);
  const allowedChatCount = parseStringListFlexible(telegram.allowedChatIds).length;

  return {
    telegram: {
      enabled: !!telegram.enabled,
      mode,
      apiBase: apiBase || "https://api.telegram.org",
      allowedChatCount
    },
    bridge: {
      botToken,
      botTokenConfigured: !!botToken,
      secretToken,
      secretConfigured: !!secretToken,
      webhookEnabled: webhook.enabled !== false,
      publicUrl,
      publicPathFromUrl,
      bridgePath,
      listenHost,
      listenPort,
      expectedLocalUrl: `http://${listenHost}:${listenPort}${bridgePath}`
    },
    proxy: {
      publicPath: telegramWebhookPublicPath,
      localUrl: telegramWebhookLocalUrl,
      localPathFromProxy,
      timeoutMs: telegramWebhookProxyTimeoutMs
    },
    checks: {
      proxyPathMatchesPublicUrl: !publicPathFromUrl || publicPathFromUrl === telegramWebhookPublicPath,
      proxyLocalPathMatchesBridgePath: !localPathFromProxy || localPathFromProxy === bridgePath
    }
  };
}

function buildTelegramWebhookHealthSummary(config, state, telegramApi) {
  const counters = state?.counters || {};
  const received = Number(counters.received || 0);
  const forwarded = Number(counters.forwarded || 0);
  const failed = Number(counters.failed || 0);
  const mismatch = Number(counters.secretMismatch || 0);
  let tone = "good";
  let label = "Webhook 运行正常";
  let detail = `累计接收 ${received}，成功转发 ${forwarded}，失败 ${failed}，密钥不匹配 ${mismatch}。`;

  if (!config.telegram.enabled) {
    tone = "warn";
    label = "Telegram 未启用";
    detail = "bridge.config.json 中 telegram.enabled=false，当前不会接收 Telegram 回调。";
    return { tone, label, detail };
  }
  if (config.telegram.mode !== "webhook") {
    tone = "warn";
    label = "当前不是 Webhook 模式";
    detail = "telegram.mode 不是 webhook，请切到 webhook 才能使用该自检页。";
    return { tone, label, detail };
  }
  if (!config.bridge.botTokenConfigured) {
    tone = "danger";
    label = "Bot Token 未配置";
    detail = "telegram.botToken 为空（或引用的环境变量不存在），Webhook 无法正常工作。";
    return { tone, label, detail };
  }
  if (failed > 0 && failed >= Math.max(1, forwarded)) {
    tone = "warn";
    label = "Webhook 存在失败记录";
  } else if (received === 0) {
    tone = "warn";
    label = "Webhook 已配置，尚未收到回调";
  }
  if (telegramApi?.ok && telegramApi?.lastErrorMessage) {
    tone = tone === "good" ? "warn" : tone;
    label = tone === "warn" ? "Telegram 官方返回最近错误" : label;
  }
  return { tone, label, detail };
}

function toIsoFromUnixSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

async function fetchTelegramWebhookInfoForHealth(config) {
  if (!config?.bridge?.botToken) {
    return {
      ok: false,
      error: "botToken 未配置，无法调用 getWebhookInfo"
    };
  }
  try {
    const endpoint = `${config.telegram.apiBase}/bot${config.bridge.botToken}/getWebhookInfo`;
    const data = await requestJson(endpoint, {
      method: "GET",
      timeoutMs: 25000
    });
    if (!data?.ok) {
      throw new Error(String(data?.description || "Telegram 返回失败"));
    }
    const result = data.result && typeof data.result === "object" ? data.result : {};
    return {
      ok: true,
      url: String(result.url || "").trim(),
      hasCustomCertificate: !!result.has_custom_certificate,
      pendingUpdateCount: clampInt(result.pending_update_count, 0, 0, 1_000_000_000),
      maxConnections: clampInt(result.max_connections, 0, 0, 500),
      ipAddress: String(result.ip_address || "").trim(),
      allowedUpdates: Array.isArray(result.allowed_updates) ? result.allowed_updates.map((item) => String(item || "").trim()).filter(Boolean) : [],
      lastErrorDate: toIsoFromUnixSeconds(result.last_error_date),
      lastErrorMessage: String(result.last_error_message || "").trim(),
      lastSyncErrorDate: toIsoFromUnixSeconds(result.last_synchronization_error_date)
    };
  } catch (error) {
    return {
      ok: false,
      error: formatErrorMessage(error)
    };
  }
}

function deriveTelegramWebhookWarnings(config, state, telegramApi) {
  const warnings = [];
  if (!config.telegram.enabled) warnings.push("Telegram 未启用（telegram.enabled=false）");
  if (config.telegram.mode !== "webhook") warnings.push("Telegram 当前不是 Webhook 模式");
  if (!config.bridge.botTokenConfigured) warnings.push("telegram.botToken 未配置或环境变量为空");
  if (!config.bridge.publicUrl) warnings.push("telegram.webhook.publicUrl 为空");
  if (!config.checks.proxyPathMatchesPublicUrl) {
    warnings.push(`公网 URL 路径与代理入口不一致：${config.bridge.publicPathFromUrl} vs ${config.proxy.publicPath}`);
  }
  if (!config.checks.proxyLocalPathMatchesBridgePath) {
    warnings.push(`代理本地路径与 bridge webhook.path 不一致：${config.proxy.localPathFromProxy} vs ${config.bridge.bridgePath}`);
  }
  if (Number(state?.counters?.secretMismatch || 0) > 0) {
    warnings.push("历史上出现过 secret_token 不匹配，请确认 TG_WEBHOOK_SECRET 与 bridge 配置一致");
  }
  if (telegramApi?.ok && telegramApi?.lastErrorMessage) {
    warnings.push(`Telegram 官方最近错误：${telegramApi.lastErrorMessage}`);
  } else if (telegramApi && !telegramApi.ok) {
    warnings.push(`Telegram 官方状态读取失败：${telegramApi.error || "unknown"}`);
  }
  return warnings;
}

async function buildTelegramWebhookHealthSnapshot(req) {
  const config = resolveTelegramWebhookHealthConfig();
  const state = normalizeTelegramWebhookHealthState(telegramWebhookHealthState);
  const telegramApi = await fetchTelegramWebhookInfoForHealth(config);
  const summary = buildTelegramWebhookHealthSummary(config, state, telegramApi);
  const warnings = deriveTelegramWebhookWarnings(config, state, telegramApi);

  return {
    ok: true,
    now: new Date().toISOString(),
    summary,
    warnings,
    proxy: {
      publicPath: config.proxy.publicPath,
      localUrl: config.proxy.localUrl,
      timeoutMs: config.proxy.timeoutMs
    },
    bridge: {
      service: getBridgeServiceStatus(),
      telegram: {
        enabled: config.telegram.enabled,
        mode: config.telegram.mode,
        apiBase: config.telegram.apiBase,
        allowedChatCount: config.telegram.allowedChatCount,
        botTokenConfigured: config.bridge.botTokenConfigured,
        webhook: {
          enabled: config.bridge.webhookEnabled,
          publicUrl: config.bridge.publicUrl,
          hasSecretToken: config.bridge.secretConfigured,
          path: config.bridge.bridgePath,
          listenHost: config.bridge.listenHost,
          listenPort: config.bridge.listenPort,
          expectedLocalUrl: config.bridge.expectedLocalUrl
        }
      }
    },
    checks: config.checks,
    counters: state.counters,
    latest: {
      lastReceivedAt: state.lastReceivedAt,
      lastForwardedAt: state.lastForwardedAt,
      lastFailedAt: state.lastFailedAt,
      lastSecretMismatchAt: state.lastSecretMismatchAt,
      lastError: state.lastError
    },
    events: state.events.slice(0, 50),
    telegramApi,
    paths: {
      healthStatePath: telegramWebhookHealthStatePath,
      bridgeConfigPath,
      bridgeEnvPath
    },
    origin: {
      requestOrigin: getRequestOrigin(req)
    }
  };
}

function getServicesLinkContext(req) {
  const localOrigin127 = `http://127.0.0.1:${port}`;
  const localOriginLocalhost = `http://localhost:${port}`;
  const currentOrigin = getRequestOrigin(req);
  const publicOrigin = derivePrimaryPublicOrigin(req);
  const webIdePublicOrigin = deriveWebIdePublicOrigin(req);
  const normalizedCurrentOrigin = normalizeOptionalOrigin(currentOrigin);
  const currentHost = normalizedCurrentOrigin ? new URL(normalizedCurrentOrigin).hostname : "";
  const currentIsLocal = isLocalHostName(currentHost);
  const appOrigin = currentIsLocal ? localOrigin127 : publicOrigin || normalizedCurrentOrigin || localOrigin127;
  const appLinkKind = currentIsLocal ? "local" : "public";
  const fileOrigin = fileManagerPublicOrigin || "";
  const fileEntryOrigin = fileOrigin || "https://file.qxyx.net";
  const vpnOrigin = fileOrigin || appOrigin;
  const vpnLinkKind = fileOrigin ? "public" : appLinkKind;
  const guestOrigin = guestPublicOrigin || "";

  const groups = [
    {
      id: "main",
      title: "常用入口",
      items: [
        makeDashboardLink("对话页", `${appOrigin}/chat.html`, "最常用的对话入口", appLinkKind),
        makeDashboardLink("服务导航", `${appOrigin}/services.html`, "统一查看所有服务入口和状态", appLinkKind),
        makeDashboardLink("配置台", `${appOrigin}/index.html`, "模型与接入配置", appLinkKind),
        makeDashboardLink("codex模型", `${appOrigin}/model-api.html`, "快速接入 Base URL + API Key", appLinkKind),
        makeDashboardLink("SSH工具", `${appOrigin}/ssh.html`, "批量管理 VPS", appLinkKind),
        makeDashboardLink("网页终端", `${appOrigin}/terminal.html`, "网页命令行终端", appLinkKind),
        webIdePublicOrigin
          ? makeDashboardLink("Web IDE", webIdePublicOrigin, "公网版 Web IDE / code-server", "public", { featured: true })
          : makeDashboardLink("Web IDE", "http://127.0.0.1:18080", "网页版 VS Code，仅本机直接访问", "local", { featured: true })
      ]
    },
    {
      id: "ops",
      title: "运维与排查",
      items: [
        makeDashboardLink("节点转换器", `${vpnOrigin}/vpn-convert.html`, "订阅链接、原始节点转 Clash / Base64", vpnLinkKind),
        makeDashboardLink("订阅管理", `${vpnOrigin}/vpn-subscriptions.html`, "批量管理常用订阅链接", vpnLinkKind),
        makeDashboardLink("隧道巡检", `${appOrigin}/cloudflared.html`, "检查 cloudflared 是否 DIRECT", appLinkKind),
        makeDashboardLink("Webhook 自检", `${appOrigin}/telegram-webhook.html`, "检查 Telegram Webhook 连通性与回调统计", appLinkKind),
        makeDashboardLink("网络检测", `${appOrigin}/network.html`, "判断访问链路更像国内还是国外", appLinkKind),
        makeDashboardLink("管理员", `${appOrigin}/admin.html`, "访客链接与管理入口", appLinkKind),
        makeDashboardLink("文件管理", `${fileEntryOrigin}/`, "统一文件入口（https://file.qxyx.net/*）", "public"),
        makeDashboardLink("上传中心", `${fileEntryOrigin}/`, "统一文件入口（https://file.qxyx.net/*）", "public")
      ]
    },
    {
      id: "public",
      title: "公网入口",
      items: [
        publicOrigin ? makeDashboardLink("主站公网", publicOrigin, "Cloudflare Tunnel 主入口", "public") : null,
        webIdePublicOrigin ? makeDashboardLink("Web IDE 公网", webIdePublicOrigin, "code-server 公网入口", "public", { featured: true }) : null,
        fileOrigin ? makeDashboardLink("文件公网", fileOrigin, "公开下载与文件入口", "public") : null,
        guestOrigin ? makeDashboardLink("访客入口", guestOrigin, "体验链接与访客页", "public") : null
      ].filter(Boolean)
    },
    currentIsLocal
      ? {
      id: "compat",
      title: "本机专用",
      items: [
        makeDashboardLink("Web IDE", "http://127.0.0.1:18080", "网页版 VS Code，仅本机直接访问", "local"),
        makeDashboardLink("127.0.0.1 访问", `${localOrigin127}/services.html`, "本机回环地址", "local"),
        makeDashboardLink("localhost 访问", `${localOriginLocalhost}/services.html`, "同机浏览器也可用 localhost 访问", "local"),
        currentOrigin ? makeDashboardLink("当前访问源", `${currentOrigin.replace(/\/+$/, "")}/services.html`, "当前浏览器访问本页的源地址", "current") : null
      ].filter(Boolean)
      }
      : {
      id: "compat",
      title: "本机专用",
      items: [
        makeDashboardLink("Web IDE", "http://127.0.0.1:18080", "这个地址仅在家里这台机器本机浏览器可直接打开", "local"),
        makeDashboardLink("127.0.0.1 访问", `${localOrigin127}/services.html`, "仅本机可访问，不适合远程点击", "local"),
        makeDashboardLink("localhost 访问", `${localOriginLocalhost}/services.html`, "仅本机可访问，不适合远程点击", "local"),
        currentOrigin ? makeDashboardLink("当前访问源", `${currentOrigin.replace(/\/+$/, "")}/services.html`, "当前浏览器访问本页的源地址", "current") : null
      ].filter(Boolean)
      }
  ];

  return {
    now: new Date().toISOString(),
    origins: {
      local127: localOrigin127,
      localhost: localOriginLocalhost,
      current: currentOrigin,
      public: publicOrigin,
      webIdePublic: webIdePublicOrigin,
      file: fileOrigin,
      guest: guestOrigin
    },
    groups
  };
}

function getServicesLinksSnapshot(req) {
  const base = getServicesLinkContext(req);
  return {
    ok: true,
    now: base.now,
    summary: {
      tone: "warn",
      label: "入口已就绪",
      detail: "常用入口已加载，服务状态正在后台刷新。"
    },
    origins: base.origins,
    services: [],
    groups: base.groups,
    cloudflared: {
      label: "加载中",
      detail: "正在读取 cloudflared 与 systemd 状态。",
      allDirect: false,
      count: 0,
      timerHealthy: false
    }
  };
}

function getServicesDashboardSnapshot(req) {
  const base = getServicesLinkContext(req);
  const webStatus = getSystemdUserUnitStatus(webServiceName);
  const webIdeStatus = getSystemdUserUnitStatus(webIdeServiceName);
  const bridgeStatus = getBridgeServiceStatus();
  const tunnelServices = cloudflaredServiceNames.map((unit) => getSystemdUserUnitStatus(unit));
  const tunnelTimer = getSystemdUserTimerStatus(cloudflaredGuardTimerName);
  const guardService = getSystemdUserUnitStatus(cloudflaredGuardServiceName);
  const cloudflared = getCloudflaredGuardSnapshot({
    services: tunnelServices,
    guardService,
    guardTimer: tunnelTimer
  });

  const services = [
    toDashboardServiceItem({
      id: "web",
      name: "OpenClaw 网页服务",
      unit: webServiceName,
      status: webStatus,
      detail: "本机 4173 端口，承载配置台、对话页、SSH 工具、文件页。"
    }),
    toDashboardServiceItem({
      id: "web_ide",
      name: "Web IDE",
      unit: webIdeServiceName,
      status: webIdeStatus,
      detail: "网页版 VS Code / code-server。"
    }),
    toDashboardServiceItem({
      id: "bridge",
      name: "聊天桥接服务",
      unit: bridgeServiceName,
      status: bridgeStatus,
      detail: "Telegram 等聊天软件桥接。"
    }),
    ...tunnelServices.map((status, index) =>
      toDashboardServiceItem({
        id: `cloudflared_${index + 1}`,
        name: index === 0 ? "Cloudflared 主隧道" : "Cloudflared 副本隧道",
        unit: status.unit,
        status,
        detail: "Cloudflare Tunnel 公网入口。"
      })
    ),
    toDashboardServiceItem({
      id: "cloudflared_guard",
      name: "Cloudflared 巡检 Timer",
      unit: cloudflaredGuardTimerName,
      status: tunnelTimer,
      detail: "定时确保 cloudflared 始终走 DIRECT。"
    })
  ];

  const onlineCount = services.filter((item) => item.ok).length;
  const totalCount = services.length;
  const summaryTone = cloudflared?.summary?.tone === "danger" || onlineCount < totalCount ? "warn" : "good";

  return {
    ok: true,
    now: new Date().toISOString(),
    summary: {
      tone: summaryTone,
      label: summaryTone === "good" ? "主要服务运行正常" : "部分服务需要留意",
      detail: `共 ${totalCount} 个关键服务，当前在线 ${onlineCount} 个。cloudflared 状态：${cloudflared?.summary?.label || "未知"}。`
    },
    origins: base.origins,
    services,
    groups: base.groups,
    cloudflared: {
      label: cloudflared?.summary?.label || "",
      detail: cloudflared?.summary?.detail || "",
      allDirect: !!cloudflared?.mihomo?.allDirect,
      count: Number(cloudflared?.mihomo?.count || 0),
      timerHealthy: !!cloudflared?.guard?.timer?.healthy
    }
  };
}

function toDashboardServiceItem({ id, name, unit, status, detail }) {
  const activeState = String(status?.activeState || "").trim();
  const ok = !!status?.healthy || !!status?.active;
  return {
    id,
    name,
    unit: unit || status?.unit || "",
    ok,
    tone: ok ? "good" : "warn",
    state: status?.healthLabel || activeState || "unknown",
    enabled: !!status?.enabled,
    detail: detail || "",
    extra: status?.statusText ? summarizeStatusText(status.statusText) : status?.message || "",
    updatedAt: status?.stateChangedAt || status?.lastRunAt || ""
  };
}

function summarizeStatusText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, 2).join(" ");
}

function makeDashboardLink(name, url, description, kind, options = {}) {
  return {
    name,
    url,
    description,
    kind: kind || "local",
    featured: !!options.featured
  };
}

function getServiceLogs(unit, lines = 60) {
  const safeUnit = String(unit || "").trim();
  if (!safeUnit) {
    return {
      ok: false,
      unit: "",
      lines: [],
      text: "",
      error: "缺少服务单元"
    };
  }
  if (!hasCommand("journalctl")) {
    return {
      ok: false,
      unit: safeUnit,
      lines: [],
      text: "",
      error: "journalctl 不可用"
    };
  }

  const result = spawnSync("journalctl", ["--user", "-u", safeUnit, "-n", String(lines), "--no-pager"], {
    encoding: "utf8"
  });
  const text = String(result.stdout || result.stderr || result.error?.message || "").trim();
  return {
    ok: result.status === 0,
    unit: safeUnit,
    lineLimit: lines,
    lines: text ? text.split(/\r?\n/) : [],
    text,
    error: result.status === 0 ? "" : text || "读取日志失败"
  };
}

function derivePrimaryPublicOrigin(req) {
  const explicit = normalizeOptionalOrigin(String(process.env.OPENCLAW_PUBLIC_ORIGIN || "").trim());
  if (explicit) return explicit;

  const currentOrigin = getRequestOrigin(req);
  try {
    const currentUrl = new URL(currentOrigin);
    const host = String(currentUrl.hostname || "").trim().toLowerCase();
    if (host && !isLocalHostName(host) && host !== "file.qxyx.net" && host !== "guest.qxyx.net") {
      return currentUrl.origin;
    }
  } catch (_error) {}

  const derivedFromFile = deriveSiblingOrigin(fileManagerPublicOrigin, "file.", "claw.");
  if (derivedFromFile) return derivedFromFile;
  const derivedFromGuest = deriveSiblingOrigin(guestPublicOrigin, "guest.", "claw.");
  if (derivedFromGuest) return derivedFromGuest;
  return "";
}

function deriveSiblingOrigin(originText, fromPrefix, toPrefix) {
  const origin = normalizeOptionalOrigin(originText);
  if (!origin) return "";
  try {
    const parsed = new URL(origin);
    const hostname = String(parsed.hostname || "").trim().toLowerCase();
    if (!hostname.startsWith(fromPrefix)) return "";
    parsed.hostname = `${toPrefix}${hostname.slice(fromPrefix.length)}`;
    return parsed.origin;
  } catch (_error) {
    return "";
  }
}

function getRuntimeCachedValue(cacheKey, ttlMs, loader) {
  const now = Date.now();
  const cached = runtimeCache.get(cacheKey);
  if (cached && now - cached.ts < ttlMs) {
    return cached.value;
  }
  const value = loader();
  runtimeCache.set(cacheKey, { ts: now, value });
  return value;
}

function deriveWebIdePublicOrigin(req) {
  const explicit = normalizeOptionalOrigin(String(process.env.OPENCLAW_WEB_IDE_PUBLIC_ORIGIN || "").trim());
  if (explicit) return explicit;

  const currentOrigin = normalizeOptionalOrigin(getRequestOrigin(req));
  if (currentOrigin) {
    const currentToIde = deriveSiblingOrigin(currentOrigin, "claw.", "ide.");
    if (currentToIde) return currentToIde;
  }

  const primary = derivePrimaryPublicOrigin(req);
  const fromPrimary = deriveSiblingOrigin(primary, "claw.", "ide.");
  if (fromPrimary) return fromPrimary;

  const fromFile = deriveSiblingOrigin(fileManagerPublicOrigin, "file.", "ide.");
  if (fromFile) return fromFile;

  const fromGuest = deriveSiblingOrigin(guestPublicOrigin, "guest.", "ide.");
  if (fromGuest) return fromGuest;

  return "";
}

function isLocalHostName(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function getCloudflaredGuardSnapshot(preloaded = null) {
  const buildSnapshot = () => {
    const services =
      Array.isArray(preloaded?.services) && preloaded.services.length
        ? preloaded.services
        : cloudflaredServiceNames.map((unit) => getSystemdUserUnitStatus(unit));
    const guardService = preloaded?.guardService || getSystemdUserUnitStatus(cloudflaredGuardServiceName);
    const guardTimer = preloaded?.guardTimer || getSystemdUserTimerStatus(cloudflaredGuardTimerName);
    const directStatus = getCloudflaredDirectConnectionsStatus();
    const overrideStatus = getCloudflaredOverrideStatus();
    const log = readCloudflaredGuardLogTail(40);
    const eventHealth = getCloudflaredTunnelEventHealth();
    const activeTunnelCount = services.filter((item) => item.active).length;

    let tone = "warn";
    let label = "待确认";
    let detail = "请先查看隧道、定时器和 Mihomo 连接状态。";

    if (directStatus.allDirect && activeTunnelCount === services.length && guardTimer.active) {
      tone = "good";
      label = "cloudflared 直连正常";
      detail = "当前已确认 cloudflared 连接走 DIRECT，巡检 timer 也在运行。";
    } else if (activeTunnelCount !== services.length) {
      tone = "danger";
      label = "隧道未全部在线";
      detail = "至少有一个 cloudflared 服务未处于 active，建议先执行修复。";
    } else if (directStatus.hasCloudflaredConnections && !directStatus.allDirect) {
      tone = "danger";
      label = "cloudflared 未完全直连";
      detail = "Mihomo 已检测到 cloudflared 连接，但其中至少一条没有走 DIRECT。";
    } else if (!guardTimer.active) {
      tone = "warn";
      label = "巡检 timer 未运行";
      detail = "cloudflared 当前可能可用，但定时巡检没有处于 active。";
    } else if (!directStatus.hasCloudflaredConnections) {
      tone = "good";
      label = "隧道在线，等待流量检测";
      detail = "cloudflared 服务已在线，但当前未从 Mihomo 连接表看到可用于校验的 cloudflared 流量。这通常表示当前没有公网访问，或当前网络环境不会把 cloudflared 进程流量记到 Mihomo 连接表。";
    }
    if (eventHealth.available) {
      if (eventHealth.dropCount15m > 0 && !eventHealth.autoRecovered) {
        tone = "danger";
        label = "隧道最近有掉线且未恢复";
        detail = `最近 15 分钟掉线 ${eventHealth.dropCount15m} 次，最近 1 小时掉线 ${eventHealth.dropCount60m} 次。`;
      } else if (eventHealth.dropCount60m > 0) {
        if (tone === "good") tone = "warn";
        detail = `${detail} 最近 1 小时掉线 ${eventHealth.dropCount60m} 次，已自动恢复。`;
      }
    }

    return {
      ok: true,
      now: new Date().toISOString(),
      summary: {
        tone,
        label,
        detail
      },
      services,
      guard: {
        service: guardService,
        timer: guardTimer,
        scriptPath: cloudflaredGuardScriptPath,
        logPath: cloudflaredGuardLogPath
      },
      alert: {
        telegram: getCloudflaredTelegramAlertPublicState()
      },
      events: eventHealth,
      mihomo: directStatus,
      override: overrideStatus,
      log
    };
  };

  if (preloaded) return buildSnapshot();
  return getRuntimeCachedValue("cloudflared-guard-snapshot", serviceStatusCacheTtlMs, buildSnapshot);
}

function getSystemdUserUnitStatus(unitName) {
  const unit = String(unitName || "").trim();
  if (!unit) {
    return {
      available: false,
      unit: "",
      active: false,
      enabled: false,
      message: "缺少 unit 名称"
    };
  }

  return getRuntimeCachedValue(`systemd-unit:${unit}`, serviceStatusCacheTtlMs, () => {
    if (!hasCommand("systemctl")) {
      return {
        available: false,
        unit,
        active: false,
        enabled: false,
        message: "systemctl 不可用"
      };
    }

    const showResult = runSystemctlUser([
      "show",
      unit,
      "--property=Id,Description,LoadState,ActiveState,SubState,UnitFileState,Result,FragmentPath,StateChangeTimestamp,ExecMainCode,ExecMainStatus"
    ]);
    const statusResult = runSystemctlUser(["status", unit, "--no-pager", "--lines=8"]);
    const showMap = parseSystemdShowOutput(showResult.stdout);
    const unitFileState = String(showMap.UnitFileState || "").trim();
    const activeState = String(showMap.ActiveState || "").trim();
    const result = String(showMap.Result || "").trim();
    const oneshotReady = unit.endsWith(".service") && unitFileState === "static" && activeState === "inactive" && result === "success";
    const healthy = activeState === "active" || oneshotReady;

    return {
      available: showResult.ok || statusResult.ok,
      unit,
      description: String(showMap.Description || "").trim(),
      loadState: String(showMap.LoadState || "").trim() || "unknown",
      activeState: activeState || "inactive",
      subState: String(showMap.SubState || "").trim(),
      unitFileState,
      enabled: unitFileState === "enabled",
      active: activeState === "active",
      healthy,
      healthLabel: activeState === "active" ? "运行中" : oneshotReady ? "待命" : activeState || "unknown",
      result,
      fragmentPath: String(showMap.FragmentPath || "").trim(),
      stateChangedAt: normalizeSystemdTimestamp(showMap.StateChangeTimestamp),
      execMainCode: String(showMap.ExecMainCode || "").trim(),
      execMainStatus: String(showMap.ExecMainStatus || "").trim(),
      statusText: (statusResult.stdout || statusResult.stderr || showResult.stderr || "").trim(),
      error: showResult.ok ? "" : showResult.stderr || ""
    };
  });
}

function getSystemdUserTimerStatus(unitName) {
  return getRuntimeCachedValue(`systemd-timer:${unitName}`, serviceStatusCacheTtlMs, () => {
    const status = getSystemdUserUnitStatus(unitName);
    if (!status.available || !hasCommand("systemctl")) {
      return status;
    }

    const showResult = runSystemctlUser([
      "show",
      unitName,
      "--property=NextElapseUSecRealtime,LastTriggerUSec,Triggers,TriggeredBy"
    ]);
    const showMap = parseSystemdShowOutput(showResult.stdout);

    return {
      ...status,
      nextRunAt: normalizeSystemdTimestamp(showMap.NextElapseUSecRealtime),
      lastRunAt: normalizeSystemdTimestamp(showMap.LastTriggerUSec),
      triggers: String(showMap.Triggers || "").trim(),
      triggeredBy: String(showMap.TriggeredBy || "").trim()
    };
  });
}

function parseSystemdShowOutput(text) {
  const output = {};
  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) return;
      const index = trimmed.indexOf("=");
      if (index <= 0) return;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      output[key] = value;
    });
  return output;
}

function normalizeSystemdTimestamp(value) {
  const text = String(value || "").trim();
  if (!text || text === "n/a" || text === "[not set]") return "";
  return text;
}

function findMihomoSocketPath() {
  if (!hasCommand("bash")) return "";
  const result = spawnSync("bash", ["-lc", "ls -1t /tmp/mihomo-party-*.sock 2>/dev/null"], {
    encoding: "utf8"
  });
  if (result.status !== 0) return "";
  const candidates = String(result.stdout || "")
    .split(/\r?\n/)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const socketPath of candidates) {
    const probe = spawnSync("curl", ["--unix-socket", socketPath, "-fsS", "http://localhost/connections"], {
      encoding: "utf8"
    });
    if (probe.status === 0) {
      return socketPath;
    }
  }
  return "";
}

function getCloudflaredDirectConnectionsStatus() {
  const socketPath = findMihomoSocketPath();
  if (!socketPath) {
    return {
      available: false,
      socketPath: "",
      hasCloudflaredConnections: false,
      allDirect: false,
      count: 0,
      connections: [],
      message: "未发现 Mihomo 控制 socket"
    };
  }
  if (!commandExists("curl")) {
    return {
      available: false,
      socketPath,
      hasCloudflaredConnections: false,
      allDirect: false,
      count: 0,
      connections: [],
      message: "curl 不可用，无法读取 Mihomo 连接表"
    };
  }

  const result = spawnSync("curl", ["--unix-socket", socketPath, "-fsS", "http://localhost/connections"], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return {
      available: false,
      socketPath,
      hasCloudflaredConnections: false,
      allDirect: false,
      count: 0,
      connections: [],
      message: String(result.stderr || result.error?.message || "读取 Mihomo 连接表失败").trim()
    };
  }

  let data = {};
  try {
    data = result.stdout ? JSON.parse(result.stdout) : {};
  } catch (_error) {
    return {
      available: false,
      socketPath,
      hasCloudflaredConnections: false,
      allDirect: false,
      count: 0,
      connections: [],
      message: "Mihomo 返回了非 JSON 数据"
    };
  }

  const list = Array.isArray(data.connections) ? data.connections : [];
  const cloudflared = list.filter((item) => String(item?.metadata?.process || "").trim().toLowerCase().includes("cloudflared"));
  const connections = cloudflared.map((item) => {
    const chains = Array.isArray(item?.chains) ? item.chains.map((value) => String(value || "")) : [];
    return {
      id: String(item?.id || "").trim(),
      rule: String(item?.rule || "").trim(),
      rulePayload: String(item?.rulePayload || "").trim(),
      chains,
      destination: [item?.metadata?.host, item?.metadata?.destinationIP]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" / "),
      process: String(item?.metadata?.process || "").trim()
    };
  });
  const allDirect = connections.length > 0 && connections.every((item) => item.chains.includes("DIRECT"));

  return {
    available: true,
    socketPath,
    hasCloudflaredConnections: connections.length > 0,
    allDirect,
    count: connections.length,
    connections,
    message: connections.length ? "" : "当前未发现 cloudflared 连接"
  };
}

function getCloudflaredOverrideStatus() {
  const overrideFileText = safeReadTextFile(cloudflaredDirectOverridePath);
  const overrideRegistryText = safeReadTextFile(mihomoOverrideConfigPath);
  const profileText = safeReadTextFile(mihomoProfileConfigPath);
  const workText = safeReadTextFile(mihomoWorkConfigPath);
  const currentProfileIdMatch = profileText.match(/^current:\s*(\S+)\s*$/m);
  const currentProfileId = currentProfileIdMatch ? currentProfileIdMatch[1] : "";
  const currentProfileBlock = currentProfileId ? getProfileBlockById(profileText, currentProfileId) : "";
  const rule1 = "PROCESS-NAME,cloudflared";
  const rule2 = "PROCESS-NAME-WILDCARD,cloudflared*";

  return {
    overrideFilePath: cloudflaredDirectOverridePath,
    overrideFileExists: fs.existsSync(cloudflaredDirectOverridePath),
    overrideRulesReady: overrideFileText.includes(rule1) && overrideFileText.includes(rule2),
    registryPath: mihomoOverrideConfigPath,
    registryExists: fs.existsSync(mihomoOverrideConfigPath),
    registered: overrideRegistryText.includes(`id: ${cloudflaredDirectOverrideId}`) && overrideRegistryText.includes("global: true"),
    profilePath: mihomoProfileConfigPath,
    currentProfileId,
    profileBound: currentProfileBlock.includes(cloudflaredDirectOverrideId),
    workConfigPath: mihomoWorkConfigPath,
    workRulesPresent: workText.includes(rule1) && workText.includes(rule2)
  };
}

function getProfileBlockById(profileText, profileId) {
  const text = String(profileText || "");
  const id = String(profileId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^  - id: ${id}\\n(?:^[ ]{4}.*\\n?)*)`, "m");
  const match = text.match(pattern);
  return match ? match[1] : "";
}

function safeReadTextFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch (_error) {
    return "";
  }
}

function readCloudflaredGuardLogTail(maxLines = 40) {
  const raw = safeReadTextFile(cloudflaredGuardLogPath);
  const lines = raw ? raw.split(/\r?\n/).filter(Boolean) : [];
  return {
    path: cloudflaredGuardLogPath,
    exists: fs.existsSync(cloudflaredGuardLogPath),
    lines: lines.slice(-Math.max(1, maxLines)),
    updatedAt: getFileIsoMtime(cloudflaredGuardLogPath)
  };
}

function getCloudflaredTunnelEventHealth() {
  if (!commandExists("journalctl")) {
    return {
      available: false,
      tone: "warn",
      healthLabel: "无法读取日志",
      summary: "系统缺少 journalctl，无法统计隧道健康事件。",
      lookbackHours: cloudflaredEventLookbackHours,
      dropCount15m: 0,
      dropCount60m: 0,
      dropCount24h: 0,
      retryCount24h: 0,
      recoverCount24h: 0,
      autoRecovered: false,
      lastDropAt: "",
      lastRecoverAt: "",
      lastRetryAt: "",
      recentEvents: []
    };
  }

  const result = spawnSync("journalctl", [
    "--user",
    ...cloudflaredServiceNames.flatMap((unit) => ["-u", unit]),
    "--since",
    `${cloudflaredEventLookbackHours} hours ago`,
    "--no-pager",
    "--output=short-iso"
  ], {
    encoding: "utf8"
  });

  const raw = String(result.stdout || "").trim();
  const lines = raw ? raw.split(/\r?\n/) : [];
  const nowMs = Date.now();
  const window15m = 15 * 60 * 1000;
  const window60m = 60 * 60 * 1000;
  const window24h = cloudflaredEventLookbackHours * 60 * 60 * 1000;

  const events = [];
  for (const line of lines) {
    const event = parseCloudflaredEventLine(line);
    if (event) events.push(event);
  }

  const dropEvents = events.filter((item) => item.type === "drop");
  const retryEvents = events.filter((item) => item.type === "retry");
  const recoverEvents = events.filter((item) => item.type === "recover");

  const dropCount15m = dropEvents.filter((item) => nowMs - item.timestampMs <= window15m).length;
  const dropCount60m = dropEvents.filter((item) => nowMs - item.timestampMs <= window60m).length;
  const dropCount24h = dropEvents.filter((item) => nowMs - item.timestampMs <= window24h).length;
  const retryCount24h = retryEvents.filter((item) => nowMs - item.timestampMs <= window24h).length;
  const recoverCount24h = recoverEvents.filter((item) => nowMs - item.timestampMs <= window24h).length;
  const lastDropAt = getLastEventIso(dropEvents);
  const lastRecoverAt = getLastEventIso(recoverEvents);
  const lastRetryAt = getLastEventIso(retryEvents);
  const autoRecovered = !!(lastDropAt && lastRecoverAt && Date.parse(lastRecoverAt) > Date.parse(lastDropAt));

  let tone = "good";
  let healthLabel = "稳定";
  let summary = "最近未发现掉线异常。";
  if (dropCount15m > 0 && !autoRecovered) {
    tone = "danger";
    healthLabel = "波动中";
    summary = `最近 15 分钟掉线 ${dropCount15m} 次，暂未观测到恢复事件。`;
  } else if (dropCount15m > 0) {
    tone = "warn";
    healthLabel = "有波动已恢复";
    summary = `最近 15 分钟掉线 ${dropCount15m} 次，当前已自动恢复。`;
  } else if (dropCount60m > 0) {
    tone = "warn";
    healthLabel = "最近有波动";
    summary = `最近 1 小时掉线 ${dropCount60m} 次，当前已恢复。`;
  }

  return {
    available: true,
    tone,
    healthLabel,
    summary,
    lookbackHours: cloudflaredEventLookbackHours,
    dropCount15m,
    dropCount60m,
    dropCount24h,
    retryCount24h,
    recoverCount24h,
    autoRecovered,
    lastDropAt,
    lastRecoverAt,
    lastRetryAt,
    recentEvents: events.slice(-25).reverse()
  };
}

function parseCloudflaredEventLine(line) {
  const text = String(line || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  let type = "";
  if (lower.includes("registered tunnel connection")) {
    type = "recover";
  } else if (lower.includes("retrying connection")) {
    type = "retry";
  } else if (cloudflaredDropEventKeywords.some((keyword) => lower.includes(keyword))) {
    type = "drop";
  }
  if (!type) return null;

  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  const iso = isoMatch ? isoMatch[1] : "";
  const timestampMs = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(timestampMs)) return null;

  return {
    type,
    time: new Date(timestampMs).toISOString(),
    timestampMs,
    message: text
  };
}

function getLastEventIso(events) {
  if (!Array.isArray(events) || !events.length) return "";
  const last = events[events.length - 1];
  return String(last?.time || "").trim();
}

function getCloudflaredTelegramAlertPublicState() {
  const target = resolveCloudflaredTelegramAlertTarget();
  const state = normalizeCloudflaredTelegramAlertState(cloudflaredTelegramAlertState);
  return {
    enabled: target.enabled,
    reason: target.reason || "",
    apiBase: target.apiBase || "",
    chatCount: Array.isArray(target.chatIds) ? target.chatIds.length : 0,
    running: cloudflaredTelegramAlertRunning,
    checkIntervalMs: cloudflaredTelegramAlertCheckIntervalMs,
    minIntervalMs: cloudflaredTelegramAlertMinIntervalMs,
    consecutiveThreshold: cloudflaredTelegramAlertConsecutiveThreshold,
    consecutiveUnhealthy: state.consecutiveUnhealthy,
    lastStatus: state.lastStatus,
    lastObservedAt: state.lastObservedAt,
    lastAlertAt: state.lastAlertAt,
    lastRecoveryAt: state.lastRecoveryAt,
    lastSendError: state.lastSendError
  };
}

function loadCloudflaredTelegramAlertState() {
  try {
    const raw = loadJsonFileSafe(cloudflaredTelegramAlertStatePath);
    return normalizeCloudflaredTelegramAlertState(raw);
  } catch (_error) {
    return normalizeCloudflaredTelegramAlertState({});
  }
}

function normalizeCloudflaredTelegramAlertState(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    version: 1,
    lastStatus: String(source.lastStatus || "unknown").trim() || "unknown",
    consecutiveUnhealthy: clampInt(source.consecutiveUnhealthy, 0, 0, 100000),
    lastObservedAt: String(source.lastObservedAt || "").trim(),
    lastAlertKey: String(source.lastAlertKey || "").trim(),
    lastAlertAt: String(source.lastAlertAt || "").trim(),
    lastRecoveryKey: String(source.lastRecoveryKey || "").trim(),
    lastRecoveryAt: String(source.lastRecoveryAt || "").trim(),
    alerting: source.alerting === true,
    lastSendError: String(source.lastSendError || "").trim()
  };
}

function saveCloudflaredTelegramAlertState(state) {
  const normalized = normalizeCloudflaredTelegramAlertState(state);
  cloudflaredTelegramAlertState = normalized;
  try {
    fs.mkdirSync(path.dirname(cloudflaredTelegramAlertStatePath), { recursive: true });
    fs.writeFileSync(cloudflaredTelegramAlertStatePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  } catch (_error) {
    // ignore
  }
}

function resolveCloudflaredTelegramAlertTarget() {
  const bridgeConfig = loadBridgeConfigForUi();
  const env = loadBridgeEnvForUi();
  const enabled = parseBooleanEnv(
    process.env.OPENCLAW_CLOUDFLARED_TG_ALERT_ENABLED,
    bridgeConfig.telegram.enabled
  );
  const apiBase = String(
    process.env.OPENCLAW_CLOUDFLARED_TG_ALERT_API_BASE || bridgeConfig.telegram.apiBase || "https://api.telegram.org"
  )
    .trim()
    .replace(/\/+$/, "");
  const tokenInput =
    String(process.env.OPENCLAW_CLOUDFLARED_TG_ALERT_BOT_TOKEN || "").trim() || bridgeConfig.telegram.botToken;
  const botToken = resolveSecretInput(tokenInput, env);
  const chatIdsFromEnv = parseStringListFlexible(process.env.OPENCLAW_CLOUDFLARED_TG_ALERT_CHAT_IDS || "");
  const chatIds = (chatIdsFromEnv.length ? chatIdsFromEnv : bridgeConfig.telegram.allowedChatIds || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (!enabled) {
    return { enabled: false, reason: "已关闭（OPENCLAW_CLOUDFLARED_TG_ALERT_ENABLED=0）", apiBase, botToken: "", chatIds: [] };
  }
  if (!botToken) {
    return { enabled: false, reason: "缺少 Telegram Bot Token", apiBase, botToken: "", chatIds: [] };
  }
  if (!chatIds.length) {
    return { enabled: false, reason: "未配置 Telegram chatId 白名单", apiBase, botToken: "", chatIds: [] };
  }
  return { enabled: true, reason: "", apiBase, botToken, chatIds };
}

async function runCloudflaredTelegramAlertCheck(trigger = "timer") {
  if (cloudflaredTelegramAlertRunning) return;
  cloudflaredTelegramAlertRunning = true;
  try {
    const target = resolveCloudflaredTelegramAlertTarget();
    if (!target.enabled) return;

    const snapshot = getCloudflaredGuardSnapshot();
    const summary = snapshot?.summary || {};
    const events = snapshot?.events || {};
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const state = normalizeCloudflaredTelegramAlertState(cloudflaredTelegramAlertState);
    const lastAlertAtMs = state.lastAlertAt ? Date.parse(state.lastAlertAt) : 0;
    const lastRecoveryAtMs = state.lastRecoveryAt ? Date.parse(state.lastRecoveryAt) : 0;
    const wasAlerting = state.alerting === true;
    const unhealthy =
      summary.tone === "danger" || (Number(events.dropCount15m || 0) > 0 && events.autoRecovered !== true);

    state.lastObservedAt = nowIso;
    state.lastStatus = unhealthy ? "danger" : "good";

    if (unhealthy) {
      state.consecutiveUnhealthy = clampInt((state.consecutiveUnhealthy || 0) + 1, 1, 0, 100000);
      const thresholdReached = state.consecutiveUnhealthy >= cloudflaredTelegramAlertConsecutiveThreshold;
      state.alerting = thresholdReached || wasAlerting;
      const alertKey = `${events.lastDropAt || "none"}|${events.dropCount15m || 0}|${summary.label || ""}`;
      const shouldSend = state.alerting && alertKey !== state.lastAlertKey && nowMs - lastAlertAtMs >= cloudflaredTelegramAlertMinIntervalMs;
      if (shouldSend) {
        const text = buildCloudflaredTelegramAlertText(snapshot, trigger);
        const sent = await sendTelegramTextToTargets(target, text, { disableNotification: false });
        if (sent.ok) {
          state.lastAlertKey = alertKey;
          state.lastAlertAt = nowIso;
          state.lastSendError = "";
        } else {
          state.lastSendError = sent.failures.map((item) => `${item.chatId}: ${item.error}`).join(" | ").slice(0, 500);
        }
      }
      saveCloudflaredTelegramAlertState(state);
      return;
    }

    state.consecutiveUnhealthy = 0;

    if (state.alerting) {
      const recoverKey = `${events.lastRecoverAt || nowIso}|${summary.label || "ok"}`;
      const shouldSendRecovery =
        recoverKey !== state.lastRecoveryKey && nowMs - lastRecoveryAtMs >= Math.max(60 * 1000, cloudflaredTelegramAlertMinIntervalMs / 2);
      if (shouldSendRecovery) {
        const text = buildCloudflaredTelegramRecoveryText(snapshot, trigger);
        const sent = await sendTelegramTextToTargets(target, text, { disableNotification: true });
        if (sent.ok) {
          state.lastRecoveryKey = recoverKey;
          state.lastRecoveryAt = nowIso;
          state.alerting = false;
          state.lastSendError = "";
        } else {
          state.lastSendError = sent.failures.map((item) => `${item.chatId}: ${item.error}`).join(" | ").slice(0, 500);
        }
      }
    }

    saveCloudflaredTelegramAlertState(state);
  } catch (error) {
    const state = normalizeCloudflaredTelegramAlertState(cloudflaredTelegramAlertState);
    state.lastSendError = String(error?.message || error || "unknown").trim().slice(0, 500);
    state.lastObservedAt = new Date().toISOString();
    saveCloudflaredTelegramAlertState(state);
  } finally {
    cloudflaredTelegramAlertRunning = false;
  }
}

function buildCloudflaredTelegramAlertText(snapshot, trigger) {
  const summary = snapshot?.summary || {};
  const events = snapshot?.events || {};
  const state = normalizeCloudflaredTelegramAlertState(cloudflaredTelegramAlertState);
  return [
    "OpenClaw 隧道告警",
    `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    `触发：${trigger}`,
    `状态：${summary.label || "异常"}`,
    `详情：${summary.detail || "-"}`,
    `连续异常：${state.consecutiveUnhealthy}/${cloudflaredTelegramAlertConsecutiveThreshold}`,
    `15分钟掉线：${events.dropCount15m ?? "-"}`,
    `1小时掉线：${events.dropCount60m ?? "-"}`,
    `最后掉线：${events.lastDropAt ? new Date(events.lastDropAt).toLocaleString("zh-CN", { hour12: false }) : "-"}`,
    `自动恢复：${events.autoRecovered ? "是" : "否"}`
  ].join("\n");
}

function buildCloudflaredTelegramRecoveryText(snapshot, trigger) {
  const summary = snapshot?.summary || {};
  const events = snapshot?.events || {};
  return [
    "OpenClaw 隧道恢复",
    `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    `触发：${trigger}`,
    `状态：${summary.label || "已恢复"}`,
    `详情：${summary.detail || "-"}`,
    `最近15分钟掉线：${events.dropCount15m ?? "-"}`,
    `最后恢复：${events.lastRecoverAt ? new Date(events.lastRecoverAt).toLocaleString("zh-CN", { hour12: false }) : "-"}`
  ].join("\n");
}

async function sendTelegramTextToTargets(target, text, options = {}) {
  const payloadText = String(text || "").trim();
  if (!payloadText) {
    return { ok: false, sent: 0, failed: 0, failures: [{ chatId: "", error: "消息内容为空" }] };
  }
  const endpoint = `${target.apiBase}/bot${target.botToken}/sendMessage`;
  const failures = [];
  let sent = 0;

  for (const chatId of target.chatIds) {
    try {
      const data = await requestJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 30000,
        body: {
          chat_id: chatId,
          text: payloadText,
          disable_notification: options.disableNotification === true,
          disable_web_page_preview: true
        }
      });
      if (!data?.ok) {
        throw new Error(String(data?.description || "Telegram 返回失败"));
      }
      sent += 1;
    } catch (error) {
      failures.push({
        chatId,
        error: String(error?.message || error || "unknown").trim().slice(0, 240)
      });
    }
  }

  return {
    ok: sent > 0 && failures.length === 0,
    sent,
    failed: failures.length,
    failures
  };
}

function getFileIsoMtime(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    return fs.statSync(filePath).mtime.toISOString();
  } catch (_error) {
    return "";
  }
}

function runCloudflaredGuardScript() {
  if (!fs.existsSync(cloudflaredGuardScriptPath)) {
    return {
      ok: false,
      command: cloudflaredGuardScriptPath,
      code: 1,
      stdout: "",
      stderr: "修复脚本不存在"
    };
  }
  const result = spawnSync("bash", [cloudflaredGuardScriptPath], {
    encoding: "utf8",
    cwd: root
  });
  return {
    ok: result.status === 0,
    command: `bash ${cloudflaredGuardScriptPath}`,
    code: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || result.error?.message || "").trim()
  };
}

function restartCloudflaredServices() {
  if (!hasCommand("systemctl")) {
    return {
      ok: false,
      command: "systemctl --user restart ...",
      code: 1,
      stdout: "",
      stderr: "systemctl 不可用，无法重启隧道"
    };
  }
  const result = runSystemctlUser(["restart", ...cloudflaredServiceNames]);
  return {
    ok: result.ok,
    command: `systemctl --user restart ${cloudflaredServiceNames.join(" ")}`,
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function getBridgeServiceStatus() {
  return getRuntimeCachedValue(`bridge-status:${bridgeServiceName}`, serviceStatusCacheTtlMs, () => {
    if (!hasCommand("systemctl")) {
      return {
        available: false,
        active: false,
        enabled: false,
        unit: bridgeServiceName,
        message: "systemctl 不可用"
      };
    }

    const status = getSystemdUserUnitStatus(bridgeServiceName);
    return {
      ...status,
      available: true,
      activeRaw: status.activeState || status.error || "",
      enabledRaw: status.unitFileState || ""
    };
  });
}

function hasCommand(command) {
  return getRuntimeCachedValue(`has-command:${command}`, commandCheckCacheTtlMs, () => {
    const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
      stdio: "ignore"
    });
    return result.status === 0;
  });
}

function runSystemctlUser(args) {
  const result = spawnSync("systemctl", ["--user", ...args], {
    encoding: "utf8"
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || result.error?.message || "").trim()
  };
}

function prewarmDashboardCaches() {
  try {
    hasCommand("systemctl");
    getSystemdUserUnitStatus(webServiceName);
    getSystemdUserUnitStatus(webIdeServiceName);
    getBridgeServiceStatus();
    cloudflaredServiceNames.forEach((unit) => getSystemdUserUnitStatus(unit));
    getSystemdUserUnitStatus(cloudflaredGuardServiceName);
    getSystemdUserTimerStatus(cloudflaredGuardTimerName);
    getCloudflaredGuardSnapshot();
  } catch (_error) {
    // 预热失败不影响主服务
  }
}

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`OpenClaw 模型配置台已启动：http://localhost:${port} (bind ${host})`);
  setTimeout(() => {
    prewarmDashboardCaches();
  }, 300);
});
