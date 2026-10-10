@echo off
set "PATH=C:\Users\hp\Desktop\nvm\v24.18.0;%PATH%"
cd /d "%~dp0apps\web"
call npm run dev -- --port 5200
