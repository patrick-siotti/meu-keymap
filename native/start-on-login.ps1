[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$keymapRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $keymapRoot 'iniciar.ps1') -EmSegundoPlano
