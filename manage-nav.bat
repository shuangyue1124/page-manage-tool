@echo off
rem ============================================
rem  Nav Manager - double-click to edit your page
rem  Changes are pushed to GitHub automatically,
rem  Cloudflare Pages rebuilds the site.
rem  NOTE: keep this file pure ASCII (English only).
rem  All Chinese prompts come from the Node script.
rem ============================================
title Nav Manager
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Please install Node.js 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo.
echo   ==========================================
echo     Nav Manager - navigation page editor
echo     Type a menu number and press Enter.
echo     After editing, choose 7 to push and deploy.
echo   ==========================================
echo.

node "%~dp0scripts\manage.mjs" interactive

echo.
echo   Done. Press any key to exit.
pause >nul
endlocal
