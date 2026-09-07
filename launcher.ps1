param([switch]$Visible)
$ErrorActionPreference = 'Stop'
$BaseDirectory = $PSScriptRoot
$DataDirectory = Join-Path $env:APPDATA 'GoogleWorkspaceBackup'
$StartupLog = Join-Path $DataDirectory 'startup-error.log'
$ServerLog = Join-Path $DataDirectory 'server.log'
$mutex = $null
$ownsMutex = $false
$script:LastHealthError = ''

function Get-RunningApp {
    $recordPath = Join-Path $DataDirectory 'instance.json'
    if (-not (Test-Path -LiteralPath $recordPath)) { return $null }

    $handler = $null
    $client = $null
    try {
        $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        $port = [int]$record.port
        if ($port -lt 1 -or $port -gt 65535) { return $null }

        # This request must never use the user's/company proxy. The app listens
        # only on loopback, and some Windows proxy configurations otherwise
        # make Invoke-RestMethod fail even while the local server is healthy.
        Add-Type -AssemblyName System.Net.Http
        $handler = [System.Net.Http.HttpClientHandler]::new()
        $handler.UseProxy = $false
        $client = [System.Net.Http.HttpClient]::new($handler)
        $client.Timeout = [TimeSpan]::FromSeconds(2)

        $response = $client.GetAsync("http://127.0.0.1:$port/api/health").GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            $script:LastHealthError = "HTTP $([int]$response.StatusCode) dal server locale."
            return $null
        }

        $json = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $info = $json | ConvertFrom-Json
        if ($info.app -eq 'GoogleWorkspaceBackup' -and $info.instanceId -eq $record.instanceId) {
            $script:LastHealthError = ''
            return [PSCustomObject]@{ Port = $port; Version = [string]$info.version }
        }

        $script:LastHealthError = 'Risposta /api/health non coerente con instance.json.'
    } catch {
        $script:LastHealthError = $_.Exception.Message
    } finally {
        if ($client) { $client.Dispose() }
        elseif ($handler) { $handler.Dispose() }
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
                if ($env:GWB_NO_BROWSER -ne '1') { Start-Process "http://127.0.0.1:$($running.Port)" }
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
    $serverScript = Join-Path $AppDirectory 'server.mjs'

    # Avoid Start-Process -RedirectStandardOutput/-RedirectStandardError here.
    # On Windows those redirections can leave the PowerShell launcher alive even
    # after Node has already shut down. Let cmd.exe own the file redirections so
    # the process chain closes deterministically: launcher -> cmd -> node.
    $command = '""{0}" "{1}" 1>"{2}" 2>"{3}""' -f $NodePath, $serverScript, $ServerLog, $errorLog
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Join-Path $env:SystemRoot 'System32\cmd.exe')
    $startInfo.Arguments = "/d /s /c $command"
    $startInfo.WorkingDirectory = $AppDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $child = New-Object System.Diagnostics.Process
    $child.StartInfo = $startInfo
    if (-not $child.Start()) { throw 'Impossibile avviare il runtime incluso.' }
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($child.HasExited) { break }
        if (Get-RunningApp) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready -and -not $child.HasExited) {
        $healthDetail = if ($script:LastHealthError) { " Dettaglio controllo locale: $script:LastHealthError" } else { '' }
        throw "Avvio non completato entro 30 secondi. Non avviare altre copie: consulta server-error.log e riprova quando il processo e chiuso.$healthDetail"
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
