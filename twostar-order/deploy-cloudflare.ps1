# 투스타 발주 — Cloudflare 에 올리기 (Windows)
#   deploy-cloudflare.bat 을 더블클릭하면 이 파일이 실행됩니다.
# 하는 일: Cloudflare 로그인 → D1 데이터베이스 만들기 → 배포 → 관리자 비밀번호 → 스킬 URL 복사
# 코드를 고친 뒤 다시 올릴 때도 같은 파일을 실행하면 됩니다 (데이터는 그대로 유지).
# ※ Windows 기본 PowerShell 5.1 에서도 돌아가도록 작성

$ErrorActionPreference = 'Continue'   # wrangler 가 알림을 오류 출력으로 내보내도 멈추지 않게 (결과는 직접 확인)
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
Set-Location -LiteralPath $PSScriptRoot

$DbName = 'twostar-order'
function Say($msg) { Write-Host ''; Write-Host $msg -ForegroundColor Cyan }
function Fail($msg) { Write-Host ''; Write-Host $msg -ForegroundColor Red; Write-Host ''; exit 1 }
function W { & npx --yes wrangler@4 @args }          # 화면에 그대로 보여 주며 실행
function WOut { & npx --yes wrangler@4 @args 2>$null } # 결과(글자)만 받기

# 1) Node.js 확인
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤, 이 창을 닫고 다시 실행해 주세요.'
}

# 2) Cloudflare 로그인
Say '1/5  Cloudflare 로그인 확인 중… (처음에는 wrangler 를 내려받느라 1~2분 걸립니다)'
# Windows 의 npx 는 실패 신호(종료 코드)를 잃어버릴 수 있어 응답 내용을 직접 확인한다
function Test-Login { return (((WOut whoami --json) -join '') -match '"loggedIn"\s*:\s*true') }
if (-not (Test-Login)) {
  Say '브라우저가 열리면 Cloudflare 에 로그인하고 [Allow] 를 눌러 주세요. (끝나면 브라우저는 닫고 이 창으로 돌아오세요)'
  W login
  if (-not (Test-Login)) { Fail '로그인이 되지 않았습니다. 이 창을 닫고 deploy-cloudflare.bat 을 다시 실행해 주세요.' }
}
Write-Host '로그인 확인 완료'

# 3) D1 데이터베이스 (없으면 만들기)
function Find-DbId {
  $text = (WOut d1 list --json) -join "`n"
  $i = $text.IndexOf('[')
  if ($i -lt 0) { return $null }
  try { $list = $text.Substring($i) | ConvertFrom-Json } catch { return $null }
  foreach ($d in $list) { if ($d.name -eq $DbName) { return $d.uuid } }
  return $null
}
Say '2/5  데이터베이스(D1) 확인 중…'
$DbId = Find-DbId
if (-not $DbId) {
  Write-Host '데이터베이스를 새로 만듭니다 (아시아 지역).'
  '' | & npx --yes wrangler@4 d1 create $DbName --location apac   # 입력을 넘겨 질문 없이 진행
  $DbId = Find-DbId
  if (-not $DbId) { Fail '데이터베이스를 만들지 못했습니다. 위 메시지를 캡처해서 보내 주세요.' }
}
Write-Host "데이터베이스: $DbName ($DbId)"
$toml = Get-Content -LiteralPath 'wrangler.toml' -Raw -Encoding UTF8
$toml = [regex]::Replace($toml, 'database_id = "[^"]*"', "database_id = `"$DbId`"")
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'wrangler.toml'), $toml, (New-Object Text.UTF8Encoding($false)))

# 4) 배포
Say '3/5  Cloudflare 에 올리는 중…'
$deploy = W deploy 2>&1 | ForEach-Object { $s = "$_"; Write-Host $s; $s }
$m = [regex]::Match(($deploy -join "`n"), 'https://[a-z0-9.-]+\.workers\.dev')
if (-not $m.Success) { Fail '배포에 실패했거나 주소를 찾지 못했습니다. 위 메시지를 캡처해서 보내 주세요.' }
$Url = $m.Value

# 5) 관리자 비밀번호 (처음 한 번. 이미 있으면 바꿀지 물어봄)
Say '4/5  관리자 비밀번호'
$secrets = (WOut secret list --format json) -join "`n"
$hasPw = $secrets -match '"ADMIN_PASSWORD"'
$Password = $env:TS_ADMIN_PASSWORD   # 자동화용 (보통은 비워 두고 아래에서 입력)
$ask = (-not $hasPw) -and (-not $Password)
if ($hasPw) {
  $ans = Read-Host '관리자 비밀번호가 이미 있습니다. 바꿀까요? (y = 바꾸기, 엔터 = 그대로)'
  $ask = $ans -match '^[yYㅛ]'
}
if ($Password -and -not $hasPw) {
  if ($Password.Length -lt 8) { Fail 'TS_ADMIN_PASSWORD 는 8자 이상이어야 합니다.' }
  $put = ($Password | & npx --yes wrangler@4 secret put ADMIN_PASSWORD 2>&1 | ForEach-Object { $x = "$_"; Write-Host $x; $x }) -join "`n"
  if ($put -notmatch 'Success') { Fail '비밀번호를 저장하지 못했습니다. 위 메시지를 캡처해서 보내 주세요.' }
} elseif ($ask) {
  while ($true) {
    $sec = Read-Host '새 관리자 비밀번호 (8자 이상, 입력한 글자는 안 보입니다)' -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    if ($Password.Length -ge 8) { break }
    Write-Host '8자 이상으로 입력해 주세요.' -ForegroundColor Yellow
  }
  $put = ($Password | & npx --yes wrangler@4 secret put ADMIN_PASSWORD 2>&1 | ForEach-Object { $x = "$_"; Write-Host $x; $x }) -join "`n"
  if ($put -notmatch 'Success') { Fail '비밀번호를 저장하지 못했습니다. 위 메시지를 캡처해서 보내 주세요.' }
} elseif (-not $Password) {
  $sec = Read-Host '스킬 URL 을 가져오려면 지금 관리자 비밀번호를 입력해 주세요 (건너뛰려면 엔터)' -AsSecureString
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

# 6) 스킬 URL 가져오기 (관리자로 로그인해서)
Say '5/5  오픈빌더 스킬 URL 가져오는 중…'
$SkillUrl = $null
if ($Password) {
  for ($n = 0; $n -lt 6 -and -not $SkillUrl; $n++) {
    try {
      Start-Sleep -Seconds 3   # 새 비밀번호가 반영될 때까지 잠깐
      $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      $body = @{ password = $Password } | ConvertTo-Json
      $null = Invoke-WebRequest -UseBasicParsing -Uri "$Url/admin/login" -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json' -WebSession $session
      $data = Invoke-RestMethod -Uri "$Url/api/admin/data" -WebSession $session
      $SkillUrl = $data.skillUrl
    } catch {}
  }
}
if ($SkillUrl) { try { Set-Clipboard -Value $SkillUrl } catch {} }

$bar = '─' * 62
Write-Host ''
Write-Host "┌$bar" -ForegroundColor Green
Write-Host '│ ✅ Cloudflare 에 올렸습니다 (주소는 앞으로 바뀌지 않습니다)' -ForegroundColor Green
Write-Host '│'
Write-Host "│ 관리자 화면 : $Url/admin"
Write-Host '│'
if ($SkillUrl) {
  Write-Host '│ 오픈빌더 스킬 URL (클립보드에 복사됨 — 붙여넣기만 하세요)'
  Write-Host "│   $SkillUrl" -ForegroundColor Yellow
} else {
  Write-Host '│ 오픈빌더 스킬 URL: 관리자 화면 → [매장] 탭 맨 위에서 복사하세요'
}
Write-Host '│'
Write-Host '│ ※ 이제 PC 를 꺼도 챗봇이 동작합니다. (예전 검은 창 서버는 꺼도 됩니다)'
Write-Host '│ ※ 코드를 새로 받은 뒤 이 파일을 다시 실행하면 업데이트됩니다. 데이터는 그대로입니다.'
Write-Host "└$bar" -ForegroundColor Green
Write-Host ''
