param([ValidateSet('Check', 'Close')][string]$Mode = 'Check')
$ErrorActionPreference = 'Stop'
# Exit codes: 0 closed, 1 idle/running, 2 busy, 3 shutdown timeout, 4 unverified.
# Never terminate processes by name or trust a PID without the local handshake.
$profileDirectory = Join-Path $env:APPDATA 'GoogleWorkspaceBackup'
$client = $null
try {
    $lockPath = Join-Path $profileDirectory 'instance.lock'
    $recordPath = Join-Path $profileDirectory 'instance.json'
    if (-not (Test-Path -LiteralPath $lockPath)) {
        if (Test-Path -LiteralPath $recordPath) { exit 4 }
        exit 0
    }
    $owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    if ([int]$owner.pid -lt 1 -or -not $owner.id) { exit 4 }
    $process = Get-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue
    if (-not $process) { exit 0 }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $port = [int]$record.port
    if ($record.app -ne 'GoogleWorkspaceBackup' -or $record.pid -ne $owner.pid -or
        $record.instanceId -ne $owner.id -or $port -lt 1 -or $port -gt 65535) { exit 4 }

    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(3)
    $url = "http://127.0.0.1:$port"
    $response = $client.GetAsync("$url/api/health").GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { exit 4 }
    $health = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    if ($health.app -ne 'GoogleWorkspaceBackup' -or $health.instanceId -ne $owner.id) { exit 4 }
    if ($health.busy) { exit 2 }
    if ($Mode -eq 'Check') { exit 1 }

    $client.DefaultRequestHeaders.Add('X-App-Request', 'GoogleWorkspaceBackup')
    $body = [System.Net.Http.StringContent]::new('{}', [Text.Encoding]::UTF8, 'application/json')
    $response = $client.PostAsync("$url/api/shutdown", $body).GetAwaiter().GetResult()
    if ([int]$response.StatusCode -eq 409) { exit 2 }
    if (-not $response.IsSuccessStatusCode) { exit 4 }
    if (-not $process.WaitForExit(15000)) { exit 3 }
    exit 0
} catch {
    exit 4
} finally {
    if ($client) { $client.Dispose() }
}
