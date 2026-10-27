[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path @((Join-Path $PSScriptRoot 'DeviceInput.cs'), (Join-Path $PSScriptRoot 'DeviceConfiguration.cs')) -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions')
$keymapLights = [MeuKeymap.DeviceConfiguration]::ReadLights()
$keymapSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
[Console]::WriteLine($keymapSerializer.Serialize($keymapLights))
