const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { loadTaskExecutorConfig, tryExecuteTaskFromText } = require("./task-executor");

const AZURE_OPENAI_API_VERSION = "2024-10-21";
const DEFAULT_CONFIG_PATH = path.join(__dirname, "bridge.config.json");
const MAX_MESSAGE_LENGTH = 3500;
const userHome = os.homedir();
const startupSequencePath = path.join(userHome, ".config", "openclaw", "startup-sequence.json");
const startupSequenceDefaults = {
  enabled: false,
  maxCharsPerFile: 6000,
  maxTotalChars: 18000,
  files: []
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

const conversationStore = new Map();
const feishuSeenEventIds = new Map();
const telegramIgnoredChatLogStore = new Map();
let feishuTenantTokenCache = { token: "", expiresAt: 0 };

async function main() {
  const configPath = process.env.BRIDGE_CONFIG || DEFAULT_CONFIG_PATH;
  const config = loadBridgeConfig(configPath);

  logInfo(`已加载配置: ${configPath}`);
  logInfo(`模型: ${config.model.provider} / ${config.model.model}`);

  let started = false;
  if (config.telegram.enabled) {
    started = true;
    if (config.telegram.mode === "webhook") {
      startBridgeHttpServer(config);
      await setupTelegramWebhook(config);
    } else {
      startTelegramLoop(config).catch((error) => {
        logError(`Telegram 轮询异常: ${error.message}`);
        process.exitCode = 1;
      });
    }
  }

  if (config.feishu.enabled) {
    started = true;
    startBridgeHttpServer(config);
  }

  if (!started) {
    logError("没有启用任何平台。请在 bridge.config.json 里设置 telegram.enabled 或 feishu.enabled 为 true。");
    process.exitCode = 1;
    return;
  }

  process.on("SIGINT", () => {
    logInfo("收到 SIGINT，正在退出...");
    process.exit(0);
  });
}

function loadBridgeConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}。请先复制 bridge.config.example.json -> bridge.config.json`);
  }

  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`配置文件不是有效 JSON: ${error.message}`);
  }

  const model = parsed.model || {};
  const telegram = parsed.telegram || {};
  const telegramWebhook = telegram.webhook || {};
  const feishu = parsed.feishu || {};
  const bot = parsed.bot || {};

  const resolvedModelApiKey = resolveSecretValue(model.apiKey);
  const resolvedTelegramBotToken = resolveSecretValue(telegram.botToken);
  const resolvedTelegramWebhookSecretToken = resolveSecretValue(telegramWebhook.secretToken);
  const resolvedFeishuAppId = resolveSecretValue(feishu.appId);
  const resolvedFeishuAppSecret = resolveSecretValue(feishu.appSecret);
  const resolvedFeishuVerifyToken = resolveSecretValue(feishu.verifyToken);
  const resolvedFeishuEncryptKey = resolveSecretValue(feishu.encryptKey);

  if (!model.provider || !model.baseUrl || !model.model) {
    throw new Error("model.provider / model.baseUrl / model.model 为必填");
  }

  if (!resolvedModelApiKey && model.provider !== "ollama") {
    throw new Error("model.apiKey 为空。仅 ollama 可不填");
  }

  return {
    model: {
      provider: String(model.provider),
      baseUrl: String(model.baseUrl).trim(),
      model: String(model.model).trim(),
      apiKey: resolvedModelApiKey,
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
      botToken: resolvedTelegramBotToken,
      apiBase: String(telegram.apiBase || "https://api.telegram.org").trim(),
      mode: String(telegram.mode || "polling").trim().toLowerCase() === "webhook" ? "webhook" : "polling",
      pollTimeoutSec: clampInt(telegram.pollTimeoutSec, 20, 1, 50),
      pollIntervalMs: clampInt(telegram.pollIntervalMs, 1200, 300, 15000),
      allowedChatIds: normalizeStringList(telegram.allowedChatIds),
      webhook: {
        enabled: telegramWebhook.enabled !== false,
        publicUrl: String(telegramWebhook.publicUrl || process.env.TELEGRAM_WEBHOOK_PUBLIC_URL || "").trim(),
        path: normalizeWebhookPath(telegramWebhook.path || "/telegram/webhook"),
        secretToken: String(resolvedTelegramWebhookSecretToken || "").trim(),
        dropPendingUpdates: telegramWebhook.dropPendingUpdates !== false,
        listenHost: String(telegramWebhook.listenHost || "127.0.0.1").trim() || "127.0.0.1",
        listenPort: clampInt(
          telegramWebhook.listenPort || process.env.TELEGRAM_WEBHOOK_LISTEN_PORT,
          4174,
          1,
          65535
        )
      }
    },
    feishu: {
      enabled: !!feishu.enabled,
      appId: resolvedFeishuAppId,
      appSecret: resolvedFeishuAppSecret,
      verifyToken: resolvedFeishuVerifyToken,
      encryptKey: resolvedFeishuEncryptKey,
      port: clampInt(feishu.port, 4174, 1, 65535),
      path: String(feishu.path || "/feishu/events"),
      allowedChatIds: normalizeStringList(feishu.allowedChatIds)
    }
  };
}

function normalizeStringList(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeWebhookPath(input) {
  const raw = String(input || "").trim();
  if (!raw) return "/telegram/webhook";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function resolveSecretValue(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (raw.startsWith("$")) {
    const envName = raw.slice(1).trim();
    if (!envName) return "";
    return String(process.env[envName] || "").trim();
  }

  if (raw.startsWith("env:")) {
    const envName = raw.slice(4).trim();
    if (!envName) return "";
    return String(process.env[envName] || "").trim();
  }

  return raw;
}

async function startTelegramLoop(config) {
  if (!config.telegram.botToken) {
    throw new Error("telegram.botToken 为空");
  }

  logInfo("Telegram 已启用，开始轮询消息");
  const apiPrefix = `${config.telegram.apiBase}/bot${config.telegram.botToken}`;
  let offset = 0;

  while (true) {
    try {
      const updates = await telegramGetUpdates(apiPrefix, offset, config.telegram.pollTimeoutSec);
      for (const update of updates) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        await handleTelegramUpdate(config, apiPrefix, update);
      }
    } catch (error) {
      const detail = formatErrorMessage(error);
      if (isTelegramTransientError(detail)) {
        logInfo(`Telegram 轮询网络波动: ${detail}`);
      } else {
        logError(`Telegram 轮询失败: ${detail}`);
      }
      await sleep(config.telegram.pollIntervalMs);
    }
  }
}

async function telegramGetUpdates(apiPrefix, offset, timeoutSec) {
  const url = `${apiPrefix}/getUpdates?offset=${offset}&timeout=${timeoutSec}`;
  const data = await requestJson(url, { method: "GET", timeoutMs: resolveTelegramRequestTimeoutMs(timeoutSec) });
  if (!data.ok) {
    throw new Error(`getUpdates 失败: ${data.description || "unknown"}`);
  }
  return Array.isArray(data.result) ? data.result : [];
}

async function handleTelegramUpdate(config, apiPrefix, update) {
  const msg = update.message || update.edited_message;
  if (!msg || typeof msg.text !== "string") return;

  const chatId = String(msg.chat?.id || "");
  if (!chatId) return;

  if (config.telegram.allowedChatIds.length && !config.telegram.allowedChatIds.includes(chatId)) {
    if (shouldLogIgnoredTelegramChat(chatId)) {
      logInfo(
        `Telegram 忽略消息：chatId=${chatId} 不在 allowedChatIds 中（已配置 ${config.telegram.allowedChatIds.length} 个）`
      );
    }
    return;
  }

  const userText = msg.text.trim();
  if (!userText) return;

  const reply = await handleIncomingMessage(config, {
    platform: "telegram",
    threadId: `telegram:${chatId}`,
    userText
  });
  if (!reply) return;

  await telegramSendText(apiPrefix, chatId, reply);
}

async function telegramSendText(apiPrefix, chatId, text) {
  for (const chunk of splitText(text, MAX_MESSAGE_LENGTH)) {
    const payload = { chat_id: chatId, text: chunk };
    const data = await requestJson(`${apiPrefix}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload
    });
    if (!data.ok) {
      throw new Error(`sendMessage 失败: ${data.description || "unknown"}`);
    }
  }
}

let bridgeHttpServer = null;

function startBridgeHttpServer(config) {
  if (bridgeHttpServer) return bridgeHttpServer;
  const listenHost = config.telegram?.mode === "webhook" ? config.telegram.webhook.listenHost : "127.0.0.1";
  const listenPort = config.telegram?.mode === "webhook" ? config.telegram.webhook.listenPort : config.feishu.port;
  if (config.feishu.enabled && (!config.feishu.appId || !config.feishu.appSecret)) {
    throw new Error("feishu.appId / feishu.appSecret 为空");
  }

  bridgeHttpServer = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const pathName = decodeURIComponent((req.url || "/").split("?")[0]);

    if (method === "GET" && pathName === "/healthz") {
      sendJson(res, 200, { ok: true, now: new Date().toISOString() });
      return;
    }

    if (config.telegram.enabled && config.telegram.mode === "webhook" && method === "POST" && pathName === config.telegram.webhook.path) {
      await handleTelegramWebhookRequest(config, req, res);
      return;
    }

    if (config.feishu.enabled && method === "POST" && pathName === config.feishu.path) {
      await handleFeishuEventRequest(config, req, res);
      return;
    }

    sendJson(res, 404, { error: "未找到资源" });
  });

  bridgeHttpServer.listen(listenPort, listenHost, () => {
    const parts = [];
    if (config.telegram.enabled && config.telegram.mode === "webhook") {
      parts.push(`Telegram webhook: http://${listenHost}:${listenPort}${config.telegram.webhook.path}`);
    }
    if (config.feishu.enabled) {
      parts.push(`飞书事件: http://${listenHost}:${listenPort}${config.feishu.path}`);
    }
    logInfo(`桥接 HTTP 服务已启动：${parts.join(" | ") || `http://${listenHost}:${listenPort}`}`);
  });

  return bridgeHttpServer;
}

async function setupTelegramWebhook(config) {
  if (!config.telegram.enabled || config.telegram.mode !== "webhook") return;
  const webhook = config.telegram.webhook || {};
  const publicUrl = String(webhook.publicUrl || "").trim();
  if (!publicUrl) {
    throw new Error("telegram.webhook.publicUrl 为空（Webhook 模式必填）");
  }
  const apiPrefix = `${config.telegram.apiBase}/bot${config.telegram.botToken}`;
  const payload = {
    url: publicUrl,
    drop_pending_updates: webhook.dropPendingUpdates !== false,
    allowed_updates: ["message", "edited_message"]
  };
  if (webhook.secretToken) payload.secret_token = webhook.secretToken;

  const data = await requestJson(`${apiPrefix}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    timeoutMs: 45000
  });
  if (!data.ok) {
    throw new Error(`Telegram setWebhook 失败: ${data.description || "unknown"}`);
  }
  logInfo(`Telegram 已切换为 Webhook：${publicUrl}`);
}

async function handleTelegramWebhookRequest(config, req, res) {
  try {
    const webhook = config.telegram.webhook || {};
    const expectedToken = String(webhook.secretToken || "").trim();
    const gotToken = String(req.headers["x-telegram-bot-api-secret-token"] || "").trim();
    if (expectedToken && gotToken !== expectedToken) {
      sendJson(res, 403, { ok: false, error: "telegram secret_token 不匹配" });
      return;
    }

    const payload = await readJsonBody(req);
    const apiPrefix = `${config.telegram.apiBase}/bot${config.telegram.botToken}`;
    await handleTelegramUpdate(config, apiPrefix, payload);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    logError(`Telegram webhook 处理失败: ${error.message}`);
    sendJson(res, 200, { ok: false });
  }
}

async function handleFeishuEventRequest(config, req, res) {
  try {
    const payload = await readJsonBody(req);
    if (payload.challenge) {
      if (!verifyFeishuToken(config, payload)) {
        sendJson(res, 403, { code: 403, msg: "token 验证失败" });
        return;
      }
      sendJson(res, 200, { challenge: payload.challenge });
      return;
    }

    if (!verifyFeishuToken(config, payload)) {
      sendJson(res, 403, { code: 403, msg: "token 验证失败" });
      return;
    }

    if (payload.encrypt) {
      sendJson(res, 200, {
        code: 0,
        msg: "收到加密事件。当前桥接服务未实现 decrypt，请在飞书事件订阅中关闭 encrypt。"
      });
      return;
    }

    const eventId = String(payload.header?.event_id || payload.event_id || "").trim();
    if (eventId && isFeishuEventHandled(eventId)) {
      sendJson(res, 200, { code: 0 });
      return;
    }
    if (eventId) markFeishuEventHandled(eventId);

    const eventType = String(payload.header?.event_type || "").trim();
    if (eventType !== "im.message.receive_v1") {
      sendJson(res, 200, { code: 0 });
      return;
    }

    const event = payload.event || {};
    const message = event.message || {};
    const chatId = String(message.chat_id || "").trim();
    if (!chatId) {
      sendJson(res, 200, { code: 0 });
      return;
    }

    if (config.feishu.allowedChatIds.length && !config.feishu.allowedChatIds.includes(chatId)) {
      sendJson(res, 200, { code: 0 });
      return;
    }

    const messageType = String(message.message_type || "").trim();
    if (messageType !== "text") {
      sendJson(res, 200, { code: 0 });
      return;
    }

    const userText = parseFeishuText(message.content);
    if (!userText) {
      sendJson(res, 200, { code: 0 });
      return;
    }

    sendJson(res, 200, { code: 0 });

    handleIncomingMessage(config, {
      platform: "feishu",
      threadId: `feishu:${chatId}`,
      userText
    })
      .then(async (replyText) => {
        if (!replyText) return;
        await feishuSendText(config, chatId, replyText);
      })
      .catch((error) => {
        logError(`飞书消息处理失败: ${error.message}`);
      });
  } catch (error) {
    sendJson(res, 400, { code: 400, msg: error.message || "请求无效" });
  }
}

function verifyFeishuToken(config, payload) {
  if (!config.feishu.verifyToken) return true;
  const token = String(payload.token || payload.header?.token || "").trim();
  return token === config.feishu.verifyToken;
}

function parseFeishuText(rawContent) {
  try {
    const parsed = JSON.parse(String(rawContent || "{}"));
    return String(parsed.text || "").trim();
  } catch (_error) {
    return "";
  }
}

async function feishuSendText(config, chatId, text) {
  const token = await getFeishuTenantToken(config);
  const endpoint = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id";
  for (const chunk of splitText(text, MAX_MESSAGE_LENGTH)) {
    await requestJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: chunk })
      }
    });
  }
}

async function getFeishuTenantToken(config) {
  if (Date.now() < feishuTenantTokenCache.expiresAt && feishuTenantTokenCache.token) {
    return feishuTenantTokenCache.token;
  }

  const data = await requestJson("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret
    }
  });

  const token = String(data.tenant_access_token || "").trim();
  const expiresInSec = clampInt(data.expire || data.expires_in, 3600, 300, 7200);
  if (!token) {
    throw new Error("飞书 tenant_access_token 获取失败");
  }

  feishuTenantTokenCache = {
    token,
    expiresAt: Date.now() + (expiresInSec - 120) * 1000
  };
  return token;
}

function isFeishuEventHandled(eventId) {
  cleanupFeishuEventStore();
  return feishuSeenEventIds.has(eventId);
}

function markFeishuEventHandled(eventId) {
  feishuSeenEventIds.set(eventId, Date.now());
}

function cleanupFeishuEventStore() {
  const now = Date.now();
  for (const [eventId, time] of feishuSeenEventIds) {
    if (now - time > 30 * 60 * 1000) {
      feishuSeenEventIds.delete(eventId);
    }
  }
}

async function handleIncomingMessage(config, input) {
  const text = String(input.userText || "").trim();
  if (!text) return "";

  if (text === "/help" || text === "帮助") {
    return [
      "可用指令：",
      "1) /reset 清空当前会话记忆",
      "2) /model 查看当前模型",
      "3) /run <命令> 自动执行本机命令",
      "4) 直接发送文本进行对话"
    ].join("\n");
  }

  if (text === "/model") {
    return `当前模型：${config.model.provider} / ${config.model.model}`;
  }

  if (text === "/chatid") {
    return `当前会话ID：${input.threadId}`;
  }

  if (text === "/reset") {
    conversationStore.delete(input.threadId);
    return "已清空当前会话记忆。";
  }

  const taskResult = await tryExecuteTaskFromText({
    text,
    config: loadTaskExecutorConfig(),
    cwd: __dirname,
    resolveNaturalLanguageCommand: async (inputText) =>
      resolveNaturalLanguageCommandByModel(config, inputText)
  });
  if (taskResult.handled) {
    return taskResult.reply;
  }

  const history = conversationStore.get(input.threadId) || [];
  history.push({ role: "user", content: text });
  const maxMessages = config.bot.historyTurns * 2;
  const compactHistory = history.slice(-maxMessages);
  const startupSequence = buildStartupSequenceContext(loadStartupSequenceConfig());
  const mergedSystemPrompt = mergePromptText(config.model.systemPrompt, startupSequence.text);

  try {
    const reply = await chatWithProvider({
      provider: config.model.provider,
      model: config.model.model,
      baseUrl: config.model.baseUrl,
      apiKey: config.model.apiKey,
      messages: compactHistory,
      systemPrompt: mergedSystemPrompt,
      temperature: config.model.temperature,
      maxTokens: config.model.maxTokens,
      topP: config.model.topP
    });
    compactHistory.push({ role: "assistant", content: reply });
    conversationStore.set(input.threadId, compactHistory.slice(-maxMessages));
    return reply;
  } catch (error) {
    logError(`${input.platform} 调用模型失败: ${error.message}`);
    return `请求失败：${error.message}`;
  }
}

async function resolveNaturalLanguageCommandByModel(config, text) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (!looksLikeTaskRequest(value)) return "";

  try {
    const raw = await chatWithProvider({
      provider: config.model.provider,
      model: config.model.model,
      baseUrl: config.model.baseUrl,
      apiKey: config.model.apiKey,
      messages: [{ role: "user", content: value }],
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

function joinUrl(base, pathname) {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(pathname, normalizedBase).toString();
}

async function requestJson(url, options = {}) {
  const transport = String(process.env.BRIDGE_HTTP_TRANSPORT || "auto")
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
    if (shouldTryCurlFallback && commandExists("curl")) {
      try {
        return await requestJsonByCurl(url, options);
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

  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (String(error && error.name) === "AbortError") {
      throw new Error(`网络请求超时（${timeoutMs}ms）`);
    }
    throw new Error(`网络请求失败：${formatErrorMessage(error)}`);
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
    const detail = data.error?.message || data.error || data.msg || data.message || rawText.slice(0, 200);
    throw new Error(`上游接口错误（${response.status}）：${detail}`);
  }

  return data;
}

async function requestJsonByCurl(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = options.headers || {};
  const body = options.body;
  const timeoutMs = clampInt(options.timeoutMs, 60000, 1000, 10 * 60 * 1000);

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

  const { stdout, stderr } = await execFileAsync("curl", args, {
    maxBuffer: 12 * 1024 * 1024
  });

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
    const detail =
      data.error?.message || data.error || data.msg || data.message || String(rawBody || "").slice(0, 200);
    throw new Error(`上游接口错误（${statusCode}）：${detail}`);
  }

  return data;
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

const commandExistsCache = new Map();

function commandExists(command) {
  const key = String(command || "").trim();
  if (!key) return false;
  if (commandExistsCache.has(key)) return commandExistsCache.get(key);
  try {
    const { spawnSync } = require("child_process");
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

function resolveRequestTimeoutMs(input) {
  if (input !== undefined) {
    return clampInt(input, 120000, 1000, 10 * 60 * 1000);
  }
  const envValue =
    process.env.BRIDGE_HTTP_TIMEOUT_MS ||
    process.env.OPENCLAW_HTTP_TIMEOUT_MS ||
    process.env.HTTP_TIMEOUT_MS ||
    "";
  return clampInt(envValue, 120000, 1000, 10 * 60 * 1000);
}

function resolveTelegramRequestTimeoutMs(timeoutSec) {
  const baseMs = (clampInt(timeoutSec, 20, 1, 120) + 15) * 1000;
  const envMs = clampInt(process.env.BRIDGE_TELEGRAM_REQUEST_TIMEOUT_MS, 65000, 5000, 10 * 60 * 1000);
  return Math.max(baseMs, envMs);
}

function isTelegramTransientError(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("timeout") ||
    text.includes("超时") ||
    text.includes("eai_again") ||
    text.includes("und_err_connect_timeout") ||
    text.includes("fetch failed") ||
    text.includes("tls handshake") ||
    text.includes("connection with edge closed")
  );
}

function shouldLogIgnoredTelegramChat(chatId) {
  cleanupTelegramIgnoredChatLogStore();
  if (telegramIgnoredChatLogStore.has(chatId)) return false;
  telegramIgnoredChatLogStore.set(chatId, Date.now());
  return true;
}

function cleanupTelegramIgnoredChatLogStore() {
  const now = Date.now();
  for (const [key, time] of telegramIgnoredChatLogStore) {
    if (now - time > 30 * 60 * 1000) {
      telegramIgnoredChatLogStore.delete(key);
    }
  }
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let rejected = false;

    req.on("data", (chunk) => {
      if (rejected) return;
      raw += chunk;
      if (raw.length > 1024 * 1024) {
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

function splitText(text, maxLength) {
  const source = String(text || "");
  if (source.length <= maxLength) return [source];

  const parts = [];
  let cursor = 0;
  while (cursor < source.length) {
    parts.push(source.slice(cursor, cursor + maxLength));
    cursor += maxLength;
  }
  return parts;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadStartupSequenceConfig() {
  if (!fs.existsSync(startupSequencePath)) {
    return normalizeStartupSequenceConfig({});
  }
  try {
    const raw = fs.readFileSync(startupSequencePath, "utf8");
    return normalizeStartupSequenceConfig(raw ? JSON.parse(raw) : {});
  } catch (_error) {
    return normalizeStartupSequenceConfig({});
  }
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
          return path.isAbsolute(normalized)
            ? path.normalize(normalized)
            : path.resolve(__dirname, normalized);
        })
        .filter(Boolean)
    )
  ).slice(0, 40);
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
    totalChars: 0
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
      return;
    }

    const normalizedText = String(content || "").replace(/\r\n/g, "\n").trim();
    if (!normalizedText) {
      diagnostics.filesLoaded += 1;
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

function logInfo(message) {
  console.log(`[${new Date().toISOString()}] INFO ${message}`);
}

function logError(message) {
  console.error(`[${new Date().toISOString()}] ERROR ${message}`);
}

main().catch((error) => {
  logError(error.message);
  process.exitCode = 1;
});
