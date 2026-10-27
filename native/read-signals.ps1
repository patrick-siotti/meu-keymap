[CmdletBinding()]
param([switch]$Once, [int]$KeymapOwnerPid = 0)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path (Join-Path $PSScriptRoot 'AudioReadOnly.cs')
$keymapAudio = [MeuKeymap.AudioReadOnly]::new()
$keymapProcesses = @()
$keymapCounter = 0
$keymapOwnerStarted = if ($KeymapOwnerPid) { (Get-Process -Id $KeymapOwnerPid).StartTime } else { $null }
try {
    do {
        $keymapValues = @{}
        $keymapError = $null
        try {
            $keymapReading = $keymapAudio.Read()
            $keymapValues['windows.microphone.level'] = [Math]::Round($keymapReading[0], 2)
            $keymapValues['windows.microphone.volume'] = [Math]::Round($keymapReading[1], 2)
            $keymapValues['windows.microphone.muted'] = $keymapReading[2] -eq 1
        } catch { $keymapError = 'Microfone padrao indisponivel; valores de audio desconhecidos.' }
        if (($keymapCounter % 10) -eq 0) {
            if ($KeymapOwnerPid) {
                $keymapOwner = Get-Process -Id $KeymapOwnerPid -ErrorAction SilentlyContinue
                if (-not $keymapOwner -or $keymapOwner.StartTime -ne $keymapOwnerStarted) { break }
            }
            try { $keymapProcesses = @(Get-Process | Select-Object -ExpandProperty ProcessName -Unique) }
            catch { $keymapProcesses = $null }
        }
        $keymapMessage = @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); values = $keymapValues; processNames = $keymapProcesses }
        if ($keymapError) { $keymapMessage['error'] = $keymapError }
        [Console]::WriteLine(($keymapMessage | ConvertTo-Json -Depth 5 -Compress))
        $keymapCounter++
        if (-not $Once) { Start-Sleep -Milliseconds 100 }
    } while (-not $Once)
} finally { $keymapAudio.Dispose() }
