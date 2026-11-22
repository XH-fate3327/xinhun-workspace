# Xinhun Workspace - portable package builder
# Creates a zip with program + data. Copy to another 64-bit Windows PC, unzip, run the .exe.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$stage = Join-Path $root "dist-package\_stage"
$zip = Join-Path $root ("xinhun-portable-" + $stamp + ".zip")

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host "[1/3] Collecting files (exclude .git .github .openai edge-profile logs dist-package .cache)..."
$excludeDirs = @(".git", ".github", ".openai", "edge-profile", "logs", "dist-package", ".cache")
$excludeFiles = @("*.pid", "*.lnk", "*.zip")
robocopy $root $stage /E /XD $excludeDirs /XF $excludeFiles /NFL /NDL /NJH /NJS /NP | Out-Null

Write-Host "[2/3] Creating zip (about 1-3 minutes)..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host "[3/3] Cleaning up..."
Remove-Item $stage -Recurse -Force

$size = [Math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ""
Write-Host ("Done: " + $zip + "  (" + $size + " MB)")
Write-Host "Copy the zip to another 64-bit Windows PC, unzip, then run the .exe inside (data included)."
