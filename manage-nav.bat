@echo off
rem ============================================
rem  Nav Manager - double-click to edit your page
rem  Changes are pushed to GitHub automatically,
rem  Cloudflare Pages rebuilds the site.
rem ============================================
title Nav Manager - 导航页管理
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
echo     Nav Manager - 导航页管理工具
echo     输入菜单编号后按回车键即可操作
echo     修改完链接后选 7 推送部署
echo   ==========================================
echo.

node "%~dp0scripts\manage.mjs" interactive

echo.
echo   操作完成，窗口即将关闭... 按任意键退出
pause >nul
endlocal
