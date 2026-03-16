#!/usr/bin/env bash
set -euo pipefail

# Install cloudflared to ~/.local/bin without root.
# Reference: Cloudflare Tunnel client.

BIN_DIR="${HOME}/.local/bin"
BIN_PATH="${BIN_DIR}/cloudflared"

mkdir -p "${BIN_DIR}"

ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64|amd64)
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    ;;
  aarch64|arm64)
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    ;;
  armv7l|armv7)
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
    ;;
  *)
    echo "不支持的架构: ${ARCH}"
    exit 1
    ;;
esac

echo "下载 cloudflared (${ARCH})..."
curl -fsSL "${URL}" -o "${BIN_PATH}"
chmod +x "${BIN_PATH}"

echo "已安装: ${BIN_PATH}"
"${BIN_PATH}" --version || true

cat <<'EOF'

下一步（需要你在 Cloudflare 控制台授权一次）：
  cloudflared tunnel login
  # 建议用一个不会撞名的 tunnel 名称（例如 openclaw-home）
  cloudflared tunnel create openclaw-home
  cloudflared tunnel route dns openclaw-home claw.qxyx.net
  cloudflared tunnel route dns openclaw-home guest.qxyx.net
  cloudflared tunnel route dns openclaw-home file.qxyx.net

然后创建配置并运行：
  mkdir -p ~/.config/cloudflared
  cat > ~/.config/cloudflared/openclaw.yml <<'YAML'
  # tunnel 可填 “名称” 或 “UUID”。建议填 UUID，避免同名冲突。
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
  cloudflared tunnel --config ~/.config/cloudflared/openclaw.yml run
EOF
