#Requires -Version 7
<#
  deploy.ps1 — publie Rush en production.

  Enchaîne : bump du cache service worker (si un asset caché a changé)
  → commit → push → vérification en production. Vercel déploie automatiquement
  sur push vers la branche.

  La vérification finale existe parce que les tests tournent contre le serveur
  local, qui ne se comporte pas exactement comme Vercel : c'est ainsi qu'un
  /rejoindre en 404 avait échappé à 623 vérifications.

  Usage :
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Check
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Message "fix du chrono"
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -VerifierSeulement
#>
[CmdletBinding()]
param(
  [string]$Message,
  [switch]$Check,
  [switch]$VerifierSeulement,
  [switch]$SansVerification,
  [string]$Site = 'https://rush-alexina.vercel.app'
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

# ===== Verification en production =====
# Interroge le site reellement deploye. Aucune ecriture : le controle de l'API
# demande l'etat d'une partie inexistante, ce qui prouve a la fois que la
# fonction serveur repond et que le stockage Upstash est joignable (sans lui,
# elle renverrait 503 au lieu de 404).

function Get-Reponse {
  param([string]$Url, [string]$Methode = 'GET', [string]$Corps = $null)
  try {
    $p = @{ Uri = $Url; Method = $Methode; UseBasicParsing = $true; TimeoutSec = 20; SkipHttpErrorCheck = $true }
    if ($Corps) { $p.ContentType = 'application/json'; $p.Body = $Corps }
    return Invoke-WebRequest @p
  } catch {
    return $null
  }
}

function Test-Production {
  param([string]$Racine, [string]$CacheAttendu)

  $controles = @(
    @{ nom = "accueil";                 url = "$Racine/";                 code = 200; contient = '<title>Rush</title>' }
    @{ nom = "page des invites";        url = "$Racine/rejoindre";        code = 200; contient = 'rejoindre une partie' }
    @{ nom = "  la meme, en .html";     url = "$Racine/rejoindre.html";   code = 200; contient = 'rejoindre une partie' }
    @{ nom = "manifeste";               url = "$Racine/manifest.json";    code = 200; contient = '"name": "Rush"' }
    @{ nom = "moteur de jeu";           url = "$Racine/js/app.js";        code = 200 }
    @{ nom = "bibliotheque QR";         url = "$Racine/js/vendor/qrcode.js"; code = 200 }
    @{ nom = "service worker";          url = "$Racine/sw.js";            code = 200; contient = "'$CacheAttendu'" }
    @{ nom = "generation IA (methode)"; url = "$Racine/api/generate";     code = 405 }
    @{ nom = "session partagee + KV";   url = "$Racine/api/session";      code = 404; methode = 'POST'
       corps = '{"action":"etat","code":"ZZZZ"}'; contient = 'Aucune partie' }
  )

  $echecs = 0
  foreach ($c in $controles) {
    # Plusieurs tentatives : le reseau de diffusion de Vercel sert des copies
    # mises en cache, et une copie ancienne peut subsister quelques secondes
    # apres le deploiement. Une fausse alerte decredibiliserait le controle.
    $ok = $false
    $r = $null
    foreach ($tentative in 1..3) {
      $r = Get-Reponse -Url $c.url -Methode ($c.methode ?? 'GET') -Corps $c.corps
      $ok = $r -and $r.StatusCode -eq $c.code
      if ($ok -and $c.contient) { $ok = $r.Content -match [regex]::Escape($c.contient) }
      if ($ok) { break }
      if ($tentative -lt 3) { Start-Sleep -Seconds 4 }
    }

    $etat = if ($ok) { 'OK   ' } else { 'ECHEC' }
    $vu = if ($r) { $r.StatusCode } else { 'injoignable' }
    # Write-Host et non Write-Output : sinon ces lignes se melangeraient a la
    # valeur de retour de la fonction, qui doit rester un simple compteur.
    Write-Host ("  {0} {1,-26} attendu {2}, recu {3}" -f $etat, $c.nom, $c.code, $vu)
    if (-not $ok) { $echecs++ }
  }

  # Les references de travail restent dans le depot mais hors du site : sans
  # .vercelignore, une maquette aux scores inventes serait ouvrable par son
  # adresse et laisserait croire que le jeu est casse.
  foreach ($fichier in @('proto-scores.html', 'rush-app.html', 'CLAUDE.md')) {
    $code = 200
    foreach ($tentative in 1..3) {
      $r = Get-Reponse -Url "$Racine/$fichier"
      $code = if ($r) { $r.StatusCode } else { 'injoignable' }
      if ($code -ne 200) { break }
      if ($tentative -lt 3) { Start-Sleep -Seconds 4 }
    }
    if ($code -eq 200) {
      Write-Host ("  ECHEC {0,-26} servi en ligne, attendu hors site" -f $fichier)
      $echecs++
    } else {
      Write-Host ("  OK    {0,-26} hors du site, recu {1}" -f $fichier, $code)
    }
  }

  # Le nom du depot ne doit apparaitre nulle part cote joueur
  foreach ($page in @("$Racine/", "$Racine/rejoindre")) {
    $r = Get-Reponse -Url $page
    if ($r -and $r.Content -match 'timesup') {
      Write-Host ("  ECHEC nom du depot visible sur $page")
      $echecs++
    }
  }

  return $echecs
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
  $out = & $git @GitArgs
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') a échoué (code $LASTEXITCODE)" }
  return $out
}

Set-Location $repo

# --- Verification seule, sans rien publier ---
if ($VerifierSeulement) {
  $cache = ([regex]::Match((Get-Content (Join-Path $repo 'sw.js') -Raw), "const CACHE_NAME = '(rush-v\d+)';")).Groups[1].Value
  Write-Output "VERIFICATION EN PRODUCTION ($Site)"
  $echecs = Test-Production -Racine $Site -CacheAttendu $cache
  Write-Output ""
  if ($echecs -eq 0) { Write-Output "Tout repond correctement."; exit 0 }
  Write-Output "$echecs controle(s) en echec."
  exit 1
}

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

# Les fichiers touchés par ces commits comptent autant que ceux du répertoire
# de travail. Sans eux, publier après avoir committé poussait le nouveau code
# sous l'ancien numero de cache : les telephones deja installes gardaient la
# version precedente pour toujours, et les douze controles passaient au vert.
# C'est arrive deux fois le 27 aout 2026.
$dejaCommites = @()
try {
  $dejaCommites = @(Invoke-Git diff --name-only '@{u}...HEAD') | Where-Object { $_ } |
    ForEach-Object { $_ -replace '\\', '/' }
} catch { $dejaCommites = @() }

# --- Le cache du service worker doit-il être bumpé ? ---
$swFile = Join-Path $repo 'sw.js'
$swText = Get-Content $swFile -Raw
$assets = [regex]::Matches($swText, "'(/[^']*)'") | ForEach-Object { $_.Groups[1].Value }

$aPublier = @($changed) + @($dejaCommites) | Select-Object -Unique
$needsBump = $false
foreach ($f in $aPublier) {
  if ($assets -contains "/$f") { $needsBump = $true; break }
  if ($f -eq 'index.html' -and $assets -contains '/') { $needsBump = $true; break }
}

# Le bump est deja fait a la main : ne pas le refaire par-dessus.
if ($needsBump -and $dejaCommites -contains 'sw.js' -and $changed.Count -eq 0) {
  $enLigne = $null
  try {
    $reponse = Invoke-WebRequest "$Site/sw.js?verif=$(Get-Random)" -UseBasicParsing -TimeoutSec 10
    $enLigne = ([regex]::Match($reponse.Content, "const CACHE_NAME = 'rush-v(\d+)';")).Groups[1].Value
  } catch { $enLigne = $null }
  $local = ([regex]::Match($swText, "const CACHE_NAME = 'rush-v(\d+)';")).Groups[1].Value
  if ($enLigne -and [int]$local -gt [int]$enLigne) {
    Write-Output "Cache deja bumpe dans les commits en attente : rush-v$enLigne -> rush-v$local"
    $needsBump = $false
  }
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

if ($SansVerification) {
  Write-Output "Vercel deploie automatiquement (environ 1 minute). Verification passee."
  exit 0
}

# --- Attente du deploiement, puis verification ---
$cacheFinal = ([regex]::Match((Get-Content $swFile -Raw), "const CACHE_NAME = '(rush-v\d+)';")).Groups[1].Value

Write-Output ""
Write-Output "Attente du deploiement Vercel..."
$enLigne = $false
foreach ($essai in 1..24) {
  Start-Sleep -Seconds 5
  $r = Get-Reponse -Url "$Site/sw.js"
  if ($r -and $r.StatusCode -eq 200 -and $r.Content -match [regex]::Escape("'$cacheFinal'")) {
    Write-Output "Deploiement en ligne apres $($essai * 5) s."
    $enLigne = $true
    break
  }
}
if (-not $enLigne) {
  Write-Output "Le deploiement n'est pas encore visible apres 2 minutes — on verifie quand meme."
}

Write-Output ""
Write-Output "VERIFICATION EN PRODUCTION ($Site)"
$echecs = Test-Production -Racine $Site -CacheAttendu $cacheFinal

Write-Output ""
if ($echecs -eq 0) {
  Write-Output "Tout repond correctement en production."
} else {
  Write-Output "$echecs controle(s) en echec. Le commit $sha est pousse, mais la production n'est pas saine."
  exit 1
}
