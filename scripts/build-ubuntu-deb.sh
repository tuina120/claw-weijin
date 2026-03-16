#!/usr/bin/env bash
set -euo pipefail

PKG_NAME="openclaw"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGING_DIR="${PROJECT_DIR}/packaging/deb"

VERSION=""
ARCH=""
OUT_DIR="${PROJECT_DIR}/dist"

usage() {
  cat <<'EOF'
用法: ./scripts/build-ubuntu-deb.sh [-v 版本号] [-a 架构] [-o 输出目录]

示例:
  ./scripts/build-ubuntu-deb.sh
  ./scripts/build-ubuntu-deb.sh -v 1.0.1
  ./scripts/build-ubuntu-deb.sh -o /tmp/dist
EOF
}

while getopts ":v:a:o:h" opt; do
  case "${opt}" in
    v) VERSION="${OPTARG}" ;;
    a) ARCH="${OPTARG}" ;;
    o) OUT_DIR="${OPTARG}" ;;
    h)
      usage
      exit 0
      ;;
    :)
      echo "参数 -${OPTARG} 缺少值。" >&2
      usage
      exit 1
      ;;
    \?)
      echo "未知参数: -${OPTARG}" >&2
      usage
      exit 1
      ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少依赖命令: $1" >&2
    exit 1
  fi
}

need_cmd dpkg-deb
need_cmd rsync
need_cmd du
need_cmd sed
need_cmd node

if [[ -z "${VERSION}" ]]; then
  VERSION="$(node -p "require('${PROJECT_DIR}/package.json').version")"
fi

if [[ -z "${ARCH}" ]]; then
  ARCH="$(dpkg --print-architecture 2>/dev/null || true)"
fi
if [[ -z "${ARCH}" ]]; then
  ARCH="amd64"
fi

TMP_ROOT="$(mktemp -d /tmp/openclaw-deb-XXXXXX)"
STAGE_DIR="${TMP_ROOT}/${PKG_NAME}_${VERSION}_${ARCH}"
cleanup() {
  if [[ "${KEEP_BUILD_DIR:-0}" != "1" ]]; then
    rm -rf "${TMP_ROOT}"
  fi
}
trap cleanup EXIT

mkdir -p \
  "${STAGE_DIR}/DEBIAN" \
  "${STAGE_DIR}/opt/openclaw" \
  "${STAGE_DIR}/etc/systemd/system" \
  "${STAGE_DIR}/usr/bin"

rsync -a \
  --exclude '.git' \
  --exclude '.github' \
  --exclude '.vscode' \
  --exclude '.openclaw' \
  --exclude 'workspace' \
  --exclude 'dist' \
  --exclude 'bridge.config.json' \
  --exclude 'nano.*.save' \
  --exclude '*.swp' \
  --exclude '*.swo' \
  --exclude '*~' \
  --exclude '*.log' \
  "${PROJECT_DIR}/" "${STAGE_DIR}/opt/openclaw/"

install -m 644 "${PACKAGING_DIR}/openclaw-web.service" "${STAGE_DIR}/etc/systemd/system/openclaw-web.service"
install -m 644 "${PACKAGING_DIR}/openclaw.env" "${STAGE_DIR}/opt/openclaw/packaging/deb/openclaw.env"
install -m 755 "${PACKAGING_DIR}/openclawctl" "${STAGE_DIR}/usr/bin/openclawctl"
install -m 755 "${PACKAGING_DIR}/postinst" "${STAGE_DIR}/DEBIAN/postinst"
install -m 755 "${PACKAGING_DIR}/prerm" "${STAGE_DIR}/DEBIAN/prerm"
install -m 755 "${PACKAGING_DIR}/postrm" "${STAGE_DIR}/DEBIAN/postrm"

INSTALLED_SIZE="$(
  du -sk "${STAGE_DIR}/opt" "${STAGE_DIR}/etc" "${STAGE_DIR}/usr" \
    | awk '{sum += $1} END {print sum+0}'
)"

sed \
  -e "s|__VERSION__|${VERSION}|g" \
  -e "s|__ARCH__|${ARCH}|g" \
  -e "s|__INSTALLED_SIZE__|${INSTALLED_SIZE}|g" \
  "${PACKAGING_DIR}/control" > "${STAGE_DIR}/DEBIAN/control"
chmod 644 "${STAGE_DIR}/DEBIAN/control"

mkdir -p "${OUT_DIR}"
OUT_FILE="${OUT_DIR}/${PKG_NAME}_${VERSION}_${ARCH}.deb"

if dpkg-deb --help 2>/dev/null | grep -q -- '--root-owner-group'; then
  dpkg-deb --build --root-owner-group "${STAGE_DIR}" "${OUT_FILE}"
else
  dpkg-deb --build "${STAGE_DIR}" "${OUT_FILE}"
fi

echo "构建完成: ${OUT_FILE}"
echo "安装命令: sudo dpkg -i ${OUT_FILE}"
