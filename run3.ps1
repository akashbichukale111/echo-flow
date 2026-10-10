$ErrorActionPreference = "Stop"

if (!(Test-Path "D:\temp")) { New-Item -ItemType Directory -Path "D:\temp" | Out-Null }
if (!(Test-Path "D:\npm-cache")) { New-Item -ItemType Directory -Path "D:\npm-cache" | Out-Null }
if (!(Test-Path "D:\pip-cache")) { New-Item -ItemType Directory -Path "D:\pip-cache" | Out-Null }

.\kill-ports.ps1

Write-Host "Starting ECHO-FLOW PLATFORM Dev Servers on D: Drive..." -ForegroundColor Cyan

$scriptPath = "D:\ECHO-FLOW-PLATFORM\start-all-bg.ps1"

$commonEnv = @"
`$env:TEMP = 'D:\temp'
`$env:TMP = 'D:\temp'
`$env:TMPDIR = 'D:\temp'
`$env:npm_config_cache = 'D:\npm-cache'
`$env:PIP_CACHE_DIR = 'D:\pip-cache'
`$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + `$env:PATH
"@

@"
$commonEnv
cd D:\ECHO-FLOW-PLATFORM\echo-flow
if (!(Test-Path .venv)) { python -m venv .venv }
.venv\Scripts\activate
pip install -q -e .
uvicorn backend.main:app --port 5201
"@ | Out-File -FilePath "D:\ECHO-FLOW-PLATFORM\run-echo-backend.ps1" -Encoding utf8

@"
$commonEnv
cd D:\ECHO-FLOW-PLATFORM\echo-flow\frontend
npm install
npm run dev
"@ | Out-File -FilePath "D:\ECHO-FLOW-PLATFORM\run-echo-frontend.ps1" -Encoding utf8

@"
$commonEnv
cd D:\ECHO-FLOW-PLATFORM\rahat-ai\services\api
if (!(Test-Path .venv)) { python -m venv .venv }
.venv\Scripts\activate
pip install -q -r requirements.txt
uvicorn main:app --port 8030
"@ | Out-File -FilePath "D:\ECHO-FLOW-PLATFORM\run-rahat-backend.ps1" -Encoding utf8

@"
$commonEnv
cd D:\ECHO-FLOW-PLATFORM\rahat-ai\apps\web
npm install
npm run dev
"@ | Out-File -FilePath "D:\ECHO-FLOW-PLATFORM\run-rahat-frontend.ps1" -Encoding utf8

@"
$commonEnv
cd D:\ECHO-FLOW-PLATFORM\waterpulse\backend
if (!(Test-Path .venv)) { python -m venv .venv }
.venv\Scripts\activate
pip install -q -r requirements.txt
uvicorn app.main:app --port 8000
"@ | Out-File -FilePath "D:\ECHO-FLOW-PLATFORM\run-waterpulse-backend.ps1" -Encoding utf8

@"
$commonEnv
cd D:\ECHO-FLOW-PLATFORM\waterpulse\frontend
npm install
npm run dev
"@ | Out-File -FilePath "D:\ECHO-FLOW-PLATFORM\run-waterpulse-frontend.ps1" -Encoding utf8

Start-Process powershell -ArgumentList "-NoExit", "-File", "D:\ECHO-FLOW-PLATFORM\run-echo-backend.ps1" -WindowStyle Minimized
Start-Process powershell -ArgumentList "-NoExit", "-File", "D:\ECHO-FLOW-PLATFORM\run-echo-frontend.ps1" -WindowStyle Minimized
Start-Process powershell -ArgumentList "-NoExit", "-File", "D:\ECHO-FLOW-PLATFORM\run-rahat-backend.ps1" -WindowStyle Minimized
Start-Process powershell -ArgumentList "-NoExit", "-File", "D:\ECHO-FLOW-PLATFORM\run-rahat-frontend.ps1" -WindowStyle Minimized
Start-Process powershell -ArgumentList "-NoExit", "-File", "D:\ECHO-FLOW-PLATFORM\run-waterpulse-backend.ps1" -WindowStyle Minimized
Start-Process powershell -ArgumentList "-NoExit", "-File", "D:\ECHO-FLOW-PLATFORM\run-waterpulse-frontend.ps1" -WindowStyle Minimized
