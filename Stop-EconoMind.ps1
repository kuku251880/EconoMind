#Requires -Version 7.4
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:LOCALAPPDATA 'EconoMind/local'
$cluster = Join-Path $runtime 'postgres-data'
$python = [regex]::Escape((Join-Path $PSScriptRoot '.venv/Scripts/python.exe'))
$vite = [regex]::Escape((Join-Path $PSScriptRoot 'frontend/node_modules/vite/bin/vite.js'))

# Match the command lines from Start-EconoMind.ps1, including the project paths.
$services = @(
    @{ Name = 'Vite'; Port = 5173; Image = 'node.exe'; Pattern = "^\s*(?:\x22[^\x22]+\x22|\S+)\s+\x22?$vite\x22?\s+--host 127\.0\.0\.1 --port 5173 --strictPort\s*$" }
    @{ Name = 'FastAPI'; Port = 8000; Image = 'python.exe'; Pattern = "^\s*\x22?$python\x22?\s+-m uvicorn backend\.main:app --host 127\.0\.0\.1 --port 8000\s*$" }
    @{ Name = 'PostgreSQL'; Port = 15432; Image = 'postgres.exe'; Pattern = "(?:^|\s)-D\s+\x22?$([regex]::Escape($cluster))\x22?(?:\s|$)" }
)

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
try {
    $lock = [IO.File]::Open((Join-Path $runtime 'startup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch [IO.IOException] {
    throw 'EconoMind startup or shutdown is already in progress. Try again after it finishes.'
}

$processes = @{}
try {
    # Check every listener before stopping any service.
    $listeners = Get-NetTCPConnection -State Listen
    foreach ($service in $services) {
        $connections = @($listeners | Where-Object LocalPort -eq $service.Port)
        if ($connections.Count -eq 0) { continue }
        if ($connections.Count -ne 1 -or $connections[0].LocalAddress -ne '127.0.0.1') {
            throw "Unexpected listener on port $($service.Port). Check the port owner."
        }

        $ownerId = $connections[0].OwningProcess
        $process = Get-Process -Id $ownerId
        $processes[$service.Name] = $process
        # Retain the Windows process handle while validating identity and stopping it.
        $null = $process.Handle
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId"
        if ($owner.Name -ne $service.Image -or ([string]$owner.CommandLine).Replace('/', '\') -notmatch $service.Pattern) {
            throw "Port $($service.Port) does not belong to the expected EconoMind $($service.Name) process."
        }

        if ($service.Name -eq 'PostgreSQL') {
            $clusterPid = Get-Content -LiteralPath (Join-Path $cluster 'postmaster.pid') -TotalCount 1
            if ($clusterPid -ne [string]$ownerId) { throw 'PostgreSQL cluster PID mismatch.' }
            $pgctl = Join-Path (Split-Path -Parent $owner.ExecutablePath) 'pg_ctl.exe'
            if (-not (Test-Path -LiteralPath $pgctl -PathType Leaf)) { throw "Missing $pgctl" }
        }
    }

    foreach ($service in $services) {
        $process = $processes[$service.Name]
        if (-not $process -or $process.HasExited) {
            Write-Host "$($service.Name) is already stopped."
            continue
        }
        if ($service.Name -eq 'PostgreSQL') {
            & $pgctl -D $cluster -m fast -w stop
            if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL shutdown failed.' }
        } else {
            $process.Kill()
        }
        if (-not $process.WaitForExit(10000)) { throw "$($service.Name) did not exit in time." }
        Write-Host "Stopped $($service.Name) (port $($service.Port))."
    }

    $remaining = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $services.Port }
    if ($remaining) { throw "Ports still listening: $($remaining.LocalPort -join ', ')." }
    Write-Host 'Ports 5173, 8000 and 15432 are free.'
} finally {
    foreach ($process in $processes.Values) { $process.Dispose() }
    $lock.Dispose()
}
