[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path @((Join-Path $PSScriptRoot 'DeviceInput.cs'), (Join-Path $PSScriptRoot 'DeviceConfiguration.cs')) -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions')
$keymapRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($keymapRequest.packets) {
    $keymapWritten = [MeuKeymap.DeviceConfiguration]::WriteLightsBatch([string[]]$keymapRequest.packets, [string]$keymapRequest.expectedPath)
} else {
    $keymapWritten = [MeuKeymap.DeviceConfiguration]::WriteLights([string]$keymapRequest.packet)
}
[Console]::WriteLine((@{written=$keymapWritten} | ConvertTo-Json -Compress))
