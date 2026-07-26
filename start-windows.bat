@echo off
chcp 65001 >nul
title Lammet ElShella
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  =============================================
  echo   Lazem tenazzel Node.js el awel (marra wa7da bas)
  echo   Men: https://nodejs.org  --  el zorar el akhdar LTS
  echo   Ba3d el tanzeel, sha8al el file dah tani.
  echo  =============================================
  echo.
  pause
  exit /b
)
node server.js
pause
