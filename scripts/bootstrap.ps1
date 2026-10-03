$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$stage = Join-Path ([IO.Path]::GetTempPath()) ('gwb-update-' + [Guid]::NewGuid().ToString('N'))
$repo = 'spartaruga/GoogleSheetsBackup'
$dataDirectory = Join-Path $env:APPDATA 'GoogleWorkspaceBackup'
$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromMinutes(5)
$client.DefaultRequestHeaders.Add('User-Agent', 'GoogleWorkspaceBackup')
function Get-Bytes([string]$Url) { return ,$client.GetByteArrayAsync($Url).GetAwaiter().GetResult() }
function Hash-Bytes([byte[]]$Bytes) { return ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
function Save-Download([string]$Url, [string]$File, [string]$Hash) {
    [byte[]]$bytes = Get-Bytes $Url
    if ((Hash-Bytes $bytes) -ne $Hash) { throw 'Checksum del download non valido.' }
    [IO.File]::WriteAllBytes($File, $bytes)
}
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Occorre Windows x64.' }
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $channel = [Text.Encoding]::UTF8.GetString((Get-Bytes "https://raw.githubusercontent.com/$repo/main/packages/stable.json")) | ConvertFrom-Json
    if ($channel.format -ne 'gwb-update-channel-v1' -or $channel.packageBlob -notmatch '^[a-f0-9]{40}$' -or $channel.sha256 -notmatch '^[a-f0-9]{64}$' -or $channel.version -notmatch '^\d+\.\d+\.\d+$' -or $channel.size -lt 22 -or $channel.size -gt 20971520) { throw 'Canale aggiornamenti non valido.' }
    $blob = [Text.Encoding]::UTF8.GetString((Get-Bytes "https://api.github.com/repos/$repo/git/blobs/$($channel.packageBlob)")) | ConvertFrom-Json
    if ($blob.encoding -ne 'base64' -or $blob.content.Length -gt 41943040) { throw 'Pacchetto GitHub non valido.' }
    [byte[]]$envelopeBytes = [Convert]::FromBase64String($blob.content)
    [byte[]]$prefix = [Text.Encoding]::UTF8.GetBytes(('blob ' + $envelopeBytes.Length + [char]0))
    [byte[]]$gitBytes = $prefix + $envelopeBytes
    $gitHash = ([BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash($gitBytes))).Replace('-', '').ToLowerInvariant()
    if ($gitHash -ne $channel.packageBlob) { throw 'Identita pacchetto GitHub non valida.' }
    $envelope = [Text.Encoding]::UTF8.GetString($envelopeBytes) | ConvertFrom-Json
    if ($envelope.format -ne 'gwb-update-envelope-v1' -or $envelope.version -ne $channel.version -or $envelope.sha256 -ne $channel.sha256 -or $envelope.size -ne $channel.size) { throw 'Pacchetto incoerente.' }
    [byte[]]$zipBytes = [Convert]::FromBase64String($envelope.payload)
    if ($zipBytes.Length -ne $channel.size -or (Hash-Bytes $zipBytes) -ne $channel.sha256) { throw 'Checksum ZIP non valido.' }
    [IO.File]::WriteAllBytes((Join-Path $stage 'package.zip'), $zipBytes)
    [IO.File]::WriteAllText((Join-Path $stage 'expected.sha256'), $channel.sha256)
    $archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $stage 'package.zip'))
    try {
        $seen = @{}; $total = 0
        if ($archive.Entries.Count -gt 200) { throw 'Troppi file nel ZIP.' }
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName
            $core = '^app/(package\.json|package-lock\.json|engine\.mjs|server\.mjs|oauth\.mjs|browser\.mjs|instance\.mjs|diagnostics\.mjs|triggers\.mjs|updates\.mjs|app-updates\.mjs|app-processes\.mjs|update-worker\.mjs)$'
            if ($name -cnotmatch $core -and $name -cnotmatch '^app/public/[A-Za-z0-9_./-]+\.(js|html|css|svg)$' -and $name -cnotmatch '^(launcher\.ps1|CloseApp\.ps1|UpdateApp\.ps1|update\.json)$') { throw 'File ZIP non consentito.' }
            if ($name -match '(^|/)\.\.?(/|$)|[\\<>:"|?*\x00-\x1f]|[. ](/|$)|(^|/)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|/|$)' -or $seen.ContainsKey($name) -or $entry.Length -gt 20971520) { throw 'Percorso ZIP non valido.' }
            $seen[$name] = $true; $total += $entry.Length
            if ($total -gt 20971520) { throw 'ZIP troppo grande.' }
            $destination = Join-Path $stage $name
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
            $inputStream = $entry.Open(); $outputStream = [IO.File]::Open($destination, 'CreateNew')
            try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
        }
    } finally { $archive.Dispose() }
    $root = Join-Path $env:LOCALAPPDATA 'Programs\GoogleWorkspaceBackup'
    $registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8AC2382C-B51E-4B4C-AB44-0AF2E3FD2A06}_is1'
    $existing = Get-ItemProperty -LiteralPath $registry -ErrorAction SilentlyContinue
    if ($existing.InstallLocation) { $root = [string]$existing.InstallLocation }
    $node = Join-Path $root 'runtime\node.exe'
    if (-not (Test-Path -LiteralPath $node)) {
        # Used only for first installation or migration from a source copy.
        $nodeArchive = Join-Path $stage 'node.zip'
        Save-Download 'https://nodejs.org/dist/v24.20.0/node-v24.20.0-win-x64.zip' $nodeArchive '6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'
        $runtimeZip = [IO.Compression.ZipFile]::OpenRead($nodeArchive)
        try {
            $node = Join-Path $stage 'node.exe'
            [IO.Compression.ZipFileExtensions]::ExtractToFile($runtimeZip.GetEntry('node-v24.20.0-win-x64/node.exe'), $node)
        } finally { $runtimeZip.Dispose() }
    }
    & $node (Join-Path $stage 'app\update-worker.mjs') --close $root $stage $dataDirectory *> (Join-Path $stage 'close.log')
    $code = $LASTEXITCODE
    if ($code -eq 3) {
        $answer = [Windows.Forms.MessageBox]::Show('Alcune vecchie istanze verificate non rispondono. Chiuderle forzatamente? Eventuali operazioni non salvate potrebbero andare perse.', 'Chiudi vecchie istanze', 'YesNo', 'Warning')
        if ($answer -ne 'Yes') { throw 'Aggiornamento annullato.' }
        & $node (Join-Path $stage 'app\update-worker.mjs') --close $root $stage $dataDirectory --force *> (Join-Path $stage 'close.log')
        $code = $LASTEXITCODE
    }
    if ($code -eq 2) { throw 'Operazione in corso: attendi oppure annulla il backup prima di aggiornare.' }
    if ($code -ne 0) {
        $details = Get-Content -LiteralPath (Join-Path $stage 'close.log') -Raw
        try { $report = $details | ConvertFrom-Json; if ($report.error) { $details = [string]$report.error } } catch {}
        throw ('Chiusura incompleta. ' + $details)
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root '.gwb-update')) -and (-not (Test-Path -LiteralPath (Join-Path $root 'GoogleWorkspaceBackup.exe')) -or -not (Test-Path -LiteralPath (Join-Path $root 'runtime\node.exe')) -or -not (Test-Path -LiteralPath (Join-Path $root 'app\node_modules')))) {
        $setup = Join-Path $stage 'Setup-base.exe'
        Save-Download "https://github.com/$repo/releases/download/v3.4.5/GoogleWorkspaceBackup-Setup-3.4.5.exe" $setup 'fd2dd574655c283c03610b1a6e46aa0556ed9d99c7ef8ffa79f12a126f998b37'
        $installed = Start-Process -FilePath $setup -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/DIR="' + $root + '"')) -Wait -PassThru
        if ($installed.ExitCode -ne 0) { throw ('Installazione iniziale fallita: ' + $installed.ExitCode) }
    }
    & (Join-Path $stage 'UpdateApp.ps1') -InstallDirectory $root -StageDirectory $stage -DataDirectory $dataDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Aggiornamento non completato; dettagli nella cartella temporanea.' }
} catch {
    [Windows.Forms.MessageBox]::Show(($_.Exception.Message + "`r`nDettagli: " + $stage), 'Google Workspace Backup', 'OK', 'Error') | Out-Null
    exit 1
} finally { $client.Dispose() }
