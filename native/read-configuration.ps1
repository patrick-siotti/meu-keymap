[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path @((Join-Path $PSScriptRoot 'DeviceInput.cs'), (Join-Path $PSScriptRoot 'DeviceConfiguration.cs')) -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions')
$keymapConfiguration = [MeuKeymap.DeviceConfiguration]::Read()
$keymapSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
[Console]::WriteLine($keymapSerializer.Serialize($keymapConfiguration))
