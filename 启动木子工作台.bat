@echo off
setlocal
cd /d "%~dp0"
rem Use portable Node 22 (better-sqlite3 needs a Node 22 prebuilt binary)
if exist "D:\Github tools\node-v22.23.4\node.exe" set "PATH=D:\Github tools\node-v22.23.4;%PATH%"
call npm run app:start
if errorlevel 1 (
  echo.
  echo 木子工作台启动失败，请确认已经安装 Node.js 22 或更高版本。
  pause
)
endlocal
