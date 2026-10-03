param([Parameter(Mandatory=$true)][string]$InstallDirectory, [Parameter(Mandatory=$true)][string]$StageDirectory, [string]$DataDirectory = (Join-Path $env:APPDATA 'GoogleWorkspaceBackup'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$updateMutex = $null; $appMutex = $null; $ownsUpdate = $false; $ownsApp = $false
$failed = $false; $applyStarted = $false
$node = Join-Path $InstallDirectory 'runtime\node.exe'
$worker = Join-Path $StageDirectory 'app\update-worker.mjs'
$log = Join-Path $StageDirectory 'update.log'
try {
    if ($env:GWB_UPDATE_DELAY -eq '1') { Start-Sleep -Seconds 2 }
    $updateMutex = [Threading.Mutex]::new($false, 'Local\GoogleWorkspaceBackupUpdate')
    try { $ownsUpdate = $updateMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsUpdate = $true }
    if (-not $ownsUpdate) { throw 'Un aggiornamento e gia in corso.' }
    & $node $worker --close $InstallDirectory $StageDirectory $DataDirectory *> $log
    $code = $LASTEXITCODE
    if ($code -eq 3) {
        $answer = [Windows.Forms.MessageBox]::Show('Alcune istanze verificate del programma non rispondono. Chiuderle forzatamente? Eventuali operazioni non salvate in queste istanze potrebbero andare perse. I processi di altri programmi non vengono chiusi.', 'Chiudi vecchie istanze', 'YesNo', 'Warning')
        if ($answer -ne 'Yes') { throw 'Aggiornamento annullato; nessuna istanza bloccata e stata forzata.' }
        & $node $worker --close $InstallDirectory $StageDirectory $DataDirectory --force *> $log
        $code = $LASTEXITCODE
    }
    if ($code -eq 2) { throw 'Operazione in corso: attendi oppure annulla il backup nell app, quindi riprova.' }
    if ($code -ne 0) { throw ('Chiusura incompleta. ' + (Get-Content -LiteralPath $log -Raw)) }
    $appMutex = [Threading.Mutex]::new($false, 'Local\GoogleWorkspaceBackup')
    try { $ownsApp = $appMutex.WaitOne(3000) } catch [Threading.AbandonedMutexException] { $ownsApp = $true }
    if (-not $ownsApp) { throw 'Un launcher e ancora attivo. Riprova.' }
    $applyStarted = $true
    & $node $worker --apply $InstallDirectory $StageDirectory $DataDirectory *> $log
    if ($LASTEXITCODE -ne 0) { throw (Get-Content -LiteralPath $log -Raw) }
} catch {
    [Windows.Forms.MessageBox]::Show(($_.Exception.Message + "`r`nDettagli: " + $log), 'Aggiornamento non completato', 'OK', 'Error') | Out-Null
    $failed = $true
} finally {
    if ($ownsApp) { $appMutex.ReleaseMutex() }; if ($appMutex) { $appMutex.Dispose() }
    if ($ownsUpdate) { $updateMutex.ReleaseMutex() }; if ($updateMutex) { $updateMutex.Dispose() }
}
if (-not $failed -or ($applyStarted -and -not (Test-Path -LiteralPath (Join-Path $InstallDirectory '.gwb-update')))) {
    Start-Process -FilePath (Join-Path $InstallDirectory 'GoogleWorkspaceBackup.exe') -WorkingDirectory $InstallDirectory
}
if ($failed) { exit 1 }; exit 0
