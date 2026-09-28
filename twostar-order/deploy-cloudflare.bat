@echo off
rem Twostar order - deploy to Cloudflare (Windows). Double-click to run.
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0scripts\deploy-cloudflare.js" (
  echo.
  echo [!] scripts\deploy-cloudflare.js not found. Please EXTRACT the zip first ^(right click - Extract All^).
  echo [!] zip 을 오른쪽 클릭 - [압축 풀기] 한 뒤, 풀린 twostar-order 폴더 안에서 실행해 주세요.
  echo.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)
node "%~dp0scripts\deploy-cloudflare.js"
echo.
pause
