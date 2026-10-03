function Invoke-CloseCheck([string]$Mode, [int]$Expected) {
    $scriptPath = Join-Path $PWD 'installer\CloseApp.ps1'
    & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -Mode $Mode
    if ($LASTEXITCODE -ne $Expected) { throw "Chiusura installer: $Mode ha restituito $LASTEXITCODE, atteso $Expected." }
}

function Assert-InstallerBusyProtection($App, [string]$Setup, [string]$Install) {
    Invoke-CloseCheck Check 1
    $socket = [Net.Sockets.TcpClient]::new('127.0.0.1', [int]$App.Record.port)
    try {
        # Hold a local write request open; no Google API or actual backup is used.
        $stream = $socket.GetStream()
        $request = "POST /api/state HTTP/1.1`r`nHost: 127.0.0.1:$($App.Record.port)`r`nX-App-Request: GoogleWorkspaceBackup`r`nContent-Type: application/json`r`nContent-Length: 10000`r`n`r`n{"
        $bytes = [Text.Encoding]::ASCII.GetBytes($request)
        $stream.Write($bytes, 0, $bytes.Length)
        $busy = $false
        for ($i = 0; $i -lt 50; $i++) {
            if ((Invoke-RestMethod "$($App.Url)/api/health").busy) { $busy = $true; break }
            Start-Sleep -Milliseconds 100
        }
        if (-not $busy) { throw 'La richiesta fittizia non ha impegnato il server.' }
        Invoke-CloseCheck Check 2
        Invoke-CloseCheck Close 2
        $appFile = Join-Path $Install 'GoogleWorkspaceBackup.exe'
        $before = (Get-FileHash $appFile -Algorithm SHA256).Hash
        $blocked = Start-Process $Setup -ArgumentList ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="' + $Install + '"') -Wait -PassThru
        if ($blocked.ExitCode -eq 0) { throw 'L installer ha aggiornato un programma occupato.' }
        if ((Get-FileHash $appFile -Algorithm SHA256).Hash -ne $before) { throw 'L installer bloccato ha modificato il programma.' }
        if (-not (Get-Process -Id $App.Record.pid -ErrorAction SilentlyContinue)) { throw 'La chiusura ha terminato un programma occupato.' }
    } finally { $socket.Dispose() }
    for ($i = 0; $i -lt 50; $i++) {
        if (-not (Invoke-RestMethod "$($App.Url)/api/health").busy) { break }
        Start-Sleep -Milliseconds 100
    }
    Invoke-CloseCheck Check 1
    Write-Host 'INSTALLER BUSY OK: chiusura e aggiornamento bloccati durante una scrittura locale.'
}

function Assert-UnverifiedProcessProtection([string]$Install, [string]$ProfileDirectory) {
    $lock = Join-Path $ProfileDirectory 'instance.lock'
    $record = Join-Path $ProfileDirectory 'instance.json'
    if ((Test-Path $lock) -or (Test-Path $record)) { throw 'Test PID: il profilo e ancora in uso.' }
    $foreign = Start-Process (Join-Path $Install 'runtime\node.exe') -ArgumentList '-e "setInterval(()=>{},1000)"' -PassThru -WindowStyle Hidden
    try {
        $id = [guid]::NewGuid().ToString()
        @{pid=$foreign.Id; id=$id} | ConvertTo-Json | Set-Content $lock
        @{app='GoogleWorkspaceBackup'; pid=$foreign.Id; instanceId=$id; port=1} | ConvertTo-Json | Set-Content $record
        Invoke-CloseCheck Close 4
        $foreign.Refresh()
        if ($foreign.HasExited) { throw 'La chiusura ha terminato un processo estraneo.' }
        '{broken' | Set-Content $lock
        Invoke-CloseCheck Close 4
        if ((Get-Content $lock -Raw).Trim() -ne '{broken') { throw 'La chiusura ha cancellato un blocco non leggibile.' }
        @{pid=2147483647; id=$id} | ConvertTo-Json | Set-Content $lock
        Invoke-CloseCheck Check 0
        if (-not (Test-Path $lock)) { throw 'Il controllo ha cancellato il blocco obsoleto.' }
    } finally {
        $foreign.Refresh()
        if (-not $foreign.HasExited) { $foreign.Kill(); $foreign.WaitForExit() }
        Remove-Item -LiteralPath $lock, $record -ErrorAction SilentlyContinue
    }
    Write-Host 'INSTALLER IDENTITY OK: PID estraneo, blocco corrotto e obsoleto gestiti senza terminare processi o cancellare dati.'
}

function Install-WithCloseButton([string]$Setup, [string]$Install) {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $process = Start-Process $Setup -ArgumentList ('/SP- /NORESTART /LANG=italian /DIR="' + $Install + '"') -PassThru
    $sawCloseButton = $false
    $lastNames = @()
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited) {
            if ($process.ExitCode -ne 0 -or -not $sawCloseButton) { throw "Test pulsante installer fallito: codice $($process.ExitCode), pulsante visto $sawCloseButton." }
            Write-Host 'INSTALLER BUTTON OK: premuto Chiudi app e continua nella finestra reale del Setup.'
            return
        }
        # Inno's bootstrap starts a child .tmp process which owns the wizard.
        $all = @(Get-CimInstance Win32_Process)
        $ids = @($process.Id)
        for ($i = 0; $i -lt 3; $i++) { $ids += @($all | Where-Object { $_.ParentProcessId -in $ids } | ForEach-Object { [int]$_.ProcessId }) }
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
            [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($window in $windows) {
            try {
                if ($window.Current.ProcessId -notin $ids) { continue }
                $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
                $lastNames = @($buttons | ForEach-Object { $_.Current.Name })
                foreach ($button in $buttons) {
                    $name = $button.Current.Name.Replace('&', '')
                    if (-not $button.Current.IsEnabled) { continue }
                    $isClose = $name -like 'Chiudi*app e continua*'
                    if (-not $isClose -and $name -notmatch '^(Avanti|Installa|Fine)\b') { continue }
                    if ($name -match '^Fine\b') {
                        $checks = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                            [System.Windows.Automation.Condition]::TrueCondition)
                        foreach ($check in $checks) {
                            if ($check.Current.Name -like '*Avvia Google Workspace Backup*') {
                                $pattern = $null
                                if ($check.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
                                    if ($pattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { $pattern.Toggle() }
                                } elseif ($check.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$pattern)) {
                                    if ($pattern.Current.State -band 16) { $pattern.DoDefaultAction() }
                                }
                            }
                        }
                    }
                    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
                    if ($isClose) { $sawCloseButton = $true }
                    break
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] {}
        }
        Start-Sleep -Milliseconds 300
    }
    throw "L installer non ha concluso il percorso del pulsante. Ultimi pulsanti: $($lastNames -join ', ')."
}
