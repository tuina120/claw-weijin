#!/usr/bin/env bash
set -euo pipefail

DIRECT_ENV_PATH="${OPENCLAW_DIRECT_ENV_PATH:-${HOME}/.config/openclaw/direct.env}"
if [[ -f "${DIRECT_ENV_PATH}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${DIRECT_ENV_PATH}"
  set +a
fi

MIHOMO_DIR="${HOME}/.config/mihomo-party"
OVERRIDE_CONFIG="${MIHOMO_DIR}/override.yaml"
OVERRIDE_DIR="${MIHOMO_DIR}/override"
PROFILE_CONFIG="${MIHOMO_DIR}/profile.yaml"
WORK_CONFIG="${MIHOMO_DIR}/work/config.yaml"
LOG_DIR="${HOME}/.config/openclaw/logs"
LOG_FILE="${LOG_DIR}/cloudflared-direct-guard.log"
OVERRIDE_ID="openclaw-cloudflared-direct"
OVERRIDE_FILE="${OVERRIDE_DIR}/${OVERRIDE_ID}.yaml"
SOCKET_GLOB="/tmp/mihomo-party-*.sock"
DIRECT_POLICY_NAME="${OPENCLAW_DIRECT_POLICY_NAME:-🎯 全球直连}"
BRIDGE_CONFIG="${OPENCLAW_BRIDGE_CONFIG:-$(cd "$(dirname "$0")/.." && pwd)/bridge.config.json}"
EXTRA_DIRECT_DOMAINS="${OPENCLAW_DIRECT_EXTRA_DOMAINS:-}"
FORCE_DIRECT_TELEGRAM="${OPENCLAW_FORCE_DIRECT_TELEGRAM:-0}"
RULE_1="  - PROCESS-NAME,cloudflared,${DIRECT_POLICY_NAME}"
RULE_2="  - PROCESS-NAME-WILDCARD,cloudflared*,${DIRECT_POLICY_NAME}"

mkdir -p "${OVERRIDE_DIR}" "${LOG_DIR}"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "${LOG_FILE}" >/dev/null
}

write_override_file() {
  node <<'NODE'
const fs = require('fs');
const path = process.env.OVERRIDE_FILE;
const bridgeConfigPath = process.env.BRIDGE_CONFIG;
const extraDomainsRaw = process.env.EXTRA_DIRECT_DOMAINS || '';
const policy = process.env.DIRECT_POLICY_NAME || '🎯 全球直连';
const forceTelegram = String(process.env.FORCE_DIRECT_TELEGRAM || '').trim() === '1';

function normalizeDomain(input) {
  const raw = String(input || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  if (!raw) return '';
  if (raw === 'localhost') return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return '';
  if (raw.includes(':')) return '';
  if (!/^[a-z0-9.-]+$/.test(raw)) return '';
  if (!raw.includes('.')) return '';
  return raw;
}

function hostFromUrl(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  try {
    return normalizeDomain(new URL(value).hostname || '');
  } catch (_error) {
    return '';
  }
}

const domains = new Set(['argotunnel.com', 'cfargotunnel.com']);
if (forceTelegram) domains.add('api.telegram.org');

if (fs.existsSync(bridgeConfigPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(bridgeConfigPath, 'utf8'));
    const modelBaseUrl = raw?.model?.baseUrl;
    const telegramApiBase = raw?.telegram?.apiBase;
    const telegramWebhookPublicUrl = raw?.telegram?.webhook?.publicUrl;
    [modelBaseUrl, telegramWebhookPublicUrl]
      .map(hostFromUrl)
      .filter(Boolean)
      .forEach((item) => domains.add(item));
    if (forceTelegram) {
      const tgHost = hostFromUrl(telegramApiBase);
      if (tgHost) domains.add(tgHost);
    }
  } catch (_error) {
    // ignore parse errors
  }
}

String(extraDomainsRaw)
  .split(/[\s,\n]+/g)
  .map(normalizeDomain)
  .filter(Boolean)
  .forEach((item) => domains.add(item));

const rules = [
  `  - PROCESS-NAME,cloudflared,${policy}`,
  `  - PROCESS-NAME-WILDCARD,cloudflared*,${policy}`,
  ...Array.from(domains)
    .sort((a, b) => a.localeCompare(b))
    .map((domain) => `  - DOMAIN-SUFFIX,${domain},${policy}`)
];

fs.writeFileSync(path, `+rules:\n${rules.join('\n')}\n`, 'utf8');
NODE
}

ensure_override_registry() {
  node <<'NODE'
const fs = require('fs');
const path = process.env.OVERRIDE_CONFIG;
const id = process.env.OVERRIDE_ID;
const now = Date.now();
let text = 'items: []\n';
if (fs.existsSync(path)) {
  text = fs.readFileSync(path, 'utf8');
}
const block = [
  `  - id: ${id}`,
  `    name: OpenClaw Cloudflared 直连`,
  `    type: local`,
  `    ext: yaml`,
  `    global: true`,
  `    updated: ${now}`
].join('\n');
const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(`\\n  - id: ${escaped}\\n(?:    .*\\n)*`, 'm');
if (!/^\s*items:/m.test(text)) {
  text = `items:\n${block}\n`;
} else if (pattern.test(text)) {
  text = text.replace(pattern, `\n${block}\n`);
} else if (/items:\s*\[\s*\]\s*$/m.test(text.trim())) {
  text = text.replace(/items:\s*\[\s*\]\s*$/m, `items:\n${block}`);
  if (!text.endsWith('\n')) text += '\n';
} else {
  if (!text.endsWith('\n')) text += '\n';
  text += `${block}\n`;
}
fs.writeFileSync(path, text, 'utf8');
NODE
}

ensure_profile_override() {
  node <<'NODE'
const fs = require('fs');
const path = process.env.PROFILE_CONFIG;
const overrideId = process.env.OVERRIDE_ID;
if (!fs.existsSync(path)) process.exit(0);
let text = fs.readFileSync(path, 'utf8');
const currentMatch = text.match(/^current:\s*(\S+)\s*$/m);
if (!currentMatch) process.exit(0);
const currentId = currentMatch[1];
const blockPattern = new RegExp(`(\\n  - id: ${currentId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\n(?:    .*\\n)*)`, 'm');
const blockMatch = text.match(blockPattern);
if (!blockMatch) process.exit(0);
let block = blockMatch[1];
const overrideLinePattern = /^    override:\s*(.*)$/m;
if (!overrideLinePattern.test(block)) process.exit(0);
const line = block.match(overrideLinePattern)[1].trim();
let values = [];
if (line.startsWith('[') && line.endsWith(']')) {
  values = line
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
if (!values.includes(overrideId)) values.push(overrideId);
const nextBlock = block.replace(overrideLinePattern, `    override: [${values.join(', ')}]`);
text = text.replace(blockPattern, nextBlock);
fs.writeFileSync(path, text, 'utf8');
NODE
}

ensure_work_rules() {
  node <<'NODE'
const fs = require('fs');
const path = process.env.WORK_CONFIG;
const rule1 = process.env.RULE_1;
const rule2 = process.env.RULE_2;
const overrideFile = process.env.OVERRIDE_FILE;
const policy = process.env.DIRECT_POLICY_NAME || '🎯 全球直连';
if (!fs.existsSync(path)) process.exit(0);
const text = fs.readFileSync(path, 'utf8');
const lines = text.split(/\r?\n/);
const rulesIndex = lines.findIndex((line) => /^rules:\s*$/.test(line));
if (rulesIndex < 0) process.exit(0);

const desired = [rule1, rule2].filter(Boolean);
if (overrideFile && fs.existsSync(overrideFile)) {
  const overrideLines = fs
    .readFileSync(overrideFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-\s*DOMAIN-SUFFIX,[^,]+,/.test(line))
    .map((line) => `  ${line}`);
  overrideLines.forEach((line) => {
    if (!desired.includes(line)) desired.push(line);
  });
}

if (!desired.length) process.exit(0);
const desiredSet = new Set(desired.map((line) => line.trim()));
const desiredDomains = new Set(
  desired
    .map((line) => {
      const m = line.trim().match(/^- DOMAIN-SUFFIX,([^,]+),/);
      return m ? m[1].trim().toLowerCase() : '';
    })
    .filter(Boolean)
);
const cleanupDomains = new Set([...desiredDomains, 'api.telegram.org']);

const kept = [];
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (i !== rulesIndex && desiredSet.has(line.trim())) continue;
  if (i !== rulesIndex) {
    const m = line.trim().match(/^- DOMAIN-SUFFIX,([^,]+),(.+)$/);
    if (m) {
      const domain = String(m[1] || '').trim().toLowerCase();
      const targetPolicy = String(m[2] || '').trim();
      if (cleanupDomains.has(domain) && targetPolicy === policy && !desiredDomains.has(domain)) {
        continue;
      }
    }
  }
  kept.push(line);
}

const newLines = [];
let inserted = false;
for (let i = 0; i < kept.length; i += 1) {
  const line = kept[i];
  newLines.push(line);
  if (!inserted && i === rulesIndex) {
    desired.forEach((item) => newLines.push(item));
    inserted = true;
  }
}

const nextText = `${newLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
if (nextText !== text) {
  fs.writeFileSync(path, nextText, 'utf8');
}
NODE
}

find_socket() {
  local socket_path
  while IFS= read -r socket_path; do
    [[ -n "${socket_path}" ]] || continue
    if curl --unix-socket "${socket_path}" -fsS http://localhost/connections >/dev/null 2>&1; then
      echo "${socket_path}"
      return 0
    fi
  done < <(ls -1t ${SOCKET_GLOB} 2>/dev/null || true)
  return 0
}

reload_mihomo() {
  local socket_path="$1"
  [[ -n "${socket_path}" ]] || return 0
  curl --unix-socket "${socket_path}" -fsS -X PUT \
    'http://localhost/configs?force=true' \
    -H 'Content-Type: application/json' \
    -d "{\"path\":\"${WORK_CONFIG}\"}" >/dev/null
}

cloudflared_needs_fix() {
  local socket_path="$1"
  [[ -n "${socket_path}" ]] || return 1
  local payload
  payload="$(curl --unix-socket "${socket_path}" -fsS http://localhost/connections 2>/dev/null || true)"
  [[ -n "${payload}" ]] || return 1
  PAYLOAD="${payload}" node <<'NODE'
const payload = process.env.PAYLOAD || '{}';
let data = {};
try {
  data = JSON.parse(payload);
} catch (_error) {
  process.exit(1);
}
const list = Array.isArray(data.connections) ? data.connections : [];
const cloudflared = list.filter((item) => String(item?.metadata?.process || '') === 'cloudflared');
if (!cloudflared.length) process.exit(1);
const bad = cloudflared.some((item) => {
  const chains = Array.isArray(item?.chains) ? item.chains.map(String) : [];
  return !chains.includes('DIRECT');
});
process.exit(bad ? 0 : 1);
NODE
}

main() {
  export OVERRIDE_CONFIG OVERRIDE_ID PROFILE_CONFIG WORK_CONFIG RULE_1 RULE_2
  export OVERRIDE_FILE BRIDGE_CONFIG EXTRA_DIRECT_DOMAINS DIRECT_POLICY_NAME FORCE_DIRECT_TELEGRAM
  write_override_file
  ensure_override_registry
  ensure_profile_override
  ensure_work_rules
  local socket_path
  socket_path="$(find_socket)"
  if [[ -n "${socket_path}" ]]; then
    reload_mihomo "${socket_path}" || log "Mihomo 重载失败：${socket_path}"
  else
    log "未发现 Mihomo 控制 socket，已完成本地文件修复"
  fi

  if [[ -n "${socket_path}" ]] && cloudflared_needs_fix "${socket_path}"; then
    log "检测到 cloudflared 未走 DIRECT，准备重载并重启隧道"
    reload_mihomo "${socket_path}" || true
    systemctl --user restart openclaw-cloudflared.service openclaw-cloudflared-b.service
    log "已重启 openclaw-cloudflared.service 与 openclaw-cloudflared-b.service"
  else
    log "巡检完成：cloudflared 当前为 DIRECT 或暂无连接"
  fi
}

main "$@"
