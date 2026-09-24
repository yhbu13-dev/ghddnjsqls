# 배포

사장님·기사 링크가 카카오톡에서 열려야 하므로 **HTTPS 도메인**이 필요합니다(예: `ops.회사.kr`). 50~500개 매장 파일럿은 1 vCPU · 1GB 메모리 VM 한 대로 충분합니다. 사장님 연락처가 들어가므로 **서울 리전**을 권장합니다.

서버에 올라가는 것은 **`dist/bevflow.js` 파일 하나**입니다. 데이터는 `/opt/bevflow/data`, 백업은 `/opt/bevflow/backups`에 쌓입니다.

## A. GitHub Actions로 배포 (권장)

한 번 설정해 두면 Actions 탭에서 **Deploy → Run workflow** 버튼으로 설치·업데이트합니다. 테스트를 통과한 버전만 올라가고, 새 버전이 시작되지 않으면 직전 버전으로 자동 복구됩니다.

### 1. 서버 만들기 (예: AWS Lightsail 서울)

1. Lightsail → **인스턴스 생성** → 리전 **서울(ap-northeast-2)** · 플랫폼 Linux · 블루프린트 **OS 전용 → Ubuntu 24.04 LTS** · 1GB 메모리 이상
2. SSH 키: 기본 키를 쓰면 **계정 → SSH 키**에서 `.pem`을 내려받습니다(새 키를 만들어도 됩니다).
3. **네트워킹 → 고정 IP 생성**으로 인스턴스에 붙입니다.
4. **네트워킹 → IPv4 방화벽**에 **HTTPS(443)** 규칙을 추가합니다(SSH 22 · HTTP 80은 기본으로 열려 있음).

다른 클라우드(NCP · GCP · EC2 등)도 Ubuntu 22.04/24.04 또는 Debian 12에, 비밀번호 없이 `sudo`를 쓰는 SSH 계정이면 됩니다.

### 2. 도메인 연결

DNS에 **A 레코드** `ops.회사.kr → 고정 IP`를 추가합니다. 인증서(Let's Encrypt)는 첫 배포 때 자동으로 발급됩니다.

> 도메인이 아직 없으면 `IP의 점을 대시로 바꾼 주소.sslip.io`(예: `3-35-1-20.sslip.io`)로 먼저 열 수 있습니다. 알림톡 템플릿에 넣을 주소는 나중에 실제 도메인으로 바꾸세요.

### 3. GitHub에 설정 넣기

저장소 **Settings → Secrets and variables → Actions**

| 종류 | 이름 | 값 |
|---|---|---|
| Variables | `DEPLOY_HOST` | 고정 IP |
| Variables | `DEPLOY_USER` | `ubuntu` (Lightsail·EC2 Ubuntu 기본 계정) |
| Variables | `DEPLOY_DOMAIN` | `ops.회사.kr` |
| Secrets | `DEPLOY_SSH_KEY` | `.pem` 파일 내용 전체 |
| Secrets | `DEPLOY_ADMIN_EMAIL` | 첫 관리자 이메일 |
| Secrets | `DEPLOY_ADMIN_PASSWORD` | 첫 관리자 비밀번호 (10자 이상) |
| Variables | `DEPLOY_KNOWN_HOSTS` | (권장) 첫 배포 로그의 경고 아래 찍힌 호스트 키 줄들 |
| Variables | `DEPLOY_SSH_PORT` | (선택) 22가 아닐 때 |

관리자 계정은 **첫 배포 때만** 만들어지고, 비밀번호는 계정을 만든 직후 서버 설정 파일에서 지워집니다.

### 4. 배포

Actions → **Deploy** → **Run workflow**. 마지막 단계에서 `https://도메인/healthz`가 응답하면 끝입니다. 이후 업데이트도 같은 버튼입니다.

- 배포 전에 승인을 거치게 하려면 **Settings → Environments → production → Required reviewers**를 켭니다.
- 외부 접속 주소(사장님·기사 링크 주소)는 첫 실행 때 `https://도메인`으로 자동 설정됩니다. 이후에는 [관리 → 운영 설정]에서 바꿉니다.

## B. 서버에서 직접 설치

서버에 저장소를 받은 뒤 같은 스크립트를 직접 실행합니다. 여러 번 실행해도 안전하고, 업데이트도 같은 명령입니다.

```bash
git clone https://github.com/yhbu13-dev/ghddnjsqls.git && cd ghddnjsqls
sudo BEVFLOW_DOMAIN=ops.회사.kr bash deploy/setup-server.sh
sudo journalctl -u bevflow | grep -A2 관리자      # 첫 관리자 임시 비밀번호
```

`deploy/setup-server.sh`가 하는 일:

1. Node.js 22(NodeSource)와 Caddy(공식 저장소)를 설치합니다. 이미 있으면 건너뜁니다.
2. `bevflow` 시스템 계정과 `/opt/bevflow/{data,backups}` 폴더를 만듭니다. 실행 파일은 root 소유라 서비스 계정이 고칠 수 없습니다.
3. `bevflow.js`를 교체합니다. 직전 버전은 `bevflow.js.prev`로 보관합니다.
4. `/etc/bevflow.env`는 처음 한 번만 만듭니다. 이후에는 직접 고친 값을 건드리지 않습니다.
5. systemd 서비스와 매일 04:00(KST) 백업 타이머를 등록하고, Caddy HTTPS를 설정합니다. Caddyfile은 도메인이 바뀔 때만 새로 씁니다.
6. 재시작 후 헬스체크를 합니다. 실패하면 직전 버전으로 되돌리고 실패로 끝냅니다.

## C. Docker Compose

```bash
cd deploy
DOMAIN=ops.회사.kr docker compose up -d --build
docker compose logs bevflow | grep -A3 관리자     # 관리자 임시 비밀번호
docker compose exec bevflow node bevflow.js backup
```

데이터는 `bevflow-data` 볼륨, 백업은 `bevflow-backups` 볼륨에 남습니다.

## 운영 메모

- 서버는 `127.0.0.1:8080`에서만 받고, 외부 요청은 Caddy가 HTTPS로 받아 넘깁니다. `BEVFLOW_TRUST_PROXY=1`이라 세션 쿠키에 `Secure`가 붙고, 로그인 시도 제한이 실제 접속 IP 기준으로 동작합니다. **프록시 없이 외부에 직접 열 때는 이 값을 지우세요.**
- 운영 콘솔을 사무실 IP로만 열려면 `/etc/caddy/Caddyfile`의 주석 블록을 쓰세요. 사장님·기사 링크와 POS 수신 경로는 열어 둡니다.
- 백업 폴더(`/opt/bevflow/backups`, 30일 보관)는 다른 저장소(오브젝트 스토리지 등)로도 복사해 두세요. Lightsail은 **인스턴스 자동 스냅샷**을 켜 두면 서버 전체가 매일 보관됩니다.
- 직전 버전으로 수동 되돌리기: `sudo cp /opt/bevflow/bevflow.js.prev /opt/bevflow/bevflow.js && sudo systemctl restart bevflow`
- 상태 확인: `systemctl status bevflow caddy` · 로그 `journalctl -u bevflow -f` · 헬스체크 `https://도메인/healthz`
