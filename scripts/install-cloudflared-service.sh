#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="openclaw-cloudflared.service"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_FILE="${PROJECT_DIR}/systemd/openclaw-cloudflared.service.template"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
TARGET_FILE="${SYSTEMD_USER_DIR}/${SERVICE_NAME}"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "未检测到 systemctl，无法安装 systemd 用户服务。"
  exit 1
fi

if [[ ! -f "${TEMPLATE_FILE}" ]]; then
  echo "模板文件不存在: ${TEMPLATE_FILE}"
  exit 1
fi

if command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED_BIN="$(command -v cloudflared)"
elif [[ -x "${HOME}/.local/bin/cloudflared" ]]; then
  CLOUDFLARED_BIN="${HOME}/.local/bin/cloudflared"
else
  echo "未检测到 cloudflared。请先执行："
  echo "  ${PROJECT_DIR}/scripts/install-cloudflared.sh"
  exit 1
fi

CONFIG_DIR="${HOME}/.config/cloudflared"
CONFIG_FILE="${CONFIG_DIR}/openclaw.yml"
mkdir -p "${SYSTEMD_USER_DIR}" "${CONFIG_DIR}"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  cat >"${CONFIG_FILE}" <<'YAML'
# 你需要先在 Cloudflare 控制台授权，并创建 tunnel：
#   cloudflared tunnel login
#   # 建议用一个不会撞名的 tunnel 名称（例如 openclaw-home）
#   cloudflared tunnel create openclaw-home
#   cloudflared tunnel route dns openclaw-home claw.qxyx.net
#   cloudflared tunnel route dns openclaw-home guest.qxyx.net
#   cloudflared tunnel route dns openclaw-home file.qxyx.net
#
# 然后把 credentials-file 替换成实际路径（通常在 ~/.cloudflared/ 里）。
tunnel: openclaw-home
credentials-file: /home/USER/.cloudflared/<tunnel-id>.json
protocol: http2
originRequest:
  connectTimeout: 15s
  tcpKeepAlive: 30s
  keepAliveConnections: 1024
  keepAliveTimeout: 5m
  noHappyEyeballs: true
ingress:
  - hostname: claw.qxyx.net
    service: http://127.0.0.1:4173
  - hostname: guest.qxyx.net
    service: http://127.0.0.1:4173
  - hostname: file.qxyx.net
    service: http://127.0.0.1:4173
  - service: http_status:404
YAML
  echo "已创建配置模板: ${CONFIG_FILE}"
  echo "请把 credentials-file / hostname 改成你的实际值后再启动服务。"
fi

sed \
  -e "s|__CLOUDFLARED_BIN__|${CLOUDFLARED_BIN}|g" \
  -e "s|__CONFIG_FILE__|${CONFIG_FILE}|g" \
  "${TEMPLATE_FILE}" >"${TARGET_FILE}"

echo "已写入服务文件: ${TARGET_FILE}"
systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}" || true

echo
echo "服务状态（如果配置未完成可能会失败，请先修正 ${CONFIG_FILE}）："
systemctl --user status "${SERVICE_NAME}" --no-pager --lines=25 || true
echo
echo "常用命令："
echo "  systemctl --user restart ${SERVICE_NAME}"
echo "  systemctl --user stop ${SERVICE_NAME}"
echo "  journalctl --user -u ${SERVICE_NAME} -f"
echo "  # 并发更高（可选）：再起一个副本"
echo "  # cp ~/.config/systemd/user/${SERVICE_NAME} ~/.config/systemd/user/openclaw-cloudflared-b.service"
echo "  # systemctl --user enable --now openclaw-cloudflared-b.service"
echo
echo "如需开机并在未登录时也保持运行，可执行："
echo "  sudo loginctl enable-linger ${USER}"
