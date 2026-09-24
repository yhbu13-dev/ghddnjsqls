#!/usr/bin/env bash
# BevFlow 서버 설치·업데이트 — Ubuntu 22.04/24.04, Debian 12. 여러 번 실행해도 안전합니다.
#
#   sudo BEVFLOW_DOMAIN=ops.example.com bash deploy/setup-server.sh
#
# GitHub Actions 배포(.github/workflows/deploy.yml)도 이 스크립트를 부릅니다.
#   1. Node.js 22(NodeSource) · Caddy(공식 저장소) 설치 — 이미 있으면 건너뜀
#   2. bevflow 계정 · /opt/bevflow/{data,backups}
#   3. bevflow.js 교체 (직전 버전은 bevflow.js.prev로 보관)
#   4. /etc/bevflow.env — 처음 한 번만 생성
#   5. systemd 서비스 · 매일 백업 타이머, Caddy HTTPS
#   6. 재시작 → 헬스체크. 실패하면 직전 버전으로 되돌리고 실패로 끝냄
#
# 입력(환경 변수 또는 같은 폴더의 deploy.env):
#   BEVFLOW_DOMAIN          서비스 도메인 (필수, A 레코드가 이 서버를 가리켜야 인증서가 나옴)
#   BEVFLOW_ADMIN_EMAIL     첫 설치 때 만들 관리자 이메일 (선택)
#   BEVFLOW_ADMIN_PASSWORD  첫 설치 때 관리자 비밀번호 (선택, 서버 시작 후 설정 파일에서 지움)
set -euo pipefail

SRC="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")}" && pwd)"
if [ -f "$SRC/deploy.env" ]; then
  # shellcheck disable=SC1091
  . "$SRC/deploy.env"
  rm -f "$SRC/deploy.env"
fi

APP=/opt/bevflow
ENV_FILE=/etc/bevflow.env
log() { printf '\n▶ %s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "root 권한으로 실행하세요 (sudo)"
{ command -v apt-get && command -v systemctl; } >/dev/null || die "apt와 systemd가 있는 Ubuntu/Debian이 필요합니다"
DOMAIN="${BEVFLOW_DOMAIN:-}"
[ -n "$DOMAIN" ] || die "BEVFLOW_DOMAIN(예: ops.example.com)을 지정하세요"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "도메인 형식이 올바르지 않습니다: $DOMAIN"
BUNDLE="$SRC/bevflow.js"
[ -f "$BUNDLE" ] || BUNDLE="$SRC/../dist/bevflow.js"
[ -f "$BUNDLE" ] || die "bevflow.js를 찾을 수 없습니다 ($SRC)"
for f in bevflow.service bevflow-backup.service bevflow-backup.timer Caddyfile; do
  [ -f "$SRC/$f" ] || die "$f 가 없습니다 ($SRC)"
done
export DEBIAN_FRONTEND=noninteractive

# ── 1. Node.js 22 · Caddy ─────────────────────────────────────────────
if ! command -v curl >/dev/null || ! command -v gpg >/dev/null; then
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg
fi

node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! node_ok; then
  log "Node.js 22 설치 (NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
  node_ok || die "Node.js 22.13 이상을 설치하지 못했습니다"
fi
NODE_BIN="$(command -v node)"

if ! command -v caddy >/dev/null; then
  log "Caddy 설치 (공식 저장소)"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

# ── 2~3. 계정 · 폴더 · 실행 파일 ──────────────────────────────────────
log "bevflow.js 설치 ($("$NODE_BIN" --version))"
id bevflow >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin bevflow
install -d -o root -g bevflow -m 0750 "$APP"
install -d -o bevflow -g bevflow -m 0750 "$APP/data" "$APP/backups"
"$NODE_BIN" --check "$BUNDLE"
if [ -f "$APP/bevflow.js" ]; then cp -p "$APP/bevflow.js" "$APP/bevflow.js.prev"; fi
install -o root -g bevflow -m 0640 "$BUNDLE" "$APP/bevflow.js"

# ── 4. 설정 파일 (처음 한 번만) ───────────────────────────────────────
FIRST_RUN=0
[ -f "$APP/data/bevflow.db" ] || FIRST_RUN=1
if [ ! -f "$ENV_FILE" ]; then
  log "$ENV_FILE 생성"
  (umask 077; cat > "$ENV_FILE" <<EOF
PORT=8080
HOST=127.0.0.1
BEVFLOW_DB=$APP/data/bevflow.db
BEVFLOW_TRUST_PROXY=1
BEVFLOW_PUBLIC_BASE_URL=https://$DOMAIN
EOF
  )
fi
PASSWORD_SET=0
if [ "$FIRST_RUN" = 1 ]; then
  sed -i '/^BEVFLOW_ADMIN_EMAIL=/d; /^BEVFLOW_ADMIN_PASSWORD=/d' "$ENV_FILE"
  if [ -n "${BEVFLOW_ADMIN_EMAIL:-}" ]; then
    [[ "$BEVFLOW_ADMIN_EMAIL" =~ ^[^[:space:]\"\\]+@[^[:space:]\"\\]+$ ]] || die "관리자 이메일 형식이 올바르지 않습니다"
    echo "BEVFLOW_ADMIN_EMAIL=$BEVFLOW_ADMIN_EMAIL" >> "$ENV_FILE"
  fi
  if [ -n "${BEVFLOW_ADMIN_PASSWORD:-}" ]; then
    [ "${#BEVFLOW_ADMIN_PASSWORD}" -ge 10 ] || die "관리자 비밀번호는 10자 이상이어야 합니다"
    [[ "$BEVFLOW_ADMIN_PASSWORD" != *$'\n'* ]] || die "관리자 비밀번호에 줄바꿈을 넣을 수 없습니다"
    pw="${BEVFLOW_ADMIN_PASSWORD//\\/\\\\}"
    printf 'BEVFLOW_ADMIN_PASSWORD="%s"\n' "${pw//\"/\\\"}" >> "$ENV_FILE"
    PASSWORD_SET=1
  fi
fi

# ── 5. systemd · Caddy ───────────────────────────────────────────────
log "systemd 서비스 등록"
for u in bevflow.service bevflow-backup.service bevflow-backup.timer; do
  sed "s#/usr/bin/node#$NODE_BIN#g" "$SRC/$u" > "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable --quiet bevflow.service bevflow-backup.timer

log "Caddy HTTPS 설정 ($DOMAIN)"
install -d -o caddy -g caddy /var/log/caddy
if ! grep -qF "$DOMAIN {" /etc/caddy/Caddyfile 2>/dev/null; then
  # 도메인이 바뀌었거나 첫 설치일 때만 새로 씀 (운영 중 직접 고친 내용은 보존)
  if [ -f /etc/caddy/Caddyfile ]; then cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"; fi
  sed "s/ops\.example\.com/$DOMAIN/g" "$SRC/Caddyfile" > /etc/caddy/Caddyfile.new
  caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null
  mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi
systemctl enable --quiet caddy
systemctl reload-or-restart caddy

# ── 6. 재시작 · 헬스체크 · 실패 시 되돌리기 ───────────────────────────
healthy() {
  for _ in $(seq 1 30); do
    curl -fsS --max-time 2 http://127.0.0.1:8080/healthz >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
log "서버 재시작"
systemctl restart bevflow.service
systemctl start bevflow-backup.timer
if ! healthy; then
  journalctl -u bevflow -n 40 --no-pager | grep -v "임시 비밀번호" || true
  if [ -f "$APP/bevflow.js.prev" ]; then
    printf '✖ 새 버전이 시작되지 않아 직전 버전으로 되돌립니다\n' >&2
    install -o root -g bevflow -m 0640 "$APP/bevflow.js.prev" "$APP/bevflow.js"
    systemctl restart bevflow.service
    healthy && printf '  직전 버전으로 복구했습니다\n' >&2
  fi
  exit 1
fi
if [ "$PASSWORD_SET" = 1 ]; then
  sed -i '/^BEVFLOW_ADMIN_PASSWORD=/d' "$ENV_FILE"   # 계정이 만들어졌으니 설정 파일에서 지움
fi

log "배포 완료 → https://$DOMAIN"
if [ "$FIRST_RUN" = 1 ] && [ "$PASSWORD_SET" = 0 ]; then
  echo "  첫 관리자 임시 비밀번호: 서버에서  sudo journalctl -u bevflow | grep -A2 관리자"
fi
