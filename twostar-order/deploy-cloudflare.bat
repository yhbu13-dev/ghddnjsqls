@echo off
rem Twostar order - deploy to Cloudflare (Windows). Double-click to run.
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0deploy-cloudflare.ps1" (
  echo.
  echo [!] deploy-cloudflare.ps1 not found. Please EXTRACT the zip first ^(right click - Extract All^).
  echo [!] zip 을 오른쪽 클릭 - [압축 풀기] 한 뒤, 풀린 twostar-order 폴더 안에서 실행해 주세요.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-cloudflare.ps1"
echo.
pause
