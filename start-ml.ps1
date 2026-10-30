# RouteWatch ML Service Startup Script (Windows / PowerShell)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$venvDir = Join-Path $scriptDir "ml-service\.venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

# If ml-service\.venv is not found, check if backend\.venv is ready
if (-not (Test-Path $venvPython)) {
    $altPython = Join-Path $scriptDir "backend\.venv\Scripts\python.exe"
    if (Test-Path $altPython) {
        $venvPython = $altPython
    }
}

if (-not (Test-Path $venvPython)) {
    Write-Host "[ML] Creating virtual environment at $venvDir..." -ForegroundColor Cyan
    # Prefer Python 3.12 if available via py launcher, else python
    $pyCmd = "python"
    try {
        $hasPy312 = & py -3.12 --version 2>$null
        if ($LASTEXITCODE -eq 0) { $pyCmd = "py -3.12" }
    } catch {}

    Invoke-Expression "$pyCmd -m venv `"$venvDir`""
    $venvPython = Join-Path $venvDir "Scripts\python.exe"
}

Write-Host "[ML] Using Python: $venvPython" -ForegroundColor Green

Write-Host "[ML] Installing / verifying dependencies from ml-service\requirements.txt..." -ForegroundColor Cyan
& "$venvPython" -m pip install --quiet --upgrade pip
& "$venvPython" -m pip install --quiet -r "ml-service\requirements.txt"

Write-Host "[ML] Checking module imports..." -ForegroundColor Cyan
& "$venvPython" -c "import sys; sys.path.insert(0, 'ml-service'); import app; print('[ML] All dependencies & app verified!')"

Write-Host "[ML] Starting uvicorn on http://127.0.0.1:8000..." -ForegroundColor Green
& "$venvPython" -m uvicorn app:app --host 127.0.0.1 --port 8000 --app-dir ml-service

