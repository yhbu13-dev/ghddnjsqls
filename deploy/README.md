# 배포

사장님·기사 링크가 카카오톡에서 열려야 하므로 **HTTPS 도메인**이 필요합니다(예: `ops.회사.kr`). 50~500개 매장 파일럿은 1 vCPU · 1GB 메모리 VM 한 대로 충분합니다.

서버에 올릴 것은 **`dist/bevflow.js` 파일 하나**입니다(`npm run bundle`로 소스에서 다시 만들 수 있습니다). 데이터는 그 파일 옆 `data/`, 백업은 `backups/`에 쌓입니다.

## A. VM + systemd + Caddy (권장)

```bash
# Node.js 22.13 이상, Caddy 2 설치 후
sudo useradd --system --home /opt/bevflow --shell /usr/sbin/nologin bevflow
sudo mkdir -p /opt/bevflow/data /opt/bevflow/backups
sudo cp dist/bevflow.js /opt/bevflow/ && sudo chown -R bevflow:bevflow /opt/bevflow

sudo cp deploy/bevflow.env.example /etc/bevflow.env && sudo chmod 600 /etc/bevflow.env
sudo cp deploy/bevflow.service deploy/bevflow-backup.service deploy/bevflow-backup.timer /etc/systemd/system/
# node 경로가 /usr/bin/node가 아니면 bevflow.service의 ExecStart를 `which node` 결과로 바꿉니다
sudo systemctl daemon-reload
sudo systemctl enable --now bevflow bevflow-backup.timer
journalctl -u bevflow -n 20        # 관리자 임시 비밀번호 확인

sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # ops.example.com → 실제 도메인으로 수정
sudo systemctl reload caddy
```

- 서버는 `127.0.0.1:8080`에서만 받고, 외부 요청은 Caddy가 HTTPS로 받아 넘깁니다.
- `BEVFLOW_TRUST_PROXY=1`이라 세션 쿠키에 `Secure`가 붙고, 로그인 시도 제한이 실제 접속 IP 기준으로 동작합니다. **프록시 없이 외부에 직접 열 때는 이 값을 지우세요.**
- 운영 콘솔을 사무실 IP로만 열고 싶으면 `Caddyfile`의 주석 블록을 쓰세요. 사장님·기사 링크와 POS 수신 경로는 열어 둡니다.
- 백업은 매일 04:00(KST) `backups/`에 쌓이고 30일 지나면 지워집니다. 이 폴더를 다른 저장소로 복사해 두세요.

업데이트:

```bash
sudo cp dist/bevflow.js /opt/bevflow/ && sudo chown bevflow:bevflow /opt/bevflow/bevflow.js
sudo systemctl restart bevflow     # DB 스키마는 시작할 때 자동으로 올라갑니다
```

## B. Docker Compose (HTTPS 포함)

```bash
cd deploy
DOMAIN=ops.example.com docker compose up -d --build
docker compose logs bevflow | grep -A3 관리자     # 관리자 임시 비밀번호
docker compose exec bevflow node bevflow.js backup
```

데이터는 `bevflow-data` 볼륨, 백업은 `bevflow-backups` 볼륨에 남습니다. 이미지에는 `bevflow.js` 하나만 들어갑니다. 이미지만 쓰려면 저장소 루트에서 `docker build -f deploy/Dockerfile -t bevflow .`

## 배포 뒤 꼭 할 것

1. 관리자로 로그인해 비밀번호를 바꿉니다.
2. [관리 → 운영 설정 → 외부 접속 주소]를 `https://실제-도메인`으로 바꿉니다. 이 값으로 사장님·기사 링크가 만들어집니다.
3. `https://실제-도메인/healthz`가 `{"ok":true,…}`를 돌려주는지 확인합니다(모니터링 도구에 등록 권장).
