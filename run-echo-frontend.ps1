$env:TEMP = 'D:\temp'
$env:TMP = 'D:\temp'
$env:TMPDIR = 'D:\temp'
$env:npm_config_cache = 'D:\npm-cache'
$env:PIP_CACHE_DIR = 'D:\pip-cache'
$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + $env:PATH
cd D:\ECHO-FLOW-PLATFORM\echo-flow\frontend
npm install
npm run dev
