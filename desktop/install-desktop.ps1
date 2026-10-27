[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$keymapRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$keymapBin = Join-Path $PSScriptRoot 'bin'
$keymapState = Join-Path $keymapRoot '.desktop'
$keymapNode = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $keymapBin,$keymapState -Force | Out-Null
$keymapSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $keymapState '/inheritance:r' '/grant:r' "*${keymapSid}:(OI)(CI)F" '/grant:r' '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger a pasta desktop.' }
$keymapCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$keymapExe = Join-Path $keymapBin 'MeuKeymap.exe'
$keymapIcon = Join-Path $keymapRoot 'public/meu-keymap.ico'
& $keymapCompiler '/nologo' '/target:winexe' '/platform:x64' '/optimize+' '/reference:System.Windows.Forms.dll' '/reference:System.Web.Extensions.dll' "/win32icon:$keymapIcon" "/out:$keymapExe" (Join-Path $PSScriptRoot 'DesktopLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha na compilação do launcher.' }
$keymapConfig = @{root=$keymapRoot;node=$keymapNode;port=4173;stateDirectory=$keymapState;dataDirectory=(Join-Path $keymapRoot '.data')}
[IO.File]::WriteAllText((Join-Path $keymapBin 'launcher.json'),($keymapConfig | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$keymapDesktop = [Environment]::GetFolderPath('Desktop')
$keymapShortcutPath = Join-Path $keymapDesktop 'Meu Keymap.lnk'
$keymapShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $keymapShortcutPath) {
    $keymapExisting = $keymapShell.CreateShortcut($keymapShortcutPath)
    if ($keymapExisting.TargetPath -and $keymapExisting.TargetPath -ne $keymapExe) { throw 'O atalho Meu Keymap existente pertence a outro destino; preservado.' }
}
$keymapShortcut = $keymapShell.CreateShortcut($keymapShortcutPath)
$keymapShortcut.TargetPath = $keymapExe
$keymapShortcut.WorkingDirectory = $keymapRoot
$keymapShortcut.IconLocation = "$keymapIcon,0"
$keymapShortcut.Description = 'Meu Keymap — navegador normal; última aba fechada encerra em 15 segundos'
$keymapShortcut.Save()
Write-Output "Atalho pronto: $keymapShortcutPath"
