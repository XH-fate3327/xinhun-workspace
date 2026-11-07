@echo off
setlocal
cd /d "%~dp0"
rem Use the bundled portable Node 22 and store data in the local "data" folder
if exist "%~dp0node-runtime\node.exe" set "PATH=%~dp0node-runtime;%PATH%"
set "MUZI_DATA_DIR=%~dp0data"
call npm run app:start
if errorlevel 1 (
  echo.
  echo 心魂工作台启动失败，请确认 node-runtime 目录完整。
  pause
)
endlocal
