$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -Path @((Join-Path $PSScriptRoot 'ActionHost.cs'), (Join-Path $PSScriptRoot 'PlaybackMute.cs')) -ReferencedAssemblies @('System.Web.Extensions')
[MeuKeymap.ActionHost]::Run()
