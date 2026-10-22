<#
.SYNOPSIS
  Query the running JARVIS server's /api/health and print each dependency state
  (ready / not_configured / unavailable). Exits 1 if the server is unreachable.
#>
[CmdletBinding()]
param([string]$Url = "http://127.0.0.1:8787")

try { $h = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 5 }
catch { Write-Host "JARVIS server not reachable at $Url — start it with .\scripts\start-windows.ps1" -ForegroundColor Red; exit 1 }

Write-Host "JARVIS $($h.version)  setup_required=$($h.setup_required)" -ForegroundColor Cyan
foreach ($p in $h.components.PSObject.Properties) {
  $state = $p.Value.state
  $color = switch ($state) { "ready" { "Green" } "not_configured" { "Yellow" } default { "Red" } }
  Write-Host ("  {0,-10} {1}" -f $p.Name.ToUpper(), $state.ToUpper()) -ForegroundColor $color
}
Write-Host "Details (after sign-in): Diagnostics panel in the UI, or GET $Url/api/diagnostics"
