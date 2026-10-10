$ErrorActionPreference = "Stop"
$env:PATH = "D:\nodejs\node-v20.11.1-win-x64;" + $env:PATH

.\kill-ports.ps1

Write-Host "Starting ECHO-FLOW PLATFORM Dev Servers..." -ForegroundColor Cyan

# 1. Start Echo-Flow Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + `$env:PATH; cd echo-flow; if (!(Test-Path .venv)) { python -m venv .venv }; .venv\Scripts\activate; pip install -q -e .; uvicorn backend.main:app --port 5201" -WindowStyle Minimized

# 2. Start Echo-Flow Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + `$env:PATH; cd echo-flow\frontend; npm install; npm run dev" -WindowStyle Minimized

# 3. Start Rahat-AI Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + `$env:PATH; cd rahat-ai\services\api; if (!(Test-Path .venv)) { python -m venv .venv }; .venv\Scripts\activate; pip install -q -r requirements.txt; uvicorn main:app --port 8030" -WindowStyle Minimized

# 4. Start Rahat-AI Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + `$env:PATH; cd rahat-ai\apps\web; npm install; npm run dev" -WindowStyle Minimized

# 5. Start WaterPulse Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + `$env:PATH; cd waterpulse\backend; if (!(Test-Path .venv)) { python -m venv .venv }; .venv\Scripts\activate; pip install -q -r requirements.txt; uvicorn app.main:app --port 8000" -WindowStyle Minimized

# 6. Start WaterPulse Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + `$env:PATH; cd waterpulse\frontend; npm install; npm run dev" -WindowStyle Minimized

# 7. Start Unified Proxy
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + `$env:PATH; node local-proxy.js" -WindowStyle Minimized

Write-Host "All processes started in background windows."
Write-Host "Please wait a minute for npm install to finish in all windows."
Write-Host "LIVE PORT LINK: http://localhost:8080" -ForegroundColor Green
