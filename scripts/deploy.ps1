#Requires -Version 7
<#
  deploy.ps1 — publie Rush en production.

  Enchaîne : bump du cache service worker (si un asset caché a changé)
  → commit → push. Vercel déploie automatiquement sur push vers la branche.

  Usage :
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Check
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Message "fix du chrono"
#>
[CmdletBinding()]
param(
  [string]$Message,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

# --- git n'est pas dans le PATH sur cette machine : on le résout à chaque appel ---
function Resolve-Git {
  $inPath = Get-Command git -ErrorAction SilentlyContinue
  if ($inPath) { return $inPath.Source }

  $found = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
    Sort-Object { try { [version]($_.Name -replace '^app-', '') } catch { [version]'0.0.0' } } -Descending |
    ForEach-Object { Join-Path $_.FullName 'resources\app\git\cmd\git.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

  if ($found) { return $found }
  throw "git introuvable : ni dans le PATH, ni dans GitHub Desktop."
}

$git = Resolve-Git

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
  $out = & $git @GitArgs
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') a échoué (code $LASTEXITCODE)" }
  return $out
}

Set-Location $repo
$branch = (Invoke-Git rev-parse --abbrev-ref HEAD).Trim()

# --- Ce qui a changé dans le répertoire de travail ---
$changed = @(Invoke-Git status --porcelain) | Where-Object { $_ } | ForEach-Object {
  $p = $_.Substring(3).Trim()
  if ($p -match '^"(.*)"$') { $p = $Matches[1] }
  if ($p -match ' -> ') { $p = ($p -split ' -> ')[-1] }   # renommage
  $p -replace '\\', '/'
}

# --- Commits déjà faits mais pas encore poussés ---
$ahead = @()
try { $ahead = @(Invoke-Git log '@{u}..HEAD' --oneline) | Where-Object { $_ } } catch { $ahead = @() }

# --- Le cache du service worker doit-il être bumpé ? ---
$swFile = Join-Path $repo 'sw.js'
$swText = Get-Content $swFile -Raw
$assets = [regex]::Matches($swText, "'(/[^']*)'") | ForEach-Object { $_.Groups[1].Value }

$needsBump = $false
foreach ($f in $changed) {
  if ($assets -contains "/$f") { $needsBump = $true; break }
  if ($f -eq 'index.html' -and $assets -contains '/') { $needsBump = $true; break }
}

$m = [regex]::Match($swText, "const CACHE_NAME = 'rush-v(\d+)';")
if (-not $m.Success) { throw "CACHE_NAME introuvable dans sw.js — format inattendu." }
$currentVersion = [int]$m.Groups[1].Value
$nextVersion = $currentVersion + 1

# --- Mode CHECK : on n'écrit rien, on rapporte ---
if ($Check) {
  Write-Output "BRANCHE       : $branch"
  $cacheInfo = if ($needsBump) { "rush-v$currentVersion -> rush-v$nextVersion (bump necessaire)" } else { "rush-v$currentVersion (inchange)" }
  Write-Output "CACHE SW      : $cacheInfo"
  Write-Output "MODIFIES      : $($changed.Count)"
  $changed | ForEach-Object { Write-Output "  - $_" }
  Write-Output "EN ATTENTE    : $($ahead.Count) commit(s) non pousse(s)"
  $ahead | ForEach-Object { Write-Output "  - $_" }
  if ($changed.Count -eq 0 -and $ahead.Count -eq 0) { Write-Output "RIEN A PUBLIER" }
  exit 0
}

# --- Mode DEPLOY ---
if ($changed.Count -eq 0 -and $ahead.Count -eq 0) {
  Write-Output "Rien a publier : le repo est deja synchronise avec origin/$branch."
  exit 0
}

if ($changed.Count -gt 0 -and -not $Message) {
  throw "Il y a des modifications a committer : -Message est obligatoire."
}

if ($needsBump) {
  $newText = [regex]::Replace($swText, "const CACHE_NAME = 'rush-v\d+';", "const CACHE_NAME = 'rush-v$nextVersion';")
  [System.IO.File]::WriteAllText($swFile, $newText, [System.Text.UTF8Encoding]::new($false))
  Write-Output "Cache service worker bumpe : rush-v$currentVersion -> rush-v$nextVersion"
}

if ($changed.Count -gt 0 -or $needsBump) {
  Invoke-Git add -A | Out-Null
  $staged = @(Invoke-Git diff --cached --name-only) | Where-Object { $_ }
  if ($staged.Count -gt 0) {
    Invoke-Git commit -m $Message | Out-Null
    Write-Output "Commit cree : $Message"
  }
}

Invoke-Git push origin HEAD | Out-Null
$sha = (Invoke-Git rev-parse --short HEAD).Trim()
Write-Output "Pousse sur origin/$branch — commit $sha"
Write-Output "Vercel deploie automatiquement (environ 1 minute)."
