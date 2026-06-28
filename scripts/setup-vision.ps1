# setup-vision.ps1 — create DAWN's Live Vision Python venv + model. No admin.
#   powershell -ExecutionPolicy Bypass -File scripts/setup-vision.ps1
# Torch-free: onnxruntime (GPU via DirectML if available, else CPU), OpenCV,
# optional RapidOCR. Resilient to missing wheels / corporate proxy.
$ErrorActionPreference = 'Stop'

$proj   = Split-Path -Parent $PSScriptRoot
$vision = Join-Path $proj 'resources\vision'
$venv   = Join-Path $vision 'venv'
$vpy    = Join-Path $venv 'Scripts\python.exe'

Write-Host "DAWN Live Vision setup -> $vision"

if (-not (Test-Path $vpy)) {
  Write-Host 'Creating venv (Python 3)...'
  if (Get-Command py -ErrorAction SilentlyContinue) { & py -3 -m venv $venv }
  else { & python -m venv $venv }
}
if (-not (Test-Path $vpy)) { throw 'venv creation failed' }

& $vpy -m pip install --upgrade pip --disable-pip-version-check | Out-Host

# trusted-host fallback for corporate TLS-inspection proxies
$common = @('--disable-pip-version-check', '--prefer-binary',
  '--trusted-host', 'pypi.org', '--trusted-host', 'files.pythonhosted.org', '--trusted-host', 'pypi.python.org')

function Pip([string[]]$pkgs) { & $vpy -m pip install @common @pkgs | Out-Host; return $LASTEXITCODE }

Write-Host "`n[1/4] Core: numpy + OpenCV"
if ((Pip @('numpy', 'opencv-python-headless')) -ne 0) { throw 'core (numpy/opencv) install failed' }

Write-Host "`n[2/4] onnxruntime (GPU via DirectML, else CPU)"
if ((Pip @('onnxruntime-directml')) -ne 0) {
  Write-Host '  DirectML wheel unavailable -> CPU onnxruntime'
  if ((Pip @('onnxruntime')) -ne 0) { throw 'onnxruntime install failed' }
}

Write-Host "`n[3/4] OCR (RapidOCR, optional)"
if ((Pip @('rapidocr-onnxruntime')) -ne 0) {
  Write-Host '  RapidOCR install failed (optional) - text reading will be disabled.'
}

Write-Host "`n[4/4] YOLOv8n model"
$models = Join-Path $vision 'models'
New-Item -ItemType Directory -Force -Path $models | Out-Null
$model = Join-Path $models 'yolov8n.onnx'
if (-not (Test-Path $model)) {
  Invoke-WebRequest -Uri 'https://huggingface.co/salim4n/yolov8n-detect-onnx/resolve/main/yolov8n-onnx-web/yolov8n.onnx' -OutFile $model -UseBasicParsing
}
Write-Host ("  model: " + [math]::Round((Get-Item $model).Length / 1MB, 1) + ' MB')

Write-Host "`nVerifying..."
& $vpy (Join-Path $vision 'test_smoke.py') | Out-Host
Write-Host "`nDONE. Enable Live Vision in DAWN."
