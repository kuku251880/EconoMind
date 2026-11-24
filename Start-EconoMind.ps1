#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$PostgresBin,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$project = $PSScriptRoot
$frontend = Join-Path $project 'frontend'
$runtime = Join-Path $env:LOCALAPPDATA 'EconoMind/local'
$cluster = Join-Path $runtime 'postgres-data'
$logs = Join-Path $runtime 'logs'
$python = Join-Path $project '.venv/Scripts/python.exe'
$vite = Join-Path $frontend 'node_modules/vite/bin/vite.js'
$address = 'http://127.0.0.1:5173/'
$pgPort = 15432

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$([IO.Path]::GetFileName($Program)) failed with exit code $LASTEXITCODE."
    }
}

function Get-Listener([int]$Port) {
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($connections.Count -eq 0) { return }
    if ($connections.Count -ne 1 -or $connections[0].LocalAddress -ne '127.0.0.1') {
        throw "Port $Port is occupied by a listener other than the expected loopback service."
    }
    Get-CimInstance Win32_Process -Filter "ProcessId=$($connections[0].OwningProcess)"
}

function Test-Http([string]$Url, [string]$Marker) {
    try {
        $response = Invoke-WebRequest -Uri $Url -NoProxy -ConnectionTimeoutSeconds 1 -OperationTimeoutSeconds 3
        return $response.StatusCode -eq 200 -and $response.Content.Contains($Marker)
    } catch {
        return $false
    }
}

function Wait-Http([string]$Url, [string]$Marker, $Process, [string]$Log) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-Http $Url $Marker) { return }
        if ($Process.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    throw "Service did not become ready at $Url. See $Log."
}

function Get-ManifestHash([string[]]$Paths) {
    ($Paths | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }) -join ':'
}

function Get-SavedHash([string]$Path) {
    if (Test-Path -LiteralPath $Path) { (Get-Content -LiteralPath $Path -Raw).Trim() }
}

New-Item -ItemType Directory -Path $runtime, $logs -Force | Out-Null
try {
    $startupLock = [IO.File]::Open((Join-Path $runtime 'startup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch [IO.IOException] {
    throw 'Another EconoMind startup is in progress. Wait for it to finish and try again.'
}
try {
    $apiListener = Get-Listener 8000
    if ($apiListener -and (
        -not $apiListener.CommandLine.Contains($python, [StringComparison]::OrdinalIgnoreCase) -or
        $apiListener.CommandLine -notmatch '-m uvicorn backend\.main:app' -or
        -not (Test-Http 'http://127.0.0.1:8000/openapi.json' 'EconoMind API')
    )) { throw 'Port 8000 is occupied by another service. Free the port and run this script again.' }

    $webListener = Get-Listener 5173
    if ($webListener -and (
        $webListener.Name -ne 'node.exe' -or
        $webListener.CommandLine -notmatch 'node_modules[\\/]vite[\\/]bin[\\/]vite\.js' -or
        -not (Test-Http $address '<title>EconoMind') -or
        ($apiListener -and -not (Test-Http ($address + 'api/v1/indicators/gdp') '"code":"gdp"'))
    )) { throw 'Port 5173 is occupied by another service. Free the port and run this script again.' }

    if (-not $PostgresBin) {
        $PostgresBin = Join-Path $runtime 'postgresql-17/bin'
        if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin 'postgres.exe'))) {
            $postgres = Get-Command postgres.exe -CommandType Application -TotalCount 1 -ErrorAction SilentlyContinue
            $PostgresBin = if ($postgres) { Split-Path -Parent $postgres.Source }
            else { Join-Path $env:ProgramFiles 'PostgreSQL/17/bin' }
        }
    }
    $pgctl = Join-Path $PostgresBin 'pg_ctl.exe'
    $pginit = Join-Path $PostgresBin 'initdb.exe'
    $psql = Join-Path $PostgresBin 'psql.exe'
    $createdb = Join-Path $PostgresBin 'createdb.exe'
    foreach ($program in $pgctl, $pginit, $psql, $createdb) {
        if (-not (Test-Path -LiteralPath $program -PathType Leaf)) {
            throw "PostgreSQL tools were not found in $PostgresBin. Install PostgreSQL 17 or pass -PostgresBin."
        }
    }
    $node = (Get-Command node.exe -CommandType Application -TotalCount 1).Source
    $npm = (Get-Command npm.cmd -CommandType Application -TotalCount 1).Source
    $createdVenv = -not (Test-Path -LiteralPath $python)
    if ($createdVenv) {
        $hostPython = (Get-Command python.exe -CommandType Application -TotalCount 1).Source
        Invoke-Checked $hostPython @('-m', 'venv', (Join-Path $project '.venv'))
    }

    Write-Host '[1/4] Preparing PostgreSQL'
    $pgListener = Get-Listener $pgPort
    if ($pgListener -and (
        $pgListener.Name -ne 'postgres.exe' -or
        -not $pgListener.CommandLine.Replace('/', '\').Contains($cluster, [StringComparison]::OrdinalIgnoreCase)
    )) { throw "Port $pgPort is occupied by a different service." }

    $secretPath = Join-Path $runtime 'postgres-password.dpapi'
    $hasCluster = Test-Path -LiteralPath (Join-Path $cluster 'PG_VERSION')
    if ($hasCluster -and -not (Test-Path -LiteralPath $secretPath)) {
        throw "The password file for the existing PostgreSQL cluster is missing: $secretPath."
    }
    if (Test-Path -LiteralPath $secretPath) {
        $secret = (Get-Content -Raw -LiteralPath $secretPath).Trim() | ConvertTo-SecureString
    } else {
        $secret = ConvertTo-SecureString ([Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))) -AsPlainText -Force
        $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $secretPath -Encoding ascii -NoNewline
    }
    try {
        $password = [Net.NetworkCredential]::new('', $secret).Password
        if (-not $hasCluster) {
            $pwfile = New-TemporaryFile
            try {
                Set-Content -LiteralPath $pwfile.FullName -Value $password -Encoding ascii
                Invoke-Checked $pginit @('-D', $cluster, '-U', 'economind', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', "--pwfile=$($pwfile.FullName)")
            } finally { Remove-Item -LiteralPath $pwfile.FullName }
        }
        if (-not $pgListener) {
            Invoke-Checked $pgctl @('-D', $cluster, '-l', (Join-Path $logs 'postgres.log'), '-o', "-h 127.0.0.1 -p $pgPort", '-w', 'start')
        } else {
            Write-Host "Reusing PostgreSQL (PID $($pgListener.ProcessId))."
        }

        Write-Host '[2/4] Checking Python dependencies and schema'
        $requirements = Join-Path $project 'backend/requirements-dev.txt'
        $pythonHash = Get-ManifestHash @($requirements, (Join-Path $project 'backend/requirements.txt'))
        $pythonMarker = Join-Path $runtime 'python-requirements.sha256'
        if ($createdVenv -or (Get-SavedHash $pythonMarker) -ne $pythonHash) {
            Invoke-Checked $python @('-m', 'pip', 'install', '--quiet', '-r', $requirements)
            Set-Content -LiteralPath $pythonMarker -Value $pythonHash -Encoding ascii
        }
        Invoke-Checked $python @('-m', 'pip', 'check')

        $previousPassword = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
        $previousDatabase = [Environment]::GetEnvironmentVariable('ECONOMIND_DATABASE_URL', 'Process')
        $env:PGPASSWORD = $password
        $env:ECONOMIND_DATABASE_URL = "postgresql+psycopg://economind@127.0.0.1:$pgPort/economind"
        try {
            $pgArgs = @('-w', '-h', '127.0.0.1', '-p', "$pgPort", '-U', 'economind')
            $actualCluster = Invoke-Checked $psql ($pgArgs + @('-d', 'postgres', '-tAc', 'SHOW data_directory'))
            if ([IO.Path]::GetFullPath($actualCluster) -ine [IO.Path]::GetFullPath($cluster)) {
                throw 'The PostgreSQL data directory does not match the EconoMind cluster.'
            }
            $database = Invoke-Checked $psql ($pgArgs + @('-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'economind'"))
            if ($database -ne '1') { Invoke-Checked $createdb ($pgArgs + 'economind') }
            Push-Location -LiteralPath $project
            try { Invoke-Checked $python @('-m', 'backend.data_cli', 'init') }
            finally { Pop-Location }

            Write-Host '[3/4] Starting FastAPI'
            if ($apiListener) {
                Write-Host "Reusing FastAPI (PID $($apiListener.ProcessId))."
            } else {
                $apiLog = Join-Path $logs 'backend.err.log'
                $api = Start-Process -FilePath $python -WorkingDirectory $project -ArgumentList @(
                    '-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000'
                ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'backend.out.log') -RedirectStandardError $apiLog -PassThru
                Wait-Http 'http://127.0.0.1:8000/openapi.json' 'EconoMind API' $api $apiLog
            }
        } finally {
            [Environment]::SetEnvironmentVariable('PGPASSWORD', $previousPassword, 'Process')
            [Environment]::SetEnvironmentVariable('ECONOMIND_DATABASE_URL', $previousDatabase, 'Process')
        }
    } finally {
        Remove-Variable password -ErrorAction SilentlyContinue
        $secret.Dispose()
    }

    Write-Host '[4/4] Starting the frontend'
    $frontendHash = Get-ManifestHash @((Join-Path $frontend 'package.json'), (Join-Path $frontend 'package-lock.json'))
    $frontendMarker = Join-Path $runtime 'frontend-requirements.sha256'
    $savedFrontendHash = Get-SavedHash $frontendMarker
    if (-not (Test-Path -LiteralPath $vite) -or $savedFrontendHash -ne $frontendHash) {
        if ($webListener) {
            & $npm --prefix $frontend ls --depth=0 | Out-Null
            if ($LASTEXITCODE -ne 0 -or $savedFrontendHash) {
                throw 'Frontend dependencies changed. Stop the running Vite process, then run this script again.'
            }
        } else {
            Invoke-Checked $npm @('--prefix', $frontend, 'ci', '--no-audit', '--no-fund')
        }
        Set-Content -LiteralPath $frontendMarker -Value $frontendHash -Encoding ascii
    }
    if ($webListener) {
        Write-Host "Reusing Vite (PID $($webListener.ProcessId))."
    } else {
        $webLog = Join-Path $logs 'frontend.err.log'
        $web = Start-Process -FilePath $node -WorkingDirectory $frontend -ArgumentList @(
            ('"{0}"' -f $vite), '--host','127.0.0.1','--port','5173','--strictPort'
        ) -WindowStyle Hidden -Environment @{ ECONOMIND_API_TARGET = 'http://127.0.0.1:8000' } -RedirectStandardOutput (Join-Path $logs 'frontend.out.log') -RedirectStandardError $webLog -PassThru
        Wait-Http $address '<title>EconoMind' $web $webLog
        Wait-Http ($address + 'api/v1/indicators/gdp') '"code":"gdp"' $web $webLog
    }
    if (-not (Test-Http ($address + 'api/v1/indicators/gdp') '"code":"gdp"')) {
        throw 'The frontend is running but could not reach the EconoMind API.'
    }
    if (-not $NoBrowser) {
        Start-Process $address
        Write-Host "Opened $address"
    } else {
        Write-Host "Ready at $address"
    }
} finally {
    $startupLock.Dispose()
}
