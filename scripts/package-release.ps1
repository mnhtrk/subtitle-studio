# полная сборка установщика - venv + модель hf + ffmpeg + tauri msi
# запускать из корня репо командой npm run release:win

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Tauri = Join-Path $Root "src-tauri"
$MlDev = Join-Path $Tauri "sidecar\ml"
$MlBundle = Join-Path $Tauri "bundle-extra\runtime\ml"
$BinBundle = Join-Path $Tauri "bundle-extra\bin"
$VenvPy = Join-Path $MlDev ".venv\Scripts\python.exe"
$ModelId = "norwoodsystems/norwood-maleVSfemale"

function Require-Path($p, $msg) {
    if (-not (Test-Path $p)) { throw $msg }
}

Write-Host "=== Subtitle Studio: release package ===" -ForegroundColor Cyan

# ffmpeg должен лежать в bundle-extra/bin
Require-Path (Join-Path $BinBundle "ffmpeg.exe") @"
Нет $BinBundle\ffmpeg.exe
Скачайте ffmpeg-release-essentials и скопируйте ffmpeg.exe и ffprobe.exe в src-tauri\bundle-extra\bin\
"@
Require-Path (Join-Path $BinBundle "ffprobe.exe") "Нет ffprobe.exe в bundle-extra\bin"

# python venv для разработки в sidecar/ml/.venv
if (-not (Test-Path $VenvPy)) {
    Write-Host "Создаём .venv в sidecar\ml ..." -ForegroundColor Yellow
    Push-Location $MlDev
    python -m venv --copies .venv
    Pop-Location
}

Write-Host "pip install -r requirements.txt ..." -ForegroundColor Yellow
& $VenvPy -m pip install --upgrade pip -q
& $VenvPy -m pip install -r (Join-Path $MlDev "requirements.txt") -q

# готовим staging для tauri в bundle-extra/runtime/ml
Write-Host "Подготовка bundle-extra/runtime/ml ..." -ForegroundColor Yellow
if (Test-Path $MlBundle) {
    Remove-Item $MlBundle -Recurse -Force
}
New-Item -ItemType Directory -Path $MlBundle -Force | Out-Null

foreach ($f in @("vad.py", "classify.py", "requirements.txt", "README.md")) {
    Copy-Item (Join-Path $MlDev $f) (Join-Path $MlBundle $f)
}

$hfCache = Join-Path $MlBundle "hf-cache"
New-Item -ItemType Directory -Path $hfCache -Force | Out-Null

Write-Host "Скачивание модели пола ($ModelId) в hf-cache (~400 MB) ..." -ForegroundColor Yellow
$env:HF_HOME = $hfCache
$env:TRANSFORMERS_CACHE = $hfCache
$env:HUGGINGFACE_HUB_CACHE = Join-Path $hfCache "hub"
& $VenvPy -c @"
from transformers import pipeline
pipeline('audio-classification', model='$ModelId', device='cpu')
print('OK: model cached')
"@

Write-Host "Копирование .venv в bundle (~1.5 GB, несколько минут) ..." -ForegroundColor Yellow
$venvSrc = Join-Path $MlDev ".venv"
$venvDst = Join-Path $MlBundle ".venv"
& robocopy $venvSrc $venvDst /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "robocopy .venv failed with exit code $LASTEXITCODE"
}

$venvSizeMb = [math]::Round((Get-ChildItem $venvDst -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB)
$hfSizeMb = [math]::Round((Get-ChildItem $hfCache -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "Staging: .venv ~${venvSizeMb} MB, hf-cache ~${hfSizeMb} MB" -ForegroundColor Green

# tauri собираем только msi - nsis падает на payload >~2gb (internal compiler error #12345)
Write-Host "npm run tauri build -- --bundles msi ..." -ForegroundColor Cyan
Push-Location $Root
npm run tauri build -- --bundles msi
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) { exit $buildExit }

Write-Host ""
$msiDir = Join-Path $Tauri "target\release\bundle\msi"
$found = $false
if (Test-Path $msiDir) {
    Get-ChildItem $msiDir -Filter "*.msi" | ForEach-Object {
        $found = $true
        $sizeMb = [math]::Round($_.Length / 1MB, 1)
        Write-Host "Done. Send this installer to users:" -ForegroundColor Green
        Write-Host ('  {0}  ({1} MB)' -f $_.FullName, $sizeMb)
    }
}
if (-not $found) {
    $bundleHint = Join-Path $Tauri "target\release\bundle"
    Write-Host "MSI not found. Check: $bundleHint" -ForegroundColor Yellow
}
