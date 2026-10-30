@echo off
rem Twostar order server - double-click to start (Windows)
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0start-windows.ps1" (
  echo.
  echo [!] start-windows.ps1 not found. Please EXTRACT the zip first ^(right click - Extract All^), then run start-windows.bat inside the extracted twostar-order folder.
  echo [!] zip 파일 안에서 바로 실행하셨습니다. zip 을 오른쪽 클릭 - [압축 풀기] 한 뒤, 풀린 twostar-order 폴더 안의 start-windows.bat 을 실행해 주세요.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
echo.
pause
