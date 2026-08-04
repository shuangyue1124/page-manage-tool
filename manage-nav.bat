@echo off
rem ============================================
rem  Nav Manager - double-click to edit your page
rem  Changes are pushed to GitHub automatically,
rem  Cloudflare Pages rebuilds the site.
rem ============================================
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Please install Node.js 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\manage.mjs" interactive

echo.
pause
