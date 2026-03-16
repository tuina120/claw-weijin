#!/usr/bin/env bash
set -euo pipefail

CODE_SERVER_BIN="${HOME}/.local/bin/code-server"
IDE_LOCALE="${IDE_LOCALE:-zh-cn}"
LANGUAGE_PACK_EXT="${LANGUAGE_PACK_EXT:-ms-ceintl.vscode-language-pack-zh-hans}"
CODEX_EXT="${CODEX_EXT:-openai.chatgpt}"
USER_SETTINGS_DIR="${HOME}/.local/share/code-server/User"
USER_SETTINGS_FILE="${USER_SETTINGS_DIR}/settings.json"
USER_LOCALE_FILE="${USER_SETTINGS_DIR}/locale.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -x "${CODE_SERVER_BIN}" ]]; then
  echo "code-server 不存在，跳过环境自检。"
  exit 0
fi

mkdir -p "${USER_SETTINGS_DIR}"

python3 - "${USER_SETTINGS_FILE}" <<'PY'
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

cat > "${USER_LOCALE_FILE}" <<JSON
{
  "locale": "${IDE_LOCALE}"
}
JSON

INSTALLED_EXTS="$("${CODE_SERVER_BIN}" --list-extensions 2>/dev/null || true)"
if ! printf '%s\n' "${INSTALLED_EXTS}" | rg -qx "${LANGUAGE_PACK_EXT}"; then
  "${CODE_SERVER_BIN}" --install-extension "${LANGUAGE_PACK_EXT}" >/dev/null 2>&1 || true
fi
if ! printf '%s\n' "${INSTALLED_EXTS}" | rg -qx "${CODEX_EXT}"; then
  "${CODE_SERVER_BIN}" --install-extension "${CODEX_EXT}" >/dev/null 2>&1 || true
fi

if [[ -x "${SCRIPT_DIR}/fix-codex-extension.sh" ]]; then
  NO_RESTART=1 "${SCRIPT_DIR}/fix-codex-extension.sh" >/dev/null 2>&1 || true
fi

echo "Web IDE 环境自检完成（中文 + Codex 插件）。"
