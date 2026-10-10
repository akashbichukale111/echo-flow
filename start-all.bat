@echo off
set TEMP=D:\temp
set TMP=D:\temp
set TMPDIR=D:\temp
set npm_config_cache=D:\npm-cache
set PIP_CACHE_DIR=D:\pip-cache
set PATH=D:\nodejs\node-v20.11.1-win-x64;%PATH%

echo Killing old ports...
powershell -ExecutionPolicy Bypass -File .\kill-ports.ps1

echo Starting ECHO-FLOW PLATFORM Dev Servers on D: Drive...

start "Echo-Flow Backend" cmd /c "cd echo-flow && if not exist .venv (python -m venv .venv) && call .venv\Scripts\activate.bat && pip install -q -e . && uvicorn backend.main:app --port 5201"
start "Echo-Flow Frontend" cmd /k "cd echo-flow\frontend && call npm install && npm run dev"

start "Rahat-AI Backend" cmd /c "cd rahat-ai\services\api && if not exist .venv (python -m venv .venv) && call .venv\Scripts\activate.bat && pip install -q -r requirements.txt && uvicorn main:app --port 8030"
start "Rahat-AI Frontend" cmd /k "cd rahat-ai\apps\web && call npm install && npm run dev"

start "WaterPulse Backend" cmd /c "cd waterpulse\backend && if not exist .venv (python -m venv .venv) && call .venv\Scripts\activate.bat && pip install -q -r requirements.txt && uvicorn app.main:app --port 8000"
start "WaterPulse Frontend" cmd /k "cd waterpulse\frontend && call npm install && npm run dev"

start "Unified Proxy" cmd /k "node local-proxy.js"

echo All servers started. Wait a minute for NPM install.
