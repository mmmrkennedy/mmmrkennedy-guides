# Mirror ONE map's images into R2, deleting objects that no longer exist locally.
#
# This is the re-shoot tool. `rclone copy` (see r2-upload.ps1) never deletes, so
# after re-doing a map's screenshots the renamed and removed ones linger in the
# bucket forever — costing storage and, worse, still answering at their old URLs.
# `sync` makes the destination match the source exactly.
#
# SYNC DELETES. There is no undo, and R2 has no version history on this bucket.
# The map argument is mandatory and the remote is scoped to it, so a mistake can
# only ever affect one map — never other maps, and never the originals/ prefix
# holding your PNG masters.
#
# Dry run is the default. Read the DELETE lines before passing -Apply.
#
#   .\build_scripts\r2-sync-map.ps1 BO_CW\die_maschine
#   .\build_scripts\r2-sync-map.ps1 BO_CW\die_maschine -Apply
#
# Note this only mirrors what is on disk. If you re-encoded from the PNG
# originals, make sure src/ has the new files before running it.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Map,

    [switch]$Apply,

    # Compare file hashes instead of size+modtime. Slower, but catches a
    # re-encode that happens to land on the identical byte count.
    [switch]$Checksum
)

$ErrorActionPreference = "Stop"

$repo   = Split-Path -Parent $PSScriptRoot
$rclone = Join-Path $repo "guide_making_utils\rclone\rclone.exe"

$Map = $Map.Trim('\', '/')
$source = Join-Path $repo "src\games\$Map"
$remote = "r2:mmmrkennedy-images/img/$($Map -replace '\\','/')"

if (-not (Test-Path $rclone)) { throw "rclone not found at $rclone" }
if (-not (Test-Path $source)) {
    throw "no such map: $source`nExpected something like 'BO_CW\die_maschine' or 'IW\shaolin_shuffle'."
}

$filters = @(
    "--include", "*.webp",
    "--include", "*.png",
    "--include", "*.jpg",
    "--include", "*.jpeg",
    "--include", "*.gif"
)

$args = @("sync", $source, $remote) + $filters + @("--progress", "--transfers", "8")
if ($Checksum) { $args += "--checksum" }
if (-not $Apply) { $args += "--dry-run" }

Write-Host ""
Write-Host "  map    : $Map"
Write-Host "  source : $source"
Write-Host "  remote : $remote"
Write-Host "  compare: $(if ($Checksum) { 'checksum' } else { 'size + modtime' })"
Write-Host "  mode   : $(if ($Apply) { 'SYNC - WILL DELETE' } else { 'DRY RUN (pass -Apply to execute)' })"
Write-Host ""

# Windows PowerShell 5.1 turns a native program's stderr into ErrorRecords, and
# with ErrorActionPreference=Stop that aborts the script on rclone's ordinary
# progress notices — including, here, the per-file dry-run lines. Relax it around
# the call and judge success by exit code.
$ErrorActionPreference = "Continue"
& $rclone @args
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"

if ($code -ne 0) { throw "rclone exited with code $code" }

if (-not $Apply) {
    Write-Host ""
    Write-Host "  Dry run. Check every 'Deleted' line above is something you meant to remove,"
    Write-Host "  then re-run with -Apply."
} else {
    Write-Host ""
    $ErrorActionPreference = "Continue"
    & $rclone size $remote
    $ErrorActionPreference = "Stop"
    Write-Host ""
    Write-Host "  Replaced images keep their URLs, so the edge cache will still be serving"
    Write-Host "  the old ones. Purge this map's image URLs before checking the live site."
}
