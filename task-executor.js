const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const taskExecutorConfigPath = path.join(
  os.homedir(),
  ".config",
  "openclaw",
  "task-executor.json"
);

const defaults = {
  enabled: false,
  naturalLanguageEnabled: false,
  timeoutMs: 90000,
  maxOutputChars: 16000,
  workdir: "/home/weijin/codex/openclaw",
  shell: "/bin/bash",
  maxCommandLength: 2000
};

const blockedPatterns = [
  /\brm\s+-rf\s+\/($|\s)/i,
  /\bmkfs(\.|$)/i,
  /\bdd\s+if=.*\s+of=\/dev\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bchmod\s+-R\s+777\s+\/($|\s)/i
];

function getTaskExecutorConfigPath() {
  return taskExecutorConfigPath;
}

function loadTaskExecutorConfig() {
  try {
    if (!fs.existsSync(taskExecutorConfigPath)) {
      return normalizeTaskExecutorConfig({});
    }
    const raw = fs.readFileSync(taskExecutorConfigPath, "utf8");
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeTaskExecutorConfig(parsed);
  } catch (_error) {
    return normalizeTaskExecutorConfig({});
  }
}

function saveTaskExecutorConfig(input) {
  const value = normalizeTaskExecutorConfig(input);
  fs.mkdirSync(path.dirname(taskExecutorConfigPath), { recursive: true });
  fs.writeFileSync(taskExecutorConfigPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeTaskExecutorConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const timeoutMs = clampInt(source.timeoutMs, defaults.timeoutMs, 3000, 300000);
  const maxOutputChars = clampInt(source.maxOutputChars, defaults.maxOutputChars, 500, 200000);
  const maxCommandLength = clampInt(source.maxCommandLength, defaults.maxCommandLength, 50, 8000);
  const workdir = normalizeWorkdir(source.workdir);
  const shell = normalizeShell(source.shell);

  return {
    enabled: source.enabled === undefined ? defaults.enabled : !!source.enabled,
    naturalLanguageEnabled:
      source.naturalLanguageEnabled === undefined
        ? defaults.naturalLanguageEnabled
        : !!source.naturalLanguageEnabled,
    timeoutMs,
    maxOutputChars,
    workdir,
    shell,
    maxCommandLength
  };
}

function normalizeWorkdir(input) {
  const raw = String(input || "").trim();
  if (!raw) return defaults.workdir;
  const resolved = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  return path.isAbsolute(resolved) ? path.normalize(resolved) : path.resolve(defaults.workdir, resolved);
}

function normalizeShell(input) {
  const raw = String(input || "").trim();
  if (!raw) return defaults.shell;
  return raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
}

async function tryExecuteTaskFromText(input) {
  const text = String(input?.text || "").trim();
  const config = normalizeTaskExecutorConfig(input?.config || loadTaskExecutorConfig());
  const cwd = normalizeWorkdir(input?.cwd || config.workdir);
  const direct = extractDirectCommand(text);
  let source = "";
  let command = "";

  if (direct) {
    source = direct.source;
    command = direct.command;
  } else if (config.naturalLanguageEnabled) {
    if (typeof input?.resolveNaturalLanguageCommand === "function") {
      try {
        command = String(await input.resolveNaturalLanguageCommand(text, config)).trim();
      } catch (_error) {
        command = "";
      }
    }
    if (command) source = "natural";
  }

  if (!command) return { handled: false };

  if (!config.enabled) {
    return {
      handled: true,
      ok: false,
      reply: [
        "任务自动执行当前未开启。",
        `请编辑 ${taskExecutorConfigPath}，将 enabled 改为 true。`
      ].join("\n")
    };
  }

  if (!command) {
    return {
      handled: true,
      ok: false,
      reply: "命令为空。用法：`/run ls -la`"
    };
  }
  if (command.length > config.maxCommandLength) {
    return {
      handled: true,
      ok: false,
      reply: `命令过长，最多允许 ${config.maxCommandLength} 个字符。`
    };
  }
  if (isBlockedCommand(command)) {
    return {
      handled: true,
      ok: false,
      reply: "命令被安全策略拦截。请改为更安全的命令。"
    };
  }

  const result = await runShellCommand(command, {
    cwd,
    timeoutMs: config.timeoutMs,
    maxOutputChars: config.maxOutputChars,
    shell: config.shell
  });

  const reply = formatExecutionReply(command, cwd, result);
  return {
    handled: true,
    ok: result.exitCode === 0 && !result.timedOut,
    reply,
    meta: {
      source,
      command,
      cwd,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      truncated: result.truncated
    }
  };
}

function isBlockedCommand(command) {
  return blockedPatterns.some((pattern) => pattern.test(command));
}

function extractDirectCommand(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  if (raw.startsWith("/run ")) {
    return { source: "slash", command: raw.slice(5).trim() };
  }
  if (/^(run|exec)\s+/i.test(raw)) {
    return { source: "slash", command: raw.replace(/^(run|exec)\s+/i, "").trim() };
  }
  if (/^(执行|运行|请执行|帮我执行|请帮我执行)\s+/u.test(raw)) {
    return { source: "natural", command: raw.replace(/^(执行|运行|请执行|帮我执行|请帮我执行)\s+/u, "").trim() };
  }
  const oneLineCode = raw.match(/^`([^`]+)`$/);
  if (oneLineCode) {
    return { source: "natural", command: oneLineCode[1].trim() };
  }
  const commandLabel = raw.match(/(?:^|\n)\s*(?:命令|command)\s*[:：]\s*([^\n]+)/i);
  if (commandLabel) {
    return { source: "natural", command: commandLabel[1].trim() };
  }
  return null;
}

function runShellCommand(command, options) {
  return new Promise((resolve) => {
    const cwd = String(options.cwd || defaults.workdir);
    const timeoutMs = clampInt(options.timeoutMs, defaults.timeoutMs, 3000, 300000);
    const maxOutputChars = clampInt(options.maxOutputChars, defaults.maxOutputChars, 500, 200000);
    const shell = String(options.shell || defaults.shell);

    const child = spawn(shell, ["-lc", command], {
      cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let finished = false;
    let exitCode = 1;

    const append = (source, chunk) => {
      let text = chunk.toString("utf8");
      if (!text) return source;
      const remaining = maxOutputChars - source.length;
      if (remaining <= 0) {
        truncated = true;
        return source;
      }
      if (text.length > remaining) {
        text = text.slice(0, remaining);
        truncated = true;
      }
      return source + text;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_error) {
          // ignore
        }
      }, 1200);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      stderr = append(stderr, Buffer.from(String(error.message || "执行失败"), "utf8"));
    });

    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
      resolve({
        exitCode,
        signal: signal || "",
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        timedOut,
        truncated
      });
    });
  });
}

function formatExecutionReply(command, cwd, result) {
  const lines = [
    "已执行命令：",
    "```bash",
    command,
    "```",
    `工作目录：\`${cwd}\``,
    `退出码：\`${result.exitCode}\`${result.timedOut ? "（超时已终止）" : ""}`
  ];

  if (result.stdout) {
    lines.push("标准输出：", "```text", result.stdout, "```");
  }
  if (result.stderr) {
    lines.push("标准错误：", "```text", result.stderr, "```");
  }
  if (!result.stdout && !result.stderr) {
    lines.push("无输出。");
  }
  if (result.truncated) {
    lines.push("提示：输出过长，已截断。");
  }
  return lines.join("\n");
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

module.exports = {
  getTaskExecutorConfigPath,
  loadTaskExecutorConfig,
  saveTaskExecutorConfig,
  normalizeTaskExecutorConfig,
  tryExecuteTaskFromText
};
