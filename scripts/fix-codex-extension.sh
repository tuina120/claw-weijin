#!/usr/bin/env bash
set -euo pipefail

EXT_ROOT="${HOME}/.local/share/code-server/extensions"
EXT_DIR="$(find "${EXT_ROOT}" -maxdepth 1 -type d -name 'openai.chatgpt-*' | sort | tail -n 1 || true)"

if [[ -z "${EXT_DIR}" ]]; then
  echo "未找到 openai.chatgpt 扩展目录，请先在 Web IDE 安装 Codex 插件。" >&2
  exit 1
fi

EXT_JS="${EXT_DIR}/out/extension.js"
PKG_JSON="${EXT_DIR}/package.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
CHANGED=0

if [[ ! -f "${EXT_JS}" || ! -f "${PKG_JSON}" ]]; then
  echo "扩展文件不完整：${EXT_DIR}" >&2
  exit 1
fi

# Node 22 compatibility: prevent extension from touching global navigator directly.
if ! head -c 80 "${EXT_JS}" | rg -q 'var navigator=void 0;'; then
  cp -a "${EXT_JS}" "${EXT_JS}.bak.${STAMP}"
  perl -0777 -i -pe 's/^"use strict";/"use strict";var navigator=void 0;/' "${EXT_JS}"
  CHANGED=1
fi

# Force Codex container to stay in left activity bar.
NEEDS_PACKAGE_PATCH="$(node - "${PKG_JSON}" <<'NODE'
const fs = require("fs");

const pkgPath = process.argv[2];
const raw = fs.readFileSync(pkgPath, "utf8");
const data = JSON.parse(raw);

const contributes = data.contributes || {};
const viewsContainers = contributes.viewsContainers || {};
const views = contributes.views || {};

const needs = (
  (Array.isArray(viewsContainers.activitybar) && viewsContainers.activitybar[0] && viewsContainers.activitybar[0].when !== "true") ||
  (Array.isArray(viewsContainers.secondarySidebar) && viewsContainers.secondarySidebar[0] && viewsContainers.secondarySidebar[0].when !== "false") ||
  (Array.isArray(views.codexViewContainer) && views.codexViewContainer[0] && views.codexViewContainer[0].when !== "true") ||
  (Array.isArray(views.codexSecondaryViewContainer) && views.codexSecondaryViewContainer[0] && views.codexSecondaryViewContainer[0].when !== "false")
);

process.stdout.write(needs ? "1" : "0");
NODE
)"

if [[ "${NEEDS_PACKAGE_PATCH}" == "1" ]]; then
  cp -a "${PKG_JSON}" "${PKG_JSON}.bak.${STAMP}"
  node - "${PKG_JSON}" <<'NODE'
const fs = require("fs");

const pkgPath = process.argv[2];
const raw = fs.readFileSync(pkgPath, "utf8");
const data = JSON.parse(raw);

const contributes = data.contributes || {};
const viewsContainers = contributes.viewsContainers || {};
const views = contributes.views || {};

if (Array.isArray(viewsContainers.activitybar) && viewsContainers.activitybar[0]) {
  viewsContainers.activitybar[0].when = "true";
}
if (Array.isArray(viewsContainers.secondarySidebar) && viewsContainers.secondarySidebar[0]) {
  viewsContainers.secondarySidebar[0].when = "false";
}
if (Array.isArray(views.codexViewContainer) && views.codexViewContainer[0]) {
  views.codexViewContainer[0].when = "true";
}
if (Array.isArray(views.codexSecondaryViewContainer) && views.codexSecondaryViewContainer[0]) {
  views.codexSecondaryViewContainer[0].when = "false";
}

fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + "\n", "utf8");
NODE
  CHANGED=1
fi

if [[ "${NO_RESTART:-0}" != "1" ]]; then
  systemctl --user restart openclaw-web-ide.service
fi

if [[ "${CHANGED}" == "1" ]]; then
  echo "已修复 Codex 插件显示：${EXT_DIR}"
else
  echo "Codex 插件已是兼容状态，无需修复：${EXT_DIR}"
fi

if [[ "${NO_RESTART:-0}" != "1" ]]; then
  echo "请打开 http://127.0.0.1:18080 后按 Ctrl+Shift+R 强制刷新。"
fi
