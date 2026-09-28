@echo off
rem Twostar order server - double-click to start (Windows)
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
echo.
pause
