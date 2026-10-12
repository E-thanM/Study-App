@echo off
rem Double-click to run Study on this PC at http://localhost:5173
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Download the LTS version from https://nodejs.org, install it, then double-click this again.
  pause
  exit /b 1
)
node scripts\start.mjs
pause
