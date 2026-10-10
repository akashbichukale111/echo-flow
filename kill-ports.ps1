$ports = @(5201, 8030, 8000, 5174, 5200, 5173, 8080)
foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Killing process $($proc.Name) (PID: $($proc.Id)) on port $port"
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
Write-Host "Ports cleared."
