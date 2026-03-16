#!/usr/bin/env bash
set -euo pipefail

# Reset code-server workbench layout cache (does NOT touch project files).
# Useful when Activity Bar / Side Bar disappears due corrupted UI state.

USER_DATA_DIR="${HOME}/.local/share/code-server/User"
BACKUP_DIR="${HOME}/.local/share/code-server/layout-backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "${BACKUP_DIR}"

stop_service() {
  systemctl --user stop openclaw-web-ide.service >/dev/null 2>&1 || true
}

start_service() {
  systemctl --user start openclaw-web-ide.service >/dev/null 2>&1 || true
}

backup_and_clear_dir() {
  local src="$1"
  local name="$2"
  if [[ -d "${src}" ]]; then
    cp -a "${src}" "${BACKUP_DIR}/${name}"
    rm -rf "${src}"
  fi
}

echo "停止 openclaw-web-ide.service ..."
stop_service

echo "备份并清理工作台布局缓存 ..."
backup_and_clear_dir "${USER_DATA_DIR}/workspaceStorage" "workspaceStorage"
backup_and_clear_dir "${USER_DATA_DIR}/caches/CachedConfigurations" "CachedConfigurations"

echo "重启 openclaw-web-ide.service ..."
start_service

echo "完成。备份目录：${BACKUP_DIR}"
echo "请刷新浏览器页面（建议 Ctrl+Shift+R）。"
