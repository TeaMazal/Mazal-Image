#!/usr/bin/env bash
# Interactive Linux bootstrap; application source stays pinned to a verified release.
set -Eeuo pipefail

VERSION=v0.1.2
SOURCE_COMMIT=7150f5f2383e9f52a1d77d68041b8b2aba200745
REPOSITORY=https://github.com/TeaMazal/Mazal-Image.git
SITE_NAME='Mazal Image'
PROJECT=mazal-image
INSTALL_DIR=''
PORT=8310
PUBLIC_ORIGIN=''
MAIN_ORIGIN=''
GATEWAY_URL=''
ASSUME_YES=0
INSTALL_DOCKER=0

die() { printf '错误：%s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Mazal Image 安装器（Linux）
无参数运行时从终端询问配置，兼容 curl ... | sudo bash。

参数：
  --public-origin URL   新绘图站 origin，例如 https://image.example.com
  --main-origin URL     主站 origin，例如 https://api.example.com
  --gateway-url URL     主站 API 根地址，默认与主站相同，不要加 /v1
  --name NAME           站点名称，默认 Mazal Image
  --project NAME        独立 Compose 项目名，默认 mazal-image
  --directory PATH      新安装目录，默认 /opt/<项目名>，拒绝已有目录
  --port NUMBER         本机监听端口，默认 8310
  --yes                 使用参数和默认值，不进行交互
  --install-docker      Docker 未安装时，允许使用 Docker 官方安装脚本
  -h, --help            显示帮助

需要 root 权限。已有 Docker 不会被重装或升级。
缺少 git/Python 3 时，仅在 Debian/Ubuntu 获得同意后安装。
脚本不配置 DNS、HTTPS 或主站渠道，不读取原站密钥。
HELP
}
while (($#)); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --yes) ASSUME_YES=1; shift ;;
    --install-docker) INSTALL_DOCKER=1; shift ;;
    --public-origin|--main-origin|--gateway-url|--name|--project|--directory|--port)
      (($# >= 2)) || die "$1 缺少参数"
      case "$1" in
        --public-origin) PUBLIC_ORIGIN=$2 ;;
        --main-origin) MAIN_ORIGIN=$2 ;;
        --gateway-url) GATEWAY_URL=$2 ;;
        --name) SITE_NAME=$2 ;;
        --project) PROJECT=$2 ;;
        --directory) INSTALL_DIR=$2 ;;
        --port) PORT=$2 ;;
      esac
      shift 2 ;;
    *) die "未知参数：$1；使用 --help 查看帮助" ;;
  esac
done

[[ $(uname -s) == Linux ]] || die '请在目标 Linux 服务器运行本命令'
((EUID == 0)) || die '请使用 sudo bash 或 root 运行安装器'

prompt() {
  local variable=$1 label=$2 current answer
  current=${!variable}
  if ((ASSUME_YES)); then return; fi
  if [[ -n $current ]]; then
    printf '%s [%s]：' "$label" "$current" >/dev/tty
  else
    printf '%s：' "$label" >/dev/tty
  fi
  IFS= read -r answer </dev/tty || die '无法读取终端；请填写参数并使用 --yes'
  if [[ -n $answer ]]; then printf -v "$variable" '%s' "$answer"; fi
}
confirm() {
  local answer
  ((ASSUME_YES == 0)) || return 1
  printf '%s [y/N]：' "$1" >/dev/tty
  IFS= read -r answer </dev/tty || return 1
  [[ $answer == y || $answer == Y ]]
}
if ((ASSUME_YES == 0)); then
  if ! ( : </dev/tty ) 2>/dev/null; then
    die '需要可交互终端；自动部署请填写域名参数并使用 --yes'
  fi
fi
printf 'Mazal Image %s：新站安装，不覆盖原站数据。\n' "$VERSION"
prompt PUBLIC_ORIGIN '绘图站地址（含 https://）'
prompt MAIN_ORIGIN '主站地址（含 https://）'
GATEWAY_URL=${GATEWAY_URL:-$MAIN_ORIGIN}
prompt GATEWAY_URL '主站 API 根地址（不要加 /v1）'
prompt SITE_NAME '绘图站名称'
prompt PROJECT '项目名（每个站须不同）'
INSTALL_DIR=${INSTALL_DIR:-/opt/$PROJECT}
prompt INSTALL_DIR '新安装目录'
prompt PORT '本机端口（不要与其他站重复）'
[[ -n $PUBLIC_ORIGIN && -n $MAIN_ORIGIN ]] || die '必须提供绘图站和主站地址'
[[ $PROJECT =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || die '项目名只能使用小写字母、数字、下划线和连字符'
[[ $PORT =~ ^[0-9]{1,5}$ ]] && ((10#$PORT >= 1 && 10#$PORT <= 65535)) || die '端口必须为 1～65535'
PORT=$((10#$PORT))
[[ $INSTALL_DIR == /* && $INSTALL_DIR != / && $INSTALL_DIR != *$'\n'* && $INSTALL_DIR != *$'\r'* ]] || die '安装目录必须为绝对路径'
[[ ! -e $INSTALL_DIR && ! -L $INSTALL_DIR ]] || die "目录已存在，拒绝覆盖：$INSTALL_DIR"
# A caller's environment must not redirect Compose to another site's files or port.
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR COMPOSE_DISABLE_ENV_FILE
unset MI_BIND_ADDRESS MI_PORT MI_SITE_NAME MI_PUBLIC_ORIGIN MI_MAIN_ORIGIN MI_GATEWAY_URL MI_TRUSTED_PROXY_CIDR
unset MI_MEDIA_LIMIT_MB MI_MEDIA_MAX_AGE_HOURS MI_MIN_FREE_MB MI_BACKUP_KEEP MI_BACKUP_LIMIT_MB

trap 'printf "安装未完成。已有站点未被覆盖；如已创建新目录，请保留以便排查：%s\n" "$INSTALL_DIR" >&2' ERR
missing=()
for command in git python3 curl; do
  if ! command -v "$command" >/dev/null 2>&1; then missing+=("$command"); fi
done
if ((${#missing[@]})); then
  if ((ASSUME_YES == 0)); then
    confirm "缺少 ${missing[*]}，是否通过 apt 安装这些依赖" || die '请先安装 git、Python 3、curl'
  fi
  [[ -r /etc/os-release ]] || die '请先手动安装依赖'
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ ${ID:-} == ubuntu || ${ID:-} == debian ]] || die '自动补齐依赖仅支持 Debian/Ubuntu，请手动安装缺少的依赖'
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}" ca-certificates
fi

# Validate values and the listening port before creating any site files.
python3 - "$PUBLIC_ORIGIN" "$MAIN_ORIGIN" "$GATEWAY_URL" "$SITE_NAME" "$PORT" "$INSTALL_DIR" <<'PY'
from pathlib import Path
import shutil
import socket
import sys
from urllib.parse import urlsplit
for index, value in enumerate(sys.argv[1:4]):
    parsed = urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
            parsed.username or parsed.password or parsed.query or parsed.fragment or
            any(c.isspace() for c in value) or (index < 2 and parsed.path not in ('', '/'))):
        raise SystemExit('域名或 API 地址不合法，请填写完整的 http(s) 地址')
    parsed.port
    if index == 2 and parsed.path.rstrip('/').endswith('/v1'):
        raise SystemExit('主站 API 根地址不要加 /v1')
if not sys.argv[4].strip() or len(sys.argv[4].strip()) > 80 or any(c in sys.argv[4] for c in '\r\n'):
    raise SystemExit('站名必须为 1～80 字符且不能包含换行')
ancestor = Path(sys.argv[6]).parent
while not ancestor.exists():
    ancestor = ancestor.parent
if shutil.disk_usage(ancestor).free < 8 * 1024**3:
    raise SystemExit('安装磁盘可用空间不足 8 GiB，请先释放空间或换安装目录')
try:
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', int(sys.argv[5])))
except OSError as error:
    raise SystemExit('本机端口不可用，请另选 --port：' + str(error))
PY

if ! command -v docker >/dev/null 2>&1; then
  if ((INSTALL_DOCKER == 0)); then
    confirm '未安装 Docker，是否使用 Docker 官方脚本安装' || die '请安装 Docker Engine 和 Compose v2，或显式使用 --install-docker'
  fi
  docker_script=$(mktemp /tmp/mazal-docker-install.XXXXXXXX)
  chmod 600 "$docker_script"
  curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 https://get.docker.com -o "$docker_script"
  sh "$docker_script"
  rm -f -- "$docker_script"
fi
docker info >/dev/null || die 'Docker 服务不可用，请先启动 Docker'
docker compose version >/dev/null || die '需要 Docker Compose v2（docker compose）'
projects=$(docker compose ls --all --format json)
printf '%s' "$projects" | python3 -c 'import json,sys; names=[x["Name"] for x in json.load(sys.stdin)]; sys.exit("Compose 项目名已存在，请另选 --project" if sys.argv[1] in names else 0)' "$PROJECT"

git clone --depth 1 --branch "$VERSION" -- "$REPOSITORY" "$INSTALL_DIR"
[[ $(git -C "$INSTALL_DIR" rev-parse HEAD) == "$SOURCE_COMMIT" ]] || die '下载源码的提交与安装器固定版本不符，已停止'
cd -- "$INSTALL_DIR"
python3 scripts/init_site.py \
  --public-origin "$PUBLIC_ORIGIN" --main-origin "$MAIN_ORIGIN" \
  --gateway-url "$GATEWAY_URL" --name "$SITE_NAME" --project "$PROJECT" --port "$PORT"
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
curl --fail --show-error --silent --max-time 15 "http://127.0.0.1:$PORT/healthz" >/dev/null
trap - ERR
printf '\n安装和本机健康检查通过。\n目录：%s\n反向代理目标：http://127.0.0.1:%s\n用户入口：%s/\n管理入口：%s/accounts/\n' "$INSTALL_DIR" "$PORT" "${PUBLIC_ORIGIN%/}" "${PUBLIC_ORIGIN%/}"
printf '管理员密钥：%s/state/config.json 的 auth-key（未在终端显示）。\n' "$INSTALL_DIR"
printf '下一步：配置域名解析和 HTTPS 反代，导入绘图账号，再在主站配置图片渠道及分组权限。\n'
printf '主站渠道基础地址：%s/engine\n文档：https://github.com/TeaMazal/Mazal-Image/blob/main/docs/DEPLOYMENT.md\n' "${PUBLIC_ORIGIN%/}"
