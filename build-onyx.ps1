# Builds Onyx.exe (Electron, Windows x64) into Downloads\onyx
# Downloads the official Electron runtime from GitHub, verifies it, and adds the Onyx app files.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ElectronVersion = '32.3.3'
$ZipName  = "electron-v$ElectronVersion-win32-x64.zip"
$BaseUrl  = "https://github.com/electron/electron/releases/download/v$ElectronVersion"
$Src      = $PSScriptRoot
$Dest     = Join-Path $env:USERPROFILE 'Downloads\onyx'
$Cache    = Join-Path $env:LOCALAPPDATA 'onyx-build'
if ($Src.TrimEnd('\') -ieq $Dest) { $Dest = Join-Path $env:USERPROFILE 'Downloads\Onyx App' }
$AppFiles = 'package.json','main.js','preload.js','engine.js','tags.js','library.js','renderer.js','graph.js','icons.js','theme.js','settings.js','workspace.js','index.html','styles.css','icon.ico','onyx-stone.ico','icon.png'

function Step($msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor Cyan }
function Download($url, $out) {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) { & curl.exe -L --fail --progress-bar -o $out $url; if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" } }
  else { Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing }
}

Write-Host 'Onyx builder' -ForegroundColor White
Write-Host "Output folder: $Dest"

# 0. Check the app files are next to this script
foreach ($f in $AppFiles) { if (-not (Test-Path (Join-Path $Src $f))) { throw "Missing $f next to this script. Keep all the files from the zip together." } }

# 1. Close Onyx if it's running from the output folder
Get-Process -Name 'Onyx' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Dest, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
  Step 'Closing the running Onyx'
  $_ | Stop-Process -Force
  Start-Sleep -Seconds 1
}

# 2. Download Electron (cached, so rebuilding is fast)
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$Zip  = Join-Path $Cache $ZipName
$Sums = Join-Path $Cache "SHASUMS256-$ElectronVersion.txt"
if (-not (Test-Path $Sums)) { Step 'Downloading checksums'; Download "$BaseUrl/SHASUMS256.txt" $Sums }
$expected = (Select-String -Path $Sums -Pattern ([regex]::Escape($ZipName) + '$') | Select-Object -First 1).Line.Split(' ')[0].ToLower()
if (-not $expected) { throw "Couldn't find $ZipName in the Electron checksum list." }

$ok = $false
if (Test-Path $Zip) { $ok = ((Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower() -eq $expected) }
if (-not $ok) {
  Step "Downloading Electron $ElectronVersion for Windows x64 (about 110 MB)"
  Download "$BaseUrl/$ZipName" $Zip
  if ((Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower() -ne $expected) { Remove-Item $Zip -Force; throw 'Electron download is corrupted (checksum mismatch). Run the script again.' }
}
Write-Host 'Electron download verified.' -ForegroundColor Green

# 3. Fresh output folder (an existing non-Onyx folder is kept aside, never deleted)
# keep an AI key file that Onyx hasn't imported yet
$PendingKey = $null
$KeyFile = Join-Path $Dest 'resources\app\ai-key.txt'
if (Test-Path $KeyFile) { $PendingKey = Get-Content $KeyFile -Raw }
if (Test-Path $Dest) {
  if (Test-Path (Join-Path $Dest 'Onyx.exe')) {
    Step 'Replacing previous Onyx build'
    Remove-Item $Dest -Recurse -Force
  } else {
    $aside = "$Dest-old-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Step "A folder named onyx already exists; moving it to $aside"
    Move-Item $Dest $aside
  }
}
Step 'Unpacking Electron'
Expand-Archive -Path $Zip -DestinationPath $Dest -Force

# 4. Turn electron.exe into Onyx.exe and add the app
Step 'Adding the Onyx app'
Rename-Item (Join-Path $Dest 'electron.exe') 'Onyx.exe'
Remove-Item (Join-Path $Dest 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
$AppDir = Join-Path $Dest 'resources\app'
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
foreach ($f in $AppFiles) { Copy-Item (Join-Path $Src $f) $AppDir -Force }
if (Test-Path (Join-Path $Src 'README.txt')) { Copy-Item (Join-Path $Src 'README.txt') $Dest -Force }
if ($PendingKey) { Set-Content -Path (Join-Path $AppDir 'ai-key.txt') -Value $PendingKey -NoNewline }
$SrcKey = Join-Path $Src 'ai-key.txt'
if (Test-Path $SrcKey) { Move-Item $SrcKey (Join-Path $AppDir 'ai-key.txt') -Force }

# 5. Give the exe the Onyx icon and name (optional; skipped if it fails)
try {
  $Rcedit = Join-Path $Cache 'rcedit-x64.exe'
  if (-not (Test-Path $Rcedit)) { Step 'Downloading rcedit (sets the exe icon)'; Download 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe' $Rcedit }
  & $Rcedit (Join-Path $Dest 'Onyx.exe') --set-icon (Join-Path $Src 'icon.ico') `
    --set-version-string 'ProductName' 'Onyx' --set-version-string 'FileDescription' 'Onyx' `
    --set-version-string 'CompanyName' 'Onyx' --set-version-string 'OriginalFilename' 'Onyx.exe' `
    --set-version-string 'InternalName' 'Onyx' --set-file-version '2.4.0' --set-product-version '2.4.0'
  if ($LASTEXITCODE -ne 0) { throw "rcedit exit code $LASTEXITCODE" }
  Write-Host 'Icon set.' -ForegroundColor Green
} catch { Write-Host "Couldn't set the icon ($($_.Exception.Message)). Onyx still works, it just has the Electron icon." -ForegroundColor Yellow }

# 6. Shortcuts
Step 'Creating shortcuts'
$Shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))) {
  try {
    $lnk = $Shell.CreateShortcut((Join-Path $dir 'Onyx.lnk'))
    $lnk.TargetPath = Join-Path $Dest 'Onyx.exe'
    $lnk.WorkingDirectory = $Dest
    $lnk.IconLocation = (Join-Path $AppDir 'onyx-stone.ico') + ',0'
    $lnk.Description = 'Onyx - Smart File Organizer'
    $lnk.Save()
  } catch { Write-Host "Couldn't create a shortcut in $dir" -ForegroundColor Yellow }
}

# 7. Only the stone icon: drop broken Onyx shortcuts left by old builds, then refresh Windows' icon cache
Step 'Refreshing icons'
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))) {
  Get-ChildItem -Path $dir -Filter 'Onyx*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $t = $Shell.CreateShortcut($_.FullName).TargetPath
      if ($t -and -not (Test-Path $t)) { Remove-Item $_.FullName -Force; Write-Host "Removed old shortcut $($_.Name) (its program no longer exists)" }
    } catch {}
  }
}
try {
  $ie4 = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
  if (Test-Path $ie4) { & $ie4 -ClearIconCache 2>$null; & $ie4 -show 2>$null }
} catch {}

Step 'Done'
Write-Host "Onyx is ready: $Dest\Onyx.exe" -ForegroundColor Green
Start-Process (Join-Path $Dest 'Onyx.exe') -WorkingDirectory $Dest
