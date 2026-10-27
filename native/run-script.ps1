$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$keymapInvocation = [Console]::In.ReadToEnd() | ConvertFrom-Json
$keymapScriptPath = [string]$keymapInvocation.path
$keymapScriptArguments = @($keymapInvocation.arguments | ForEach-Object { [string]$_ })
$global:LASTEXITCODE = 0
& $keymapScriptPath @keymapScriptArguments
$keymapSucceeded = $?
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not $keymapSucceeded) { exit 1 }
