#Requires -Version 7
<#
  test.ps1 — joue toute la campagne de tests dans un vrai navigateur.

  Chaque scenario de tests/ pilote l'app dans un cadre isole et enregistre
  ses verifications. Le script demarre son propre serveur, enchaine les
  scenarios dans Chrome sans fenetre, puis affiche le bilan.

  Usage :
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1 -Filtre pause
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1 -Detail
#>
param(
  [string]$Filtre = '',
  [switch]$Detail,
  [int]$Port = 8079
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$travail = Join-Path $env:TEMP 'rush-tests'

# budget : temps virtuel accorde au scenario (le navigateur l'ecoule aussi vite qu'il peut)
# profil  : les scenarios qui partagent un profil se transmettent leur sauvegarde
$SCENARIOS = @(
  @{ f = '01-parcours-complet.html';               b = 15000; p = 'a' }
  @{ f = '02a-coupure-en-plein-tour.html';         b = 12000; p = 'b' }
  @{ f = '02b-reprise-en-plein-tour.html';         b = 90000; p = 'b' }
  @{ f = '03a-coupure-entre-tours.html';           b = 8000;  p = 'c' }
  @{ f = '03b-reprise-entre-tours.html';           b = 20000; p = 'c' }
  @{ f = '04-son-et-vibration-actifs.html';        b = 70000; p = 'd' }
  @{ f = '05-son-coupe.html';                      b = 70000; p = 'e' }
  @{ f = '06-equipe-qui-commence.html';            b = 15000; p = 'f' }
  @{ f = '07-pause-manuelle.html';                 b = 60000; p = 'g' }
  @{ f = '08-pause-automatique.html';              b = 60000; p = 'h' }
  @{ f = '09-manche-pantin-mode-simple.html';      b = 20000; p = 'i' }
  @{ f = '10-manche-pantin-mode-nominatif.html';   b = 20000; p = 'j' }
  @{ f = '11-quota-ia-et-fiche-theme.html';        b = 20000; p = 'k' }
  @{ f = '12-fonction-serveur.html';               b = 15000; p = 'l' }
  @{ f = '13-theme-manuel.html';                   b = 15000; p = 'm' }
  @{ f = '14-regles-du-jeu.html';                  b = 15000; p = 'n' }
  @{ f = '15-correction-fin-de-tour.html';         b = 70000; p = 'o' }
  @{ f = '16-scores-manche-partie-soiree.html';    b = 30000; p = 'p' }
  @{ f = '17-dialogues-et-suppression.html';       b = 20000; p = 'q' }
  @{ f = '18-session-partagee.html';               b = 20000; p = 'r' }
  @{ f = '19-page-invite.html';                    b = 30000; p = 's' }
  @{ f = '20-session-organisateur.html';           b = 40000; p = 't' }
  @{ f = '21-session-nominative.html';             b = 40000; p = 'u' }
  @{ f = '22-reprise-puis-nouvelle-partie.html';   b = 20000; p = 'v' }
  @{ f = '23-cartes-remises-en-jeu.html';          b = 20000; p = 'w' }
  @{ f = '24-rejouer-cartes-perso.html';           b = 45000; p = 'x' }
  @{ f = '25-detail-par-joueur.html';              b = 30000; p = 'y' }
  @{ f = '26-suivi-de-partie.html';                b = 15000; p = 'z' }
)

function Resolve-Chrome {
  $pistes = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $pistes) { if (Test-Path $p) { return $p } }
  throw "Chrome introuvable : les tests ont besoin de Chrome pour piloter l'app."
}

$chrome = Resolve-Chrome
if (Test-Path $travail) { Remove-Item $travail -Recurse -Force }
New-Item -ItemType Directory -Path $travail -Force | Out-Null

# --- Serveur dedie, sur un port a part pour ne pas gener un serveur de dev ---
# Les chemins peuvent contenir des espaces : chaque argument est explicitement entre guillemets
$scriptServeur = Join-Path $PSScriptRoot 'serve.ps1'
$serveur = Start-Process pwsh -PassThru -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', "`"$scriptServeur`"",
  '-Root', "`"$repo`"",
  '-Port', "$Port"
)

try {
  $pret = $false
  foreach ($essai in 1..25) {
    try {
      Invoke-WebRequest "http://localhost:$Port/index.html" -UseBasicParsing -TimeoutSec 2 | Out-Null
      $pret = $true; break
    } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $pret) { throw "Le serveur de test n'a pas demarre sur le port $Port." }

  $totalOk = 0
  $totalKo = 0
  $joues = 0

  foreach ($s in $SCENARIOS) {
    if ($Filtre -and $s.f -notlike "*$Filtre*") { continue }
    if (-not (Test-Path (Join-Path $repo "tests\$($s.f)"))) {
      Write-Output ("{0,-42} : SCENARIO INTROUVABLE" -f $s.f)
      $totalKo++; continue
    }
    $joues++

    $sortie = Join-Path $travail "$($s.f).txt"
    & $chrome --headless --disable-gpu --no-first-run --no-default-browser-check `
              --autoplay-policy=no-user-gesture-required `
              --user-data-dir="$travail\profil-$($s.p)" `
              --virtual-time-budget=$($s.b) `
              --dump-dom "http://localhost:$Port/tests/$($s.f)" 2>$null |
      Out-File $sortie -Encoding utf8

    $brut = Get-Content $sortie -Raw
    if ($brut -match '(?s)<pre id="log">(.*?)</pre>') {
      $bloc = $Matches[1] -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&' -replace '&quot;', '"'
      $ok = ([regex]::Matches($bloc, 'PASS --')).Count
      # Une exception interrompt le scenario en silence : sans ce comptage, un
      # fichier a moitie joue affichait « 0 echec » et passait pour vert.
      $ko = ([regex]::Matches($bloc, 'FAIL --')).Count `
          + ([regex]::Matches($bloc, 'EXCEPTION:')).Count `
          + ([regex]::Matches($bloc, 'ERREUR APP:')).Count
      $totalOk += $ok; $totalKo += $ko
      Write-Output ("{0,-42} : {1,3} ok, {2} echec(s)" -f $s.f, $ok, $ko)
      if ($Detail) { ($bloc -split "`n") | ForEach-Object { "      $_" } }
      elseif ($ko -gt 0) {
        ($bloc -split "`n") | Where-Object { $_ -match 'FAIL|EXCEPTION|ERREUR' } | ForEach-Object { "      $_" }
      }
    } else {
      Write-Output ("{0,-42} : AUCUN RESULTAT (page cassee ?)" -f $s.f)
      $totalKo++
    }
  }

  Write-Output ''
  Write-Output "BILAN : $totalOk verification(s) reussie(s), $totalKo echec(s), sur $joues scenario(s)."
  if ($totalKo -gt 0) { exit 1 }
}
finally {
  if ($serveur -and -not $serveur.HasExited) { Stop-Process -Id $serveur.Id -Force -ErrorAction SilentlyContinue }
}
