@echo off
title Build Onyx
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-onyx.ps1"
if errorlevel 1 (
  echo.
  echo Build failed. See the message above.
  pause
  exit /b 1
)
echo.
echo Onyx was built and launched. You can close this window.
timeout /t 8 >nul
