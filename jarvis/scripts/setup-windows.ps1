<#
.SYNOPSIS
  One-time JARVIS setup on Windows 11: checks prerequisites, creates the Python venv, installs backend
  and frontend dependencies, builds the UI and creates .env from .env.example.
  Makes NO system-level changes (no installs of Python/Node/Ollama, no firewall or registry edits).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -SkipStt
#>
[CmdletBinding()]
param(
  [switch]$SkipStt,        # skip faster-whisper (large download); voice input will show NOT CONFIGURED
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; exit 1 }

Write-Host "`nJ.A.R.V.I.S. setup — $Root`n" -ForegroundColor Cyan

# ---------------------------------------------------------------- prerequisites
$pyExe = $null
$pyArgs = @()
foreach ($cand in @("py -3.13", "py -3.12", "python")) {
  try {
    $parts = @($cand -split " ")
    $exe = $parts[0]
    $extra = @($parts | Select-Object -Skip 1)
    $v = & $exe @extra -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
    if ($LASTEXITCODE -eq 0 -and $v -and [version]$v -ge [version]"3.12") {
      $pyExe = $exe; $pyArgs = $extra; Ok "Python $v ($cand)"; break
    }
  } catch { }
}
if (-not $pyExe) { Fail "Python 3.12+ not found. Install from https://www.python.org/downloads/windows/ (tick 'Add to PATH')." }

if (-not $SkipFrontend) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Fail "Node.js not found. Install the LTS version from https://nodejs.org/" }
  $nv = (& node --version).TrimStart("v")
  if ([version]$nv -lt [version]"20.19") { Fail "Node $nv is too old; need 20.19+ (22 LTS recommended)." }
  Ok "Node $nv"
}

if (Get-Command ollama -ErrorAction SilentlyContinue) {
  Ok "Ollama found: $(& ollama --version 2>$null)"
  $models = & ollama list 2>$null
  if ($models -match "qwen3:8b") { Ok "Model qwen3:8b present" } else { Warn "Model missing. Run: ollama pull qwen3:8b" }
} else {
  Warn "Ollama not found. Install from https://ollama.com/download then run: ollama pull qwen3:8b"
}

if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  $gpu = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>$null
  Ok "NVIDIA GPU: $gpu"
} else {
  Warn "nvidia-smi not found: GPU telemetry will show 'unavailable' (Ollama may still use the GPU)."
}

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Ok "FFmpeg found (optional)" }
else { Warn "FFmpeg not found (optional: audio decoding uses PyAV bundled with faster-whisper)." }

# ---------------------------------------------------------------- backend
Write-Host "`nBackend…" -ForegroundColor Cyan
$venvPy = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
  & $pyExe @pyArgs -m venv (Join-Path $Backend ".venv")
  if ($LASTEXITCODE -ne 0) { Fail "Could not create virtualenv" }
}
& $venvPy -m pip install --upgrade pip --quiet
$extras = if ($SkipStt) { "dev" } else { "stt,dev" }
Push-Location $Backend
& $venvPy -m pip install -e ".[$extras]"
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Fail "pip install failed" }
Ok "Backend dependencies installed ($extras)"

# ---------------------------------------------------------------- .env
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $Root ".env.example") $envFile
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  (Get-Content $envFile) -replace "^APP_AUTH_SECRET=.*$", "APP_AUTH_SECRET=$secret" | Set-Content $envFile -Encoding UTF8
  Ok ".env created with a random APP_AUTH_SECRET. Edit it to add FISH_API_KEY / FISH_REFERENCE_ID."
} else {
  Ok ".env already exists (left unchanged)"
}
$envText = Get-Content $envFile -Raw
if ($envText -notmatch "(?m)^FISH_API_KEY=\S+") { Warn "FISH_API_KEY is empty: the UI will show 'Voice not configured'." }

# ---------------------------------------------------------------- frontend
if (-not $SkipFrontend) {
  Write-Host "`nFrontend…" -ForegroundColor Cyan
  Push-Location $Frontend
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npm ci failed" }
  & npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "frontend build failed" }
  Pop-Location
  Ok "Frontend built to frontend\dist"
}

Write-Host "`nDone. Start JARVIS with:  .\scripts\start-windows.ps1`n" -ForegroundColor Cyan
