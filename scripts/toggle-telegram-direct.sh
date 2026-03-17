#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD_SCRIPT="${ROOT_DIR}/scripts/ensure-cloudflared-direct.sh"
DIRECT_ENV_PATH="${OPENCLAW_DIRECT_ENV_PATH:-${HOME}/.config/openclaw/direct.env}"
OVERRIDE_FILE="${HOME}/.config/mihomo-party/override/openclaw-cloudflared-direct.yaml"
WORK_FILE="${HOME}/.config/mihomo-party/work/config.yaml"

usage() {
  cat <<'USAGE'
用法：
  ./scripts/toggle-telegram-direct.sh on
  ./scripts/toggle-telegram-direct.sh off
  ./scripts/toggle-telegram-direct.sh status

说明：
  on     强制 api.telegram.org 走“全球直连”
  off    取消强制直连（推荐，按你原有 Telegram 分流策略）
  status 查看当前开关状态与规则命中情况
USAGE
}

ensure_guard_script() {
  if [[ ! -f "${GUARD_SCRIPT}" ]]; then
    echo "错误：找不到巡检脚本 ${GUARD_SCRIPT}" >&2
    exit 1
  fi
}

read_persisted_value() {
  if [[ ! -f "${DIRECT_ENV_PATH}" ]]; then
    echo "0"
    return
  fi
  local value
  value="$(grep -E '^OPENCLAW_FORCE_DIRECT_TELEGRAM=' "${DIRECT_ENV_PATH}" | tail -n1 | cut -d= -f2- || true)"
  value="$(echo "${value}" | tr -d '[:space:]')"
  if [[ "${value}" == "1" ]]; then
    echo "1"
  else
    echo "0"
  fi
}

write_persisted_value() {
  local value="$1"
  mkdir -p "$(dirname "${DIRECT_ENV_PATH}")"
  local tmp
  tmp="$(mktemp)"
  if [[ -f "${DIRECT_ENV_PATH}" ]]; then
    grep -v -E '^OPENCLAW_FORCE_DIRECT_TELEGRAM=' "${DIRECT_ENV_PATH}" > "${tmp}" || true
  fi
  echo "OPENCLAW_FORCE_DIRECT_TELEGRAM=${value}" >> "${tmp}"
  mv "${tmp}" "${DIRECT_ENV_PATH}"
  chmod 600 "${DIRECT_ENV_PATH}" 2>/dev/null || true
}

has_tg_direct_rule() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    echo "否"
    return
  fi
  if grep -q 'DOMAIN-SUFFIX,api.telegram.org' "${file}"; then
    echo "是"
  else
    echo "否"
  fi
}

run_guard_with_mode() {
  local value="$1"
  OPENCLAW_FORCE_DIRECT_TELEGRAM="${value}" bash "${GUARD_SCRIPT}" >/dev/null
}

show_status() {
  local persisted
  persisted="$(read_persisted_value)"
  local mode_text="关闭（推荐）"
  if [[ "${persisted}" == "1" ]]; then
    mode_text="开启（强制直连）"
  fi

  echo "当前 Telegram 强制直连：${mode_text}"
  echo "持久化配置文件：${DIRECT_ENV_PATH}"
  echo "override 规则含 api.telegram.org：$(has_tg_direct_rule "${OVERRIDE_FILE}")"
  echo "work 规则含 api.telegram.org：$(has_tg_direct_rule "${WORK_FILE}")"
}

main() {
  ensure_guard_script
  local action="${1:-status}"
  case "${action}" in
    on)
      write_persisted_value 1
      run_guard_with_mode 1
      echo "已开启：api.telegram.org 强制直连"
      show_status
      ;;
    off)
      write_persisted_value 0
      run_guard_with_mode 0
      echo "已关闭：api.telegram.org 强制直连"
      show_status
      ;;
    status)
      show_status
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "错误：不支持的参数 ${action}" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
