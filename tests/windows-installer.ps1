function Invoke-CloseCheck([string]$Mode, [int]$Expected) {
    $scriptPath = Join-Path $PWD 'installer\CloseApp.ps1'
    & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -Mode $Mode -InstallDirectory (Join-Path $PWD 'dist')
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
    # Enumerate Win32 controls directly: UI Automation's desktop root can be
    # empty in the hosted runner's session even while the wizard is running.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class GwbInstallerWindows {
    public class Window { public IntPtr Handle; public int Pid; public string Text, Class; public bool Enabled, Visible; }
    private delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hwnd, EnumProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
    private static void Add(List<Window> list, IntPtr hwnd) {
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        var text = new StringBuilder(512); GetWindowText(hwnd, text, text.Capacity);
        var cls = new StringBuilder(128); GetClassName(hwnd, cls, cls.Capacity);
        list.Add(new Window { Handle=hwnd, Pid=(int)pid, Text=text.ToString(), Class=cls.ToString(), Enabled=IsWindowEnabled(hwnd), Visible=IsWindowVisible(hwnd) });
    }
    public static Window[] All() {
        var list = new List<Window>();
        EnumWindows((hwnd, data) => { Add(list, hwnd); EnumChildWindows(hwnd, (child, unused) => { Add(list, child); return true; }, IntPtr.Zero); return true; }, IntPtr.Zero);
        return list.ToArray();
    }
    public static bool Click(IntPtr hwnd) {
        // WM_COMMAND / BN_CLICKED: the same notification sent by a button.
        return PostMessage(GetParent(hwnd), 0x0111, new IntPtr(GetDlgCtrlID(hwnd) & 0xffff), hwnd);
    }
}
'@
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
        $windows = @([GwbInstallerWindows]::All() | Where-Object { $_.Pid -in $ids })
        $lastNames = @($windows | Where-Object { $_.Visible -and $_.Text } | ForEach-Object { "$($_.Class): $($_.Text)" })
        foreach ($button in $windows) {
            if (-not $button.Enabled -or -not $button.Visible -or $button.Class -notlike '*Button*') { continue }
            $name = $button.Text.Replace('&', '')
            $isClose = $name -like 'Chiudi*app e continua*'
            if (-not $isClose -and $name -notmatch '^(Avanti|Installa|Fine)\b') { continue }
            if (-not [GwbInstallerWindows]::Click($button.Handle)) { throw "Impossibile premere il pulsante $name." }
            Write-Host "INSTALLER CLICK: $name"
            if ($isClose) { $sawCloseButton = $true }
            break
        }
        Start-Sleep -Milliseconds 300
    }
    throw "L installer non ha concluso il percorso del pulsante. Ultimi pulsanti: $($lastNames -join ', ')."
}
