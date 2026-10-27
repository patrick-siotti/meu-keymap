[CmdletBinding()]
param([ValidateSet('read','enable','disable')][string]$Mode = 'read')
$ErrorActionPreference = 'Stop'
$keymapRun = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$keymapName = 'MeuKeymap'
$keymapLauncher = Join-Path $PSScriptRoot 'start-on-login.ps1'
$keymapExpected = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File "' + $keymapLauncher + '"'
function Get-KeymapStartupValue {
    if (Test-Path -LiteralPath $keymapRun) { return (Get-Item -LiteralPath $keymapRun).GetValue($keymapName, $null) }
    return $null
}
$keymapCurrent = Get-KeymapStartupValue
if ($Mode -ne 'read' -and $keymapCurrent -and $keymapCurrent -ne $keymapExpected) {
    throw 'Existe uma entrada MeuKeymap de outro local. Nenhuma alteracao realizada.'
}
if ($Mode -eq 'enable') {
    New-Item -Path $keymapRun -Force | Out-Null
    New-ItemProperty -LiteralPath $keymapRun -Name $keymapName -Value $keymapExpected -PropertyType String -Force | Out-Null
}
if ($Mode -eq 'disable' -and $keymapCurrent) {
    Remove-ItemProperty -LiteralPath $keymapRun -Name $keymapName
}
$keymapActual = Get-KeymapStartupValue
[Console]::WriteLine((@{enabled=($keymapActual -eq $keymapExpected);conflict=([bool]$keymapActual -and $keymapActual -ne $keymapExpected)} | ConvertTo-Json -Compress))
