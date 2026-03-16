#!/usr/bin/env bash
set -euo pipefail

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
RULE_1="  - PROCESS-NAME,cloudflared,🎯 全球直连"
RULE_2="  - PROCESS-NAME-WILDCARD,cloudflared*,🎯 全球直连"

mkdir -p "${OVERRIDE_DIR}" "${LOG_DIR}"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "${LOG_FILE}" >/dev/null
}

write_override_file() {
  cat >"${OVERRIDE_FILE}" <<'EOF'
+rules:
  - PROCESS-NAME,cloudflared,🎯 全球直连
  - PROCESS-NAME-WILDCARD,cloudflared*,🎯 全球直连
EOF
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
if (!fs.existsSync(path)) process.exit(0);
let text = fs.readFileSync(path, 'utf8');
if (!/^rules:\s*$/m.test(text)) process.exit(0);
const has1 = text.includes(rule1);
const has2 = text.includes(rule2);
if (has1 && has2) process.exit(0);
text = text.replace(/^rules:\s*$/m, `rules:\n${rule1}\n${rule2}`);
fs.writeFileSync(path, text, 'utf8');
NODE
}

find_socket() {
  ls ${SOCKET_GLOB} 2>/dev/null | head -n 1 || true
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
