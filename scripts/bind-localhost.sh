#!/usr/bin/env bash
set -euo pipefail

# Bind OpenClaw web to localhost only (recommended when using Cloudflare Tunnel).

if ! command -v systemctl >/dev/null 2>&1; then
  echo "未检测到 systemctl，无法配置 systemd 用户服务。"
  exit 1
fi

SYSTEMD_DIR="${HOME}/.config/systemd/user"
DROPIN_DIR="${SYSTEMD_DIR}/openclaw-web.service.d"
DROPIN_FILE="${DROPIN_DIR}/override.conf"

mkdir -p "${DROPIN_DIR}"

cat >"${DROPIN_FILE}" <<'EOF'
[Service]
Environment=HOST=127.0.0.1
EOF

echo "已写入: ${DROPIN_FILE}"
systemctl --user daemon-reload
systemctl --user restart openclaw-web.service

echo "已重启 openclaw-web.service。"
systemctl --user status openclaw-web.service --no-pager --lines=15 || true

