$env:TEMP = 'D:\temp'
$env:TMP = 'D:\temp'
$env:TMPDIR = 'D:\temp'
$env:npm_config_cache = 'D:\npm-cache'
$env:PIP_CACHE_DIR = 'D:\pip-cache'
$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + $env:PATH
cd D:\ECHO-FLOW-PLATFORM\waterpulse\backend
if (!(Test-Path .venv)) { python -m venv .venv }
.venv\Scripts\activate
pip install -q -r requirements.txt
uvicorn app.main:app --port 8000
