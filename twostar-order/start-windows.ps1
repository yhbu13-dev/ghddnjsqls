# 투스타 발주 — Windows에서 한 번에 켜기
#   start-windows.bat 을 더블클릭하면 이 파일이 실행됩니다.
# 하는 일: cloudflared 준비 → 외부 https 주소 발급 → 서버 켜기 → 오픈빌더에 넣을 스킬 URL 안내
# 끄기: 이 창에서 Ctrl + C (또는 창 닫기)
# ※ Windows 기본 PowerShell 5.1 에서도 돌아가도록 작성 (?: ?? && 같은 새 문법 쓰지 않음)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # 진행 막대를 끄면 다운로드가 훨씬 빠름
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Set-Location -LiteralPath $PSScriptRoot
$Data = Join-Path $PSScriptRoot 'data'
$Bin = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $Data, $Bin | Out-Null

function Say($msg) { Write-Host ''; Write-Host $msg -ForegroundColor Cyan }
function Fail($msg) { Write-Host ''; Write-Host $msg -ForegroundColor Red; Write-Host ''; exit 1 }

# 1) Node.js 확인 (22.13 이상)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전(Windows Installer .msi)을 설치한 뒤, 이 창을 닫고 다시 실행해 주세요.'
}
& node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)"
if ($LASTEXITCODE -ne 0) {
  Fail ("Node.js 버전이 낮습니다 (" + (& node -v) + "). https://nodejs.org 에서 LTS 버전을 새로 설치해 주세요.")
}

# 2) cloudflared 준비 (없으면 자동으로 내려받음)
$cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cfCmd) { $CF = $cfCmd.Source } else {
  $CF = Join-Path $Bin 'cloudflared.exe'
  if (-not (Test-Path -LiteralPath $CF)) {
    Say 'cloudflared 내려받는 중… (처음 한 번, 1분 정도)'
    try {
      Invoke-WebRequest -UseBasicParsing -OutFile $CF `
        -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    } catch {
      Remove-Item -LiteralPath $CF -Force -ErrorAction SilentlyContinue
      Fail ('cloudflared 를 내려받지 못했습니다. 인터넷(회사 방화벽) 연결을 확인해 주세요.' + [Environment]::NewLine + $_.Exception.Message)
    }
  }
}

# 3) 설정 파일 (처음 한 번 만들고 계속 사용)
$Conf = Join-Path $Data 'settings.env'
if (-not (Test-Path -LiteralPath $Conf)) {
  $pw = & node -e "console.log(require('crypto').randomBytes(6).toString('base64url'))"
  $key = & node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
  @(
    "ADMIN_PASSWORD=$pw",
    "SKILL_KEY=$key",
    'BLOCK_ID=6ab764d9f6804a5978559653',
    'MIN_ORDER=0',
    'PORT=8080'
  ) | Set-Content -LiteralPath $Conf -Encoding ASCII
  Say "설정 파일을 만들었습니다: $Conf (비밀번호·키가 들어 있으니 남에게 보내지 마세요)"
}
foreach ($line in Get-Content -LiteralPath $Conf) {
  $i = $line.IndexOf('=')
  if ($i -gt 0 -and -not $line.TrimStart().StartsWith('#')) {
    [Environment]::SetEnvironmentVariable($line.Substring(0, $i).Trim(), $line.Substring($i + 1).Trim(), 'Process')
  }
}
$Port = $env:PORT
if (-not $Port) { $Port = '8080'; $env:PORT = $Port }
$env:HOST = '127.0.0.1'    # 이 PC 안에서만 받음 (외부 연결은 터널이 담당) → 방화벽 경고 창 안 뜸
$env:TRUST_PROXY = '1'     # 터널이 알려 주는 실제 접속자 주소로 로그인 시도 횟수를 센다

# 3-1) 이미 켜진 서버가 있으면 멈춤 (두 번 켜면 주소만 새로 생기고 서버는 부딪힘)
$busy = $false
try { $tc = New-Object Net.Sockets.TcpClient; $tc.Connect('127.0.0.1', [int]$Port); $busy = $tc.Connected; $tc.Close() } catch {}
if ($busy) {
  Fail ("이미 투스타 발주 서버가 켜져 있습니다 (포트 $Port)." + [Environment]::NewLine +
        "먼저 켜 둔 검은 창을 찾아 그대로 쓰시거나, 그 창에서 Ctrl + C 로 끈 뒤 다시 실행해 주세요." + [Environment]::NewLine +
        "(창을 못 찾겠으면 작업 관리자 → node.exe / cloudflared.exe 작업 끝내기)")
}
# 창을 X 로 닫으면 터널(cloudflared)만 남을 수 있어 정리
Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -and ($_.Path -like (Join-Path $Bin '*')) } catch { $false }
} | Stop-Process -Force -ErrorAction SilentlyContinue

# 4) 샘플 품목·매장 (데이터가 없을 때만)
if (-not (Test-Path -LiteralPath (Join-Path $Data 'order.db'))) {
  Say '샘플 품목과 매장을 넣습니다 (데모용)'
  & node --disable-warning=ExperimentalWarning scripts/seed.js
}

# 5) 외부 https 주소 만들기
Say '외부 주소 만드는 중…'
$Log = Join-Path $Data 'tunnel.log'
$LogOut = Join-Path $Data 'tunnel.out.log'
Remove-Item -LiteralPath $Log, $LogOut -Force -ErrorAction SilentlyContinue
$sp = @{
  FilePath = $CF; PassThru = $true
  ArgumentList = @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port")
  RedirectStandardError = $Log; RedirectStandardOutput = $LogOut
}
if ($env:OS -eq 'Windows_NT') { $sp.WindowStyle = 'Hidden' }   # 검은 창 하나 더 뜨지 않게
$tunnel = Start-Process @sp

function Read-Shared($path) {
  # cloudflared 가 쓰는 중인 파일도 읽을 수 있게 공유 모드로 연다
  if (-not (Test-Path -LiteralPath $path)) { return '' }
  $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
  try { return (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() }
}

$PublicUrl = $null
for ($n = 0; $n -lt 40 -and -not $PublicUrl; $n++) {
  Start-Sleep -Seconds 1
  $m = [regex]::Match((Read-Shared $Log) + (Read-Shared $LogOut), 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($m.Success) { $PublicUrl = $m.Value }
  elseif ($tunnel.HasExited) { break }
}
if (-not $PublicUrl) {
  if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
  Fail "외부 주소를 받지 못했습니다. $Log 파일 내용을 캡처해서 보내 주세요. (회사 네트워크가 막고 있을 수 있습니다)"
}
$env:PUBLIC_URL = $PublicUrl

$SkillUrl = "$PublicUrl/kakao/skill?key=$($env:SKILL_KEY)"
try { Set-Clipboard -Value $SkillUrl } catch {}
$bar = '─' * 62
Write-Host ''
Write-Host "┌$bar" -ForegroundColor Green
Write-Host '│ ✅ 투스타 발주 서버가 켜집니다' -ForegroundColor Green
Write-Host '│'
Write-Host "│ 관리자 화면 : $PublicUrl/admin"
Write-Host "│ 관리자 비번 : $($env:ADMIN_PASSWORD)"
Write-Host '│'
Write-Host '│ 오픈빌더 스킬 URL (클립보드에 복사됨 — 붙여넣기만 하세요)'
Write-Host "│   $SkillUrl" -ForegroundColor Yellow
Write-Host '│'
Write-Host '│ ※ 이 창을 닫거나 PC 가 절전/종료되면 챗봇이 멈춥니다.'
Write-Host '│ ※ 다시 켤 때마다 주소가 바뀌므로 오픈빌더 스킬 URL 도 다시 붙여넣고 배포해 주세요.'
Write-Host '│ ※ 끄기: Ctrl + C'
Write-Host "└$bar" -ForegroundColor Green
Write-Host ''

# 6) 서버 실행 (실행 중에는 PC 가 절전으로 들어가지 않게)
$sleepGuard = $false
try {
  Add-Type -Namespace TwoStar -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
  [void][TwoStar.Power]::SetThreadExecutionState([uint32]2147483649)   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  $sleepGuard = $true
} catch {}

try {
  & node --disable-warning=ExperimentalWarning src/server.js
} finally {
  if ($sleepGuard) { [void][TwoStar.Power]::SetThreadExecutionState([uint32]2147483648) }
  if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
}
