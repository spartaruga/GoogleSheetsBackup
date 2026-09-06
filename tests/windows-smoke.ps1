$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Questo test installa/disinstalla il programma: eseguirlo solo nel runner Windows usa e getta di GitHub Actions.' }
$version = [string](Get-Content package.json -Raw | ConvertFrom-Json).version
$setup = Join-Path $PWD "release\GoogleWorkspaceBackup-Setup-$version.exe"
$install = Join-Path $env:RUNNER_TEMP 'GWB install with spaces'
$GwbProfileDirectory = Join-Path $env:APPDATA 'GoogleWorkspaceBackup'
if (Test-Path -LiteralPath $GwbProfileDirectory) { throw 'Il runner contiene gia un profilo GWB. Test interrotto per conservarlo.' }
$headers = @{ 'X-App-Request' = 'GoogleWorkspaceBackup' }
function Install-App {
    $process = Start-Process -FilePath $setup -ArgumentList ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="' + $install + '"') -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer fallito: $($process.ExitCode)" }
}
function Start-App {
    $savedPath = $env:PATH
    try {
        # No global Node/npm in the child environment.
        $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
        $env:GWB_NO_BROWSER = '1'
        $process = Start-Process -FilePath (Join-Path $install 'GoogleWorkspaceBackup.exe') -PassThru
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Milliseconds 500
            $record = Join-Path $GwbProfileDirectory 'instance.json'
            if (Test-Path -LiteralPath $record) {
                $info = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
                $url = "http://127.0.0.1:$($info.port)"
                try {
                    $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
                    if ($health.instanceId -eq $info.instanceId) { return @{ Process=$process; Url=$url; Record=$info } }
                } catch {}
            }
            if ($process.HasExited) { throw 'Launcher terminato prima di avviare il server.' }
        }
        throw 'Avvio non riuscito nel test senza Node globale.'
    } finally { $env:PATH = $savedPath }
}
function Stop-App($app) {
    Invoke-RestMethod "$($app.Url)/api/shutdown" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        $app.Process.Refresh()
        if ($app.Process.HasExited) { return }
        Start-Sleep -Milliseconds 500
    }
    $app.Process.Refresh()
    $errorLog = Join-Path $GwbProfileDirectory 'server-error.log'
    $serverLog = Join-Path $GwbProfileDirectory 'server.log'
    $children = @()
    try {
        $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $app.Process.Id } | ForEach-Object { "$($_.ProcessId): $($_.Name) $($_.CommandLine)" })
    } catch {}
    $details = @(
        "PID launcher: $($app.Process.Id)"
        "Launcher terminato: $($app.Process.HasExited)"
        "Processi figli: $($children -join ' | ')"
    )
    foreach ($log in @($errorLog, $serverLog)) {
        if (Test-Path -LiteralPath $log) {
            $details += "$(Split-Path $log -Leaf): $((Get-Content -LiteralPath $log -Tail 12) -join ' | ')"
        }
    }
    throw ("Il launcher non si e chiuso entro 15 secondi. " + ($details -join ' || '))
}
Install-App
$app = Start-App
$state = Invoke-RestMethod "$($app.Url)/api/state"
if ($state.credentialsConfigured -or $state.tokenConfigured -or $state.projects.Count) { throw 'Il primo avvio non e pulito.' }
$duplicate = Start-Process (Join-Path $install 'GoogleWorkspaceBackup.exe') -PassThru
if (-not $duplicate.WaitForExit(15000) -or $duplicate.ExitCode -ne 0) { throw 'Secondo avvio non riutilizzato.' }
$after = Get-Content (Join-Path $GwbProfileDirectory 'instance.json') -Raw | ConvertFrom-Json
if ($after.pid -ne $app.Record.pid) { throw 'Sono partite due istanze.' }
Stop-App $app
# Synthetic schema-v3 profile compatible with the original source version.
$backup = Join-Path $env:RUNNER_TEMP 'GWB user backups'
New-Item -ItemType Directory -Path $backup -Force | Out-Null
'keep-backup' | Set-Content (Join-Path $backup 'keep.txt')
@{version=3; outputDir=$backup; projects=@(); history=@(); options=@{xlsx=$true; zip=$true}; sentinel='keep'} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $GwbProfileDirectory 'state.json') -Encoding UTF8
# Node JSON readers require UTF-8 without BOM; PowerShell 5 writes BOM by default.
$stateFile = Join-Path $GwbProfileDirectory 'state.json'
[IO.File]::WriteAllText($stateFile, (Get-Content $stateFile -Raw), (New-Object Text.UTF8Encoding($false)))
$credentialFile = Join-Path $GwbProfileDirectory 'credentials.json'
[IO.File]::WriteAllText($credentialFile, (@{installed=@{client_id='demo'; client_secret='demo'}} | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Add-Type -AssemblyName System.Security
$protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('{"type":"authorized_user"}'), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$tokenFile = Join-Path $GwbProfileDirectory 'token.json'
[IO.File]::WriteAllText($tokenFile, (@{format='gwb-dpapi-v1'; data=[Convert]::ToBase64String($protected)} | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
$paths = @($stateFile, $credentialFile, $tokenFile, (Join-Path $backup 'keep.txt'))
$before = @($paths | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash })
Install-App
$app = Start-App
$state = Invoke-RestMethod "$($app.Url)/api/state"
if ($state.outputDir -ne $backup -or $state.tokenProtection -ne 'dpapi') { throw 'Profilo precedente non conservato.' }
Stop-App $app
$uninstaller = Start-Process -FilePath (Join-Path $install 'unins000.exe') -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -PassThru
if ($uninstaller.ExitCode -ne 0) { throw 'Disinstallazione fallita.' }
if (Test-Path (Join-Path $install 'GoogleWorkspaceBackup.exe')) { throw 'Il programma non e stato rimosso.' }
$after = @($paths | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash })
if (($before -join ',') -ne ($after -join ',')) { throw 'Dati utente modificati da installazione/disinstallazione.' }
Write-Host 'WINDOWS SMOKE OK: avvio senza Node globale, seconda istanza, reinstallazione e disinstallazione con dati conservati.'
