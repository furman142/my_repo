<#
.SYNOPSIS
  Start the JARVIS server (API + built UI) on http://127.0.0.1:8787 and open it in the browser.
  On first run the console prints a one-time SETUP CODE needed to create the owner account.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1 -NoBrowser
#>
[CmdletBinding()]
param([switch]$NoBrowser, [switch]$Kiosk)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$venvPy = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { Write-Host "Run .\scripts\setup-windows.ps1 first." -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $Root "frontend\dist\index.html"))) {
  Write-Host "Frontend not built. Run: cd frontend; npm run build" -ForegroundColor Yellow
}

$port = 8787
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  $m = Select-String -Path $envFile -Pattern "^APP_PORT=(\d+)" | Select-Object -First 1
  if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
}
$url = "http://127.0.0.1:$port"

if (Get-Command ollama -ErrorAction SilentlyContinue) {
  try { Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -TimeoutSec 2 | Out-Null }
  catch { Write-Host "Ollama is not running. Start the Ollama app (or run 'ollama serve') for chat." -ForegroundColor Yellow }
}

if (-not $NoBrowser) {
  # Open the browser once the server answers /api/health.
  Start-Job -ArgumentList $url, $Kiosk.IsPresent -ScriptBlock {
    param($u, $kiosk)
    for ($i = 0; $i -lt 60; $i++) {
      try { Invoke-RestMethod -Uri "$u/api/health" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($kiosk) { Start-Process "msedge.exe" -ArgumentList "--kiosk", $u, "--edge-kiosk-type=fullscreen" }
    else { Start-Process $u }
  } | Out-Null
}

Write-Host "Starting JARVIS on $url  (Ctrl+C to stop)" -ForegroundColor Cyan
Push-Location $Backend
try { & $venvPy -m app } finally { Pop-Location }
