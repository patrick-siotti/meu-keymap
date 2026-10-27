[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path @((Join-Path $PSScriptRoot 'DeviceInput.cs'), (Join-Path $PSScriptRoot 'DeviceConfiguration.cs')) -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions')
$keymapRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
$keymapWritten = [MeuKeymap.DeviceConfiguration]::WriteBindings([string[]]$keymapRequest.packets, [string]$keymapRequest.expectedPath)
[Console]::WriteLine((@{written=$keymapWritten} | ConvertTo-Json -Compress))
