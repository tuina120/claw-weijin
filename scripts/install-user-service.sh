#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="openclaw-bridge.service"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_FILE="${PROJECT_DIR}/systemd/openclaw-bridge.service.template"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
TARGET_FILE="${SYSTEMD_USER_DIR}/${SERVICE_NAME}"
ENV_DIR="${HOME}/.config/openclaw"
ENV_FILE="${ENV_DIR}/bridge.env"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "未检测到 systemctl，无法安装 systemd 用户服务。"
  exit 1
fi

mkdir -p "${SYSTEMD_USER_DIR}" "${ENV_DIR}"

if [[ ! -f "${TEMPLATE_FILE}" ]]; then
  echo "模板文件不存在: ${TEMPLATE_FILE}"
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cat >"${ENV_FILE}" <<'EOF'
RC_KEY=
TG_BOT_TOKEN=
# 网络代理（可选）：若你的网络无法访问 Telegram / OpenAI 等，可在这里配置代理并改用 curl 传输。
# 说明：
# - 常见本地代理（Clash 等）HTTP 端口：HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7890
# - 常见 SOCKS 代理：ALL_PROXY=socks5h://127.0.0.1:7891
# - 如配置了代理，建议设置 BRIDGE_HTTP_TRANSPORT=curl（Node 内置 fetch 不一定走代理环境变量）
BRIDGE_HTTP_TRANSPORT=auto
HTTP_PROXY=
HTTPS_PROXY=
ALL_PROXY=
NO_PROXY=localhost,127.0.0.1
EOF
  chmod 600 "${ENV_FILE}"
  echo "已创建环境变量文件: ${ENV_FILE}"
  echo "请先填入 RC_KEY / TG_BOT_TOKEN，再重启服务。"
fi

sed \
  -e "s|__PROJECT_DIR__|${PROJECT_DIR}|g" \
  -e "s|__ENV_FILE__|${ENV_FILE}|g" \
  "${TEMPLATE_FILE}" >"${TARGET_FILE}"

echo "已写入服务文件: ${TARGET_FILE}"

systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}"

echo
echo "服务已启动。状态："
systemctl --user status "${SERVICE_NAME}" --no-pager --lines=25 || true

echo
echo "常用命令："
echo "  systemctl --user restart ${SERVICE_NAME}"
echo "  systemctl --user stop ${SERVICE_NAME}"
echo "  journalctl --user -u ${SERVICE_NAME} -f"
echo
echo "如需开机并在未登录时也保持运行，可执行："
echo "  sudo loginctl enable-linger ${USER}"
