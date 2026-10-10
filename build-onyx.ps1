# Builds Onyx.exe (Electron, Windows x64) into Downloads\onyx
# Downloads the official Electron runtime from GitHub, verifies it, and adds the Onyx app files.
# Optionally sets up Ollama, so Onyx's AI can run on this PC (free, private, offline).
#   -LocalAI ask   ask the first time (default), then remember the answer
#   -LocalAI yes   set it up (or repair it) and switch Onyx to it
#   -LocalAI no    skip it
param([ValidateSet('ask', 'yes', 'no')][string]$LocalAI = 'ask')

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
$AppFiles = 'package.json','main.js','preload.js','engine.js','tags.js','fileops.js','winshell.js','library.js','ops.js','extensions.js','viewer.js','renderer.js','graph.js','icons.js','theme.js','settings.js','workspace.js','index.html','styles.css','icon.ico','onyx-gem.ico','icon.png','extensions\image-viewer.js','extensions\pdf-viewer.js','extensions\media-player.js','extensions\text-viewer.js'

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
foreach ($f in $AppFiles) { $to = Join-Path $AppDir $f; New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null; Copy-Item (Join-Path $Src $f) $to -Force }
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
    --set-version-string 'InternalName' 'Onyx' --set-file-version '2.8.0' --set-product-version '2.8.0'
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
    $lnk.IconLocation = (Join-Path $AppDir 'onyx-gem.ico') + ',0'
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

# 8. Optional: an AI that runs on this PC (Ollama). Never stops the build if it fails.
function Ask($question, $default, $seconds) {
  Write-Host -NoNewline "$question "
  $end = (Get-Date).AddSeconds($seconds)
  try {
    while ((Get-Date) -lt $end) {
      if ([Console]::KeyAvailable) {
        $k = [Console]::ReadKey($true)
        if ($k.Key -eq 'Enter') { break }
        $c = $k.KeyChar.ToString().ToLower()
        if ($c -eq 'y') { Write-Host 'yes'; return $true }
        if ($c -eq 'n') { Write-Host 'no'; return $false }
      }
      Start-Sleep -Milliseconds 100
    }
  } catch { }
  Write-Host $(if ($default) { 'yes' } else { 'no' })
  return $default
}
function Find-Ollama {
  $c = Get-Command ollama.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @((Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'), (Join-Path $env:ProgramFiles 'Ollama\ollama.exe'))) { if (Test-Path $p) { return $p } }
  return $null
}
function Test-Ollama { try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 | Out-Null; return $true } catch { return $false } }
function Get-Hardware {
  $ram = 0; $vram = 0; $gpu = ''
  try { $ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch { }
  $smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  $smiPath = if ($smi) { $smi.Source } elseif (Test-Path (Join-Path $env:WINDIR 'System32\nvidia-smi.exe')) { Join-Path $env:WINDIR 'System32\nvidia-smi.exe' } else { $null }
  if ($smiPath) {
    try {
      $line = & $smiPath --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1
      if ($line) { $parts = $line.Split(','); $gpu = $parts[0].Trim(); $vram = [math]::Round([double]$parts[1].Trim() / 1024) }
    } catch { }
  }
  if (-not $gpu) { try { $gpu = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name } catch { } }
  [pscustomobject]@{ RamGB = $ram; VramGB = $vram; Gpu = $gpu }
}
function Pick-Model($hw) {
  # Ollama runs fastest on an NVIDIA card; without one it uses the processor, so smaller models keep it responsive
  if ($hw.VramGB -ge 8) { return @{ Name = 'qwen3:8b'; Size = '5.2 GB'; Why = "your $($hw.Gpu) has $($hw.VramGB) GB" } }
  if ($hw.VramGB -ge 4) { return @{ Name = 'qwen3:4b'; Size = '2.5 GB'; Why = "your $($hw.Gpu) has $($hw.VramGB) GB" } }
  if ($hw.RamGB -ge 16) { return @{ Name = 'qwen3:4b'; Size = '2.5 GB'; Why = "no NVIDIA card, so it runs on the processor ($($hw.RamGB) GB memory)" } }
  if ($hw.RamGB -ge 8) { return @{ Name = 'qwen3:1.7b'; Size = '1.4 GB'; Why = "no NVIDIA card and $($hw.RamGB) GB memory, so a small model" } }
  return $null
}

try {
  $ChoiceFile = Join-Path $Cache 'local-ai.txt'
  $prev = if (Test-Path $ChoiceFile) { (Get-Content $ChoiceFile -Raw).Trim() } else { '' }
  $hw = Get-Hardware
  $model = Pick-Model $hw
  if ($prev -like 'yes:*') { $model = @{ Name = $prev.Substring(4); Size = ''; Why = 'chosen before' } }
  $want = $false; $configure = $false
  if ($LocalAI -eq 'yes') { $want = $true; $configure = $true }
  elseif ($LocalAI -eq 'ask' -and $prev -like 'yes:*') { $want = $true }
  elseif ($LocalAI -eq 'ask' -and $prev -eq '') {
    Step 'AI on this PC (optional)'
    if (-not $model) {
      Write-Host "This PC has $($hw.RamGB) GB of memory, which is too little to run an AI model well. Onyx will keep using online AI or its offline rules." -ForegroundColor Yellow
      Set-Content -Path $ChoiceFile -Value 'no'
    } else {
      Write-Host 'Onyx can use an AI that runs on this PC instead of the internet: free, private, and it works offline.'
      Write-Host "It installs Ollama and downloads the model $($model.Name) ($($model.Size)), picked because $($model.Why)."
      $want = Ask 'Set it up now? [Y/n]' $true 60
      $configure = $want
      if (-not $want) { Set-Content -Path $ChoiceFile -Value 'no'; Write-Host 'Skipped. To set it up later, run:  "Build Onyx.bat" -LocalAI yes' }
    }
  } elseif ($LocalAI -eq 'ask' -and $prev -eq 'no') { Write-Host ''; Write-Host 'AI on this PC: skipped (you said no before). To set it up, run:  "Build Onyx.bat" -LocalAI yes' -ForegroundColor DarkGray }

  if ($want -and $model) {
    Step 'Setting up AI on this PC'
    $ollama = Find-Ollama
    if (-not $ollama) {
      # Download the installer ourselves so there's a real progress bar, check it's signed by Ollama,
      # then run it with its own small progress window (no questions asked)
      $setup = Join-Path $Cache 'OllamaSetup.exe'
      $signed = { param($f) $sig = Get-AuthenticodeSignature $f; $sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match 'Ollama' }
      if (-not ((Test-Path $setup) -and (& $signed $setup))) {
        Write-Host 'Downloading Ollama (about 1 GB):'
        try { Download 'https://ollama.com/download/OllamaSetup.exe' $setup } catch { Remove-Item $setup -Force -ErrorAction SilentlyContinue }
      }
      if ((Test-Path $setup) -and (& $signed $setup)) {
        Write-Host 'Installing Ollama (a progress window opens)...'
        $proc = Start-Process -FilePath $setup -ArgumentList '/SILENT', '/NORESTART', '/SUPPRESSMSGBOXES' -PassThru
        $t0 = Get-Date
        while (-not $proc.HasExited) {
          $e = (Get-Date) - $t0
          Write-Host -NoNewline ("`r  Installing... {0:m\:ss}  " -f $e)
          Start-Sleep -Milliseconds 500
        }
        Write-Host ("`r  Installed in {0:m\:ss}.      " -f ((Get-Date) - $t0))
        $ollama = Find-Ollama
      } elseif (Test-Path $setup) {
        Remove-Item $setup -Force
        Write-Host 'The downloaded installer is not signed by Ollama, so it was not run.' -ForegroundColor Yellow
      }
      if (-not $ollama) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($winget) {
          Write-Host 'Trying Windows Package Manager instead...'
          & winget.exe install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements
          $ollama = Find-Ollama
        }
      }
      if (-not $ollama) { throw 'Ollama did not install' }
    }
    Write-Host "Ollama: $ollama" -ForegroundColor Green
    if (-not (Test-Ollama)) {
      $tray = Join-Path (Split-Path $ollama) 'ollama app.exe'
      if (Test-Path $tray) { Start-Process -FilePath $tray } else { Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden }
      for ($i = 0; $i -lt 40 -and -not (Test-Ollama); $i++) { Start-Sleep -Seconds 1 }
      if (-not (Test-Ollama)) { throw 'Ollama did not start' }
    }
    $have = @()
    try { $have = @((Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5).models | ForEach-Object { $_.name }) } catch { }
    if ($have -notcontains $model.Name) {
      Write-Host "Downloading $($model.Name)$(if ($model.Size) { " ($($model.Size))" }). This is the slow part; it only happens once."
      # ollama draws its own progress bar
      & $ollama pull $model.Name
      if ($LASTEXITCODE -ne 0) { throw "couldn't download $($model.Name)" }
    } else { Write-Host "$($model.Name) is already downloaded." -ForegroundColor Green }
    Set-Content -Path $ChoiceFile -Value ('yes:' + $model.Name)
    if ($configure) {
      # Onyx picks this up when it starts and switches its AI to the model on this PC
      @{ model = $model.Name; url = 'http://127.0.0.1:11434' } | ConvertTo-Json | Set-Content -Path (Join-Path $AppDir 'local-ai.json') -Encoding UTF8
      Write-Host "Onyx will use $($model.Name) on this PC. You can switch back any time in Settings > AI provider." -ForegroundColor Green
    } else { Write-Host "AI on this PC is ready ($($model.Name))." -ForegroundColor Green }
  }
} catch {
  Write-Host "Couldn't set up AI on this PC ($($_.Exception.Message)). Onyx works fine without it; run the script again to retry." -ForegroundColor Yellow
}

Step 'Done'
Write-Host "Onyx is ready: $Dest\Onyx.exe" -ForegroundColor Green
Start-Process (Join-Path $Dest 'Onyx.exe') -WorkingDirectory $Dest
