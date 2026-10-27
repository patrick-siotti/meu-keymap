[CmdletBinding()]
param([switch]$Once, [int]$KeymapOwnerPid = 0)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path (Join-Path $PSScriptRoot 'DeviceInput.cs') -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions')
if ($Once) { [Console]::WriteLine([MeuKeymap.DeviceInput]::Snapshot()) }
else {
    if (-not $KeymapOwnerPid) { throw 'Processo pai obrigatorio para o monitor.' }
    [MeuKeymap.DeviceInput]::Listen($KeymapOwnerPid)
}
