param([ValidateSet('Check', 'Close')][string]$Mode = 'Check', [string]$InstallDirectory = $PSScriptRoot, [string]$HelperDirectory = '', [switch]$Force)
$ErrorActionPreference = 'Stop'
try {
    $node = Join-Path $InstallDirectory 'runtime\node.exe'
    $helper = if ($HelperDirectory) { Join-Path $HelperDirectory 'app-processes.mjs' } else { Join-Path $InstallDirectory 'app\app-processes.mjs' }
    if (-not (Test-Path -LiteralPath $node)) {
        if ($HelperDirectory) { $node = Join-Path $HelperDirectory 'gwb-helper-node.exe' }
        else { exit 4 }
    }
    $arguments = @($helper)
    if ($Mode -eq 'Check') { $arguments += '--check' }
    if ($Force) { $arguments += '--force' }
    & $node @arguments
    exit $LASTEXITCODE
} catch { exit 4 }
