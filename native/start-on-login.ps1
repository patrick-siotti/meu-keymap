[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$keymapRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $keymapRoot 'iniciar.ps1') -SemAbrir
# No runtime/start here: login does not silently execute profile scripts.
