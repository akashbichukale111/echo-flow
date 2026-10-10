@echo off
set NODE_BIN=D:\nodejs\node-v20.11.1-win-x64
set PATH=%NODE_BIN%;%PATH%
powershell -ExecutionPolicy Bypass -File .\kill-ports.ps1

start "Echo-Flow Backend" cmd /k "cd echo-flow && call .venv\Scripts\activate.bat && uvicorn backend.main:app --port 5201"
start "Echo-Flow Frontend" cmd /k "cd echo-flow\frontend && %NODE_BIN%\npm.cmd run dev"

start "Rahat-AI Backend" cmd /k "cd rahat-ai\services\api && call .venv\Scripts\activate.bat && uvicorn main:app --port 8030"
start "Rahat-AI Frontend" cmd /k "cd rahat-ai\apps\web && %NODE_BIN%\npm.cmd run dev"

start "WaterPulse Backend" cmd /k "cd waterpulse\backend && call .venv\Scripts\activate.bat && uvicorn app.main:app --port 8000"
start "WaterPulse Frontend" cmd /k "cd waterpulse\frontend && %NODE_BIN%\npm.cmd run dev"

start "Unified Proxy" cmd /k "%NODE_BIN%\node.exe local-proxy.js"
