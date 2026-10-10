$ErrorActionPreference = "Stop"

# Set D: drive for all temps and caches
$env:TEMP = 'D:\temp'
$env:TMP = 'D:\temp'
$env:TMPDIR = 'D:\temp'
$env:npm_config_cache = 'D:\npm-cache'
$env:PIP_CACHE_DIR = 'D:\pip-cache'

# IMPORTANT: Path to Node.js
$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + $env:PATH

# Kill old ports
.\kill-ports.ps1

Write-Host "Starting servers in background and writing to logs..."

# Start proxy directly
Start-Process node -ArgumentList "local-proxy.js" -RedirectStandardOutput "proxy_out.log" -RedirectStandardError "proxy_err.log" -WindowStyle Hidden

# Start Echo Flow
Start-Process cmd -ArgumentList "/c `"cd echo-flow\frontend && npm install && npm run dev`"" -RedirectStandardOutput "echo_front.log" -RedirectStandardError "echo_front_err.log" -WindowStyle Hidden
Start-Process cmd -ArgumentList "/c `"cd echo-flow && if not exist .venv (python -m venv .venv) && call .venv\Scripts\activate.bat && pip install -q -e . && uvicorn backend.main:app --port 5201`"" -RedirectStandardOutput "echo_back.log" -RedirectStandardError "echo_back_err.log" -WindowStyle Hidden

# Start Rahat AI
Start-Process cmd -ArgumentList "/c `"cd rahat-ai\apps\web && npm install && npm run dev`"" -RedirectStandardOutput "rahat_front.log" -RedirectStandardError "rahat_front_err.log" -WindowStyle Hidden
Start-Process cmd -ArgumentList "/c `"cd rahat-ai\services\api && if not exist .venv (python -m venv .venv) && call .venv\Scripts\activate.bat && pip install -q -r requirements.txt && uvicorn main:app --port 8030`"" -RedirectStandardOutput "rahat_back.log" -RedirectStandardError "rahat_back_err.log" -WindowStyle Hidden

# Start WaterPulse
Start-Process cmd -ArgumentList "/c `"cd waterpulse\frontend && npm install && npm run dev`"" -RedirectStandardOutput "water_front.log" -RedirectStandardError "water_front_err.log" -WindowStyle Hidden
Start-Process cmd -ArgumentList "/c `"cd waterpulse\backend && if not exist .venv (python -m venv .venv) && call .venv\Scripts\activate.bat && pip install -q -r requirements.txt && uvicorn app.main:app --port 8000`"" -RedirectStandardOutput "water_back.log" -RedirectStandardError "water_back_err.log" -WindowStyle Hidden

Write-Host "All processes launched."
