[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 4173,
    [switch]$SemAbrir
)

$ErrorActionPreference = 'Stop'
if (-not $SemAbrir) {
    $keymapLauncher = Join-Path $PSScriptRoot 'desktop/bin/MeuKeymap.exe'
    if (-not (Test-Path -LiteralPath $keymapLauncher)) { throw 'Prepare o atalho primeiro: ./desktop/install-desktop.ps1' }
    if ($Port -ne 4173) { throw 'A sessão desktop usa a porta 4173. Para uma porta técnica, use -SemAbrir -Port.' }
    Start-Process -FilePath $keymapLauncher -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    return
}
$keymapUrl = "http://127.0.0.1:$Port"
$keymapReady = $false
try {
    $keymapHealth = Invoke-RestMethod -Uri "$keymapUrl/api/health" -TimeoutSec 2
    $keymapReady = $keymapHealth.app -eq 'meu-keymap'
} catch { }

if (-not $keymapReady) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist/index.html'))) {
        throw 'Compile o aplicativo primeiro: npm run build'
    }
    $keymapNode = (Get-Command node -ErrorAction Stop).Source
    $keymapOutput = Join-Path $PSScriptRoot 'outputs'
    New-Item -ItemType Directory -Path $keymapOutput -Force | Out-Null
    $keymapProcess = Start-Process -FilePath $keymapNode -ArgumentList @('server.ts', '--production', '--port', "$Port") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $keymapOutput 'server.stdout.log') -RedirectStandardError (Join-Path $keymapOutput 'server.stderr.log') -PassThru
    for ($keymapAttempt = 0; $keymapAttempt -lt 20; $keymapAttempt++) {
        if ($keymapProcess.HasExited) { throw 'O servidor não iniciou. Confira outputs/server.stderr.log ou use outra porta com -Port.' }
        try {
            $keymapHealth = Invoke-RestMethod -Uri "$keymapUrl/api/health" -TimeoutSec 1
            if ($keymapHealth.app -eq 'meu-keymap') { $keymapReady = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if (-not $keymapReady) { throw 'O servidor não respondeu. Confira outputs/server.stderr.log.' }
    Write-Output "Servidor local iniciado. PID: $($keymapProcess.Id)"
}

Write-Output "meu keymap: $keymapUrl"
