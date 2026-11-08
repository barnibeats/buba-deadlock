@echo off
cd /d "%~dp0"
title Soulsmith build
set ELECTRON_RUN_AS_NODE=
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies...
  call npm install || goto :fail
  node node_modules\electron\install.js || goto :fail
)
echo Building Soulsmith...
call npm run package || goto :fail
echo.
echo Done: release\Soulsmith-win32-x64\Soulsmith.exe
pause
exit /b 0
:fail
echo Build failed.
pause
exit /b 1
