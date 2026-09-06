param([switch]$Visible)
$ErrorActionPreference = 'Stop'
$BaseDirectory = $PSScriptRoot
$DataDirectory = Join-Path $env:APPDATA 'GoogleWorkspaceBackup'
$StartupLog = Join-Path $DataDirectory 'startup-error.log'
$ServerLog = Join-Path $DataDirectory 'server.log'
$mutex = $null
$ownsMutex = $false

function Get-RunningApp {
    $recordPath = Join-Path $DataDirectory 'instance.json'
    if (Test-Path -LiteralPath $recordPath) {
        try {
            $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
            $port = [int]$record.port
            if ($port -lt 1 -or $port -gt 65535) { return $null }
            $info = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
            if ($info.app -eq 'GoogleWorkspaceBackup' -and $info.instanceId -eq $record.instanceId) {
                return [PSCustomObject]@{ Port = $port; Version = [string]$info.version }
            }
        } catch {}
    }
    return $null
}

try {
    New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
    # Installed layout: launcher beside app/ and runtime/. Source layout: flat.
    $AppDirectory = if (Test-Path -LiteralPath (Join-Path $BaseDirectory 'app\package.json')) { Join-Path $BaseDirectory 'app' } else { $BaseDirectory }
    $LocalVersion = [string](Get-Content -LiteralPath (Join-Path $AppDirectory 'package.json') -Raw | ConvertFrom-Json).version
    $mutex = New-Object System.Threading.Mutex($false, 'Local\GoogleWorkspaceBackup')
    try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) {
        for ($i = 0; $i -lt 30; $i++) {
            $running = Get-RunningApp
            if ($running) {
                if ($running.Version -ne $LocalVersion) { throw 'Chiudi la versione precedente con Chiudi programma e riprova. Nessun processo e stato terminato.' }
                Start-Process "http://127.0.0.1:$($running.Port)"
                exit 0
            }
            Start-Sleep -Milliseconds 500
        }
        throw 'Il programma e gia avviato ma non risponde. Consulta README.md, sezione diagnostica.'
    }
    $NodePath = Join-Path $BaseDirectory 'runtime\node.exe'
    if (-not (Test-Path -LiteralPath $NodePath)) {
        if ($AppDirectory -ne $BaseDirectory) { throw 'Runtime incluso mancante. Reinstalla il programma.' }
        # Only the source package may use a developer-installed Node.
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw 'Questa e la versione sorgente. Usa Setup.exe oppure prepara il progetto seguendo README.md.' }
        $NodePath = $nodeCommand.Source
    }
    $versionText = (& $NodePath --version).Trim()
    if ($versionText -notmatch '^v24\.') { throw 'Serve il runtime Node.js 24 LTS. Ricrea la build o reinstalla il programma.' }
    if (-not (Test-Path -LiteralPath (Join-Path $AppDirectory 'node_modules\googleapis\package.json'))) {
        throw 'Componenti mancanti. Reinstalla il programma; dal sorgente esegui npm ci.'
    }
    if (Test-Path -LiteralPath $ServerLog) {
        Move-Item -LiteralPath $ServerLog -Destination "$ServerLog.previous" -Force
    }
    $errorLog = Join-Path $DataDirectory 'server-error.log'
    $arguments = '"' + (Join-Path $AppDirectory 'server.mjs') + '"'
    $child = Start-Process -FilePath $NodePath -ArgumentList $arguments -WorkingDirectory $AppDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $ServerLog -RedirectStandardError $errorLog
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($child.HasExited) { break }
        if (Get-RunningApp) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready -and -not $child.HasExited) {
        throw 'Avvio non completato entro 30 secondi. Non avviare altre copie: consulta server-error.log e riprova quando il processo e chiuso.'
    }
    $child.WaitForExit()
    if ($child.ExitCode -ne 0) {
        $detail = if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Tail 8 | Out-String } else { '' }
        throw "Avvio non riuscito (codice $($child.ExitCode)). $detail"
    }
} catch {
    $message = $_.Exception.Message
    $message | Set-Content -LiteralPath $StartupLog -Encoding UTF8
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("$message`r`n`r`nDettagli: $StartupLog", 'Google Workspace Backup') | Out-Null
    if ($Visible) { Write-Host $message -ForegroundColor Red }
    exit 1
} finally {
    if ($ownsMutex -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
exit 0
