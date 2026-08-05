# Upload new/changed guide images to R2.
#
# Run this BEFORE the deploy that references new screenshots. The site's images
# are served from R2 by functions/games/[[path]].js and are no longer part of the
# deployment, so HTML that goes live pointing at an image R2 does not have yet
# will 404 until this runs.
#
# Safe by design: `rclone copy` only adds and overwrites, it never deletes. Files
# already in the bucket with the same size and modification time are skipped, so
# re-running it after adding one map uploads only that map.
#
# For a map you have re-shot or restructured, use r2-sync-map.ps1 instead —
# copy leaves the old objects behind.
#
#   .\build_scripts\r2-upload.ps1              # dry run, shows what would go
#   .\build_scripts\r2-upload.ps1 -Apply       # actually upload

param(
    [switch]$Apply,
    # Narrow to one map to keep the listing short, e.g. -Path "BO7\astra_malorum"
    [string]$Path = ""
)

$ErrorActionPreference = "Stop"

$repo    = Split-Path -Parent $PSScriptRoot
$rclone  = Join-Path $repo "guide_making_utils\rclone\rclone.exe"
$source  = Join-Path $repo "src\games"
$remote  = "r2:mmmrkennedy-images/img"

if ($Path) {
    $source = Join-Path $source $Path
    $remote = "$remote/$($Path -replace '\\','/')"
}

if (-not (Test-Path $rclone)) { throw "rclone not found at $rclone" }
if (-not (Test-Path $source)) { throw "source not found: $source" }

# Only the formats the Function serves. Without these filters the guide .html
# files sitting in the same tree would be uploaded too.
$filters = @(
    "--include", "*.webp",
    "--include", "*.png",
    "--include", "*.jpg",
    "--include", "*.jpeg",
    "--include", "*.gif"
)

$args = @("copy", $source, $remote) + $filters + @("--progress", "--transfers", "8")
if (-not $Apply) { $args += "--dry-run" }

Write-Host ""
Write-Host "  source : $source"
Write-Host "  remote : $remote"
Write-Host "  mode   : $(if ($Apply) { 'UPLOAD' } else { 'DRY RUN (pass -Apply to upload)' })"
Write-Host ""

# Windows PowerShell 5.1 turns a native program's stderr into ErrorRecords, and
# with ErrorActionPreference=Stop that aborts the script on rclone's ordinary
# progress notices. Relax it around the call and judge success by exit code.
$ErrorActionPreference = "Continue"
& $rclone @args
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"

if ($code -ne 0) { throw "rclone exited with code $code" }

if ($Apply) {
    Write-Host ""
    Write-Host "  Bucket now holds:"
    $ErrorActionPreference = "Continue"
    & $rclone size $remote
    $ErrorActionPreference = "Stop"
    Write-Host ""
    Write-Host "  Replaced an existing image? The edge may still serve the old one."
    Write-Host "  Purge those URLs before checking the live site."
}
