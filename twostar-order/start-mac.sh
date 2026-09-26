#!/bin/bash
# 투스타 발주 — Mac에서 한 번에 켜기
#   터미널에서:  bash start-mac.sh
# 하는 일: cloudflared 준비 → 외부 https 주소 발급 → 서버 켜기 → 오픈빌더에 넣을 스킬 URL 안내
# 끄기: 이 터미널 창에서 control + C

set -u
cd "$(dirname "$0")"
DATA=./data
mkdir -p "$DATA" ./bin

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n\n' "$*"; exit 1; }

# 1) Node.js 확인 (22.13 이상)
command -v node >/dev/null 2>&1 || fail "Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 내려받아 설치한 뒤 다시 실행해 주세요."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "Node.js 버전이 낮습니다 ($(node -v)). https://nodejs.org 에서 LTS 버전을 새로 설치해 주세요."

# 2) cloudflared 준비 (없으면 자동으로 내려받음)
CF=$(command -v cloudflared || true)
if [ -z "$CF" ]; then
  CF=./bin/cloudflared
  if [ ! -x "$CF" ]; then
    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64) PKG=cloudflared-darwin-arm64.tgz ;;
      Darwin-*) PKG=cloudflared-darwin-amd64.tgz ;;
      Linux-x86_64) PKG=cloudflared-linux-amd64 ;;
      *) fail "이 컴퓨터용 cloudflared 를 찾지 못했습니다. brew install cloudflared 로 설치해 주세요." ;;
    esac
    say "cloudflared 내려받는 중… (처음 한 번)"
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/$PKG"
    if [[ $PKG == *.tgz ]]; then
      curl -fsSL "$URL" | tar -xz -C ./bin || fail "cloudflared 를 내려받지 못했습니다. 인터넷 연결을 확인해 주세요."
    else
      curl -fsSL -o "$CF" "$URL" || fail "cloudflared 를 내려받지 못했습니다."
    fi
    chmod +x "$CF"
  fi
fi

# 3) 설정 파일 (처음 한 번 만들고 계속 사용)
CONF="$DATA/settings.env"
if [ ! -f "$CONF" ]; then
  rand() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }
  {
    echo "ADMIN_PASSWORD=$(rand 6)"
    echo "SKILL_KEY=$(rand 18)"
    echo "BLOCK_ID=6ab764d9f6804a5978559653"
    echo "MIN_ORDER=0"
    echo "PORT=8080"
  } > "$CONF"
  chmod 600 "$CONF"
  say "설정 파일을 만들었습니다: $CONF (비밀번호·키가 들어 있으니 남에게 보내지 마세요)"
fi
set -a; . "$CONF"; set +a

# 4) 샘플 품목·매장 (데이터가 없을 때만)
if [ ! -f "$DATA/order.db" ]; then
  say "샘플 품목과 매장을 넣습니다 (데모용)"
  node --disable-warning=ExperimentalWarning scripts/seed.js
fi

# 5) 외부 https 주소 만들기
say "외부 주소 만드는 중…"
LOG="$DATA/tunnel.log"
: > "$LOG"
"$CF" tunnel --no-autoupdate --url "http://localhost:$PORT" > "$LOG" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null' EXIT
PUBLIC_URL=""
for _ in $(seq 1 40); do
  PUBLIC_URL=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$PUBLIC_URL" ] && break
  kill -0 $CF_PID 2>/dev/null || break
  sleep 1
done
[ -n "$PUBLIC_URL" ] || fail "외부 주소를 받지 못했습니다. $LOG 내용을 캡처해서 보내 주세요."
export PUBLIC_URL

SKILL_URL="$PUBLIC_URL/kakao/skill?key=$SKILL_KEY"
command -v pbcopy >/dev/null 2>&1 && printf '%s' "$SKILL_URL" | pbcopy
cat <<EOF

┌──────────────────────────────────────────────────────────────
│ ✅ 투스타 발주 서버가 켜집니다
│
│ 관리자 화면 : $PUBLIC_URL/admin
│ 관리자 비번 : $ADMIN_PASSWORD
│
│ 오픈빌더 스킬 URL (클립보드에 복사됨 — 붙여넣기만 하세요)
│   $SKILL_URL
│
│ ※ 이 창을 닫거나 Mac 이 잠들면 챗봇이 멈춥니다.
│ ※ 다시 켤 때마다 주소가 바뀌므로 오픈빌더 스킬 URL 도 다시 붙여넣어 주세요.
│ ※ 끄기: control + C
└──────────────────────────────────────────────────────────────

EOF

# 6) 서버 실행 (실행 중에는 Mac 이 잠들지 않게)
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -is node --disable-warning=ExperimentalWarning src/server.js
else
  node --disable-warning=ExperimentalWarning src/server.js
fi
