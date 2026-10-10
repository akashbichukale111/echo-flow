$ErrorActionPreference = "Stop"
$env:TEMP = 'D:\temp'
$env:TMP = 'D:\temp'
$env:TMPDIR = 'D:\temp'
$env:PATH = 'D:\nodejs\node-v20.11.1-win-x64;' + $env:PATH
node local-proxy.js
