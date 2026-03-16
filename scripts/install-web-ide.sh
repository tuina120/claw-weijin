#!/usr/bin/env bash
set -euo pipefail

IDE_PORT="${IDE_PORT:-18080}"
IDE_BIND_ADDR="${IDE_BIND_ADDR:-127.0.0.1}"
IDE_WORKDIR="${IDE_WORKDIR:-$HOME/codex}"
IDE_LOCALE="${IDE_LOCALE:-zh-cn}"
CODE_SERVER_BIN="$HOME/.local/bin/code-server"
OPENCLAW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENSURE_SCRIPT="${OPENCLAW_DIR}/scripts/ensure-web-ide-env.sh"
CONFIG_DIR="$HOME/.config/code-server"
CONFIG_FILE="$CONFIG_DIR/config.yaml"
USER_SETTINGS_DIR="$HOME/.local/share/code-server/User"
USER_SETTINGS_FILE="$USER_SETTINGS_DIR/settings.json"
USER_LOCALE_FILE="$USER_SETTINGS_DIR/locale.json"
SYSTEMD_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SYSTEMD_DIR/openclaw-web-ide.service"

if ! command -v curl >/dev/null 2>&1; then
  echo "缺少 curl，请先安装 curl" >&2
  exit 1
fi

if [ ! -x "$CODE_SERVER_BIN" ]; then
  echo "[1/6] 安装 code-server..."
  curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone
else
  echo "[1/6] 已检测到 code-server，跳过安装。"
fi

mkdir -p "$CONFIG_DIR"

AUTH=""
PASSWORD=""
if [ -f "$CONFIG_FILE" ]; then
  AUTH="$(sed -n 's/^auth:[[:space:]]*//p' "$CONFIG_FILE" | head -n 1 | tr -d '\r')"
  PASSWORD="$(sed -n 's/^password:[[:space:]]*//p' "$CONFIG_FILE" | head -n 1 | tr -d '\r')"
fi

if [ -z "$AUTH" ]; then
  AUTH="password"
fi

if [ -z "$PASSWORD" ]; then
  PASSWORD="$(python3 - <<'PY'
import secrets,string
alphabet=string.ascii_letters+string.digits+'@#%_-!'
print(''.join(secrets.choice(alphabet) for _ in range(20)))
PY
)"
fi

echo "[2/6] 写入 code-server 配置..."
if [ "$AUTH" = "none" ]; then
  cat > "$CONFIG_FILE" <<YAML
bind-addr: ${IDE_BIND_ADDR}:${IDE_PORT}
auth: none
cert: false
locale: ${IDE_LOCALE}
disable-telemetry: true
disable-update-check: true
YAML
else
  cat > "$CONFIG_FILE" <<YAML
bind-addr: ${IDE_BIND_ADDR}:${IDE_PORT}
auth: password
password: ${PASSWORD}
cert: false
locale: ${IDE_LOCALE}
disable-telemetry: true
disable-update-check: true
YAML
fi

echo "[3/6] 写入界面默认配置（中文 + 左侧活动栏）..."
mkdir -p "$USER_SETTINGS_DIR"
python3 - "$USER_SETTINGS_FILE" <<'PY'
import json
import os
import sys

path = sys.argv[1]
settings = {}
if os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            existing = json.load(f)
            if isinstance(existing, dict):
                settings = existing
    except Exception:
        settings = {}

settings.update({
    "workbench.sideBar.location": "left",
    "workbench.activityBar.visible": True,
    "workbench.activityBar.location": "default",
    "workbench.statusBar.visible": True,
    "workbench.layoutControl.enabled": True,
    "zenMode.restore": False,
    "zenMode.hideActivityBar": False,
    "zenMode.hideStatusBar": False,
    "chatgpt.localeOverride": "zh-cn",
})

with open(path, "w", encoding="utf-8") as f:
    json.dump(settings, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
cat > "$USER_LOCALE_FILE" <<JSON
{
  "locale": "${IDE_LOCALE}"
}
JSON

echo "[4/6] 准备启动前自检脚本..."
if [ -f "$ENSURE_SCRIPT" ]; then
  chmod +x "$ENSURE_SCRIPT"
  "$ENSURE_SCRIPT" >/dev/null 2>&1 || echo "警告：Web IDE 自检脚本执行失败，可手动运行：$ENSURE_SCRIPT"
else
  echo "警告：未找到自检脚本：$ENSURE_SCRIPT"
fi

echo "[5/6] 写入 systemd 用户服务..."
mkdir -p "$SYSTEMD_DIR"
cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=OpenClaw Web IDE (code-server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${IDE_WORKDIR}
ExecStartPre=${ENSURE_SCRIPT}
ExecStart=${CODE_SERVER_BIN} --config ${CONFIG_FILE} ${IDE_WORKDIR}
Restart=always
RestartSec=3
TimeoutStopSec=20
KillSignal=SIGINT
NoNewPrivileges=true

[Install]
WantedBy=default.target
UNIT

echo "[6/6] 启动服务..."
systemctl --user daemon-reload
systemctl --user enable openclaw-web-ide.service >/dev/null 2>&1 || true
systemctl --user restart openclaw-web-ide.service

echo "完成"
echo "Web IDE 地址: http://${IDE_BIND_ADDR}:${IDE_PORT}"
if [ "$AUTH" = "none" ]; then
  echo "登录方式: 无（建议配合 Cloudflare Access）"
else
  echo "登录密码: ${PASSWORD}"
fi
echo "默认语言: ${IDE_LOCALE}"
echo "服务状态: systemctl --user status openclaw-web-ide.service"
echo "查看日志: journalctl --user -u openclaw-web-ide.service -f"
