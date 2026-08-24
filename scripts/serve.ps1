#Requires -Version 7
<#
  serve.ps1 — sert l'app en local, pour la tester dans un navigateur.

  Les modules ES et le chargement des thèmes échouent en file:// : il faut un vrai
  serveur HTTP.

  En plus des fichiers, ce serveur imite /api/session — le point de rendez-vous des
  téléphones pour la saisie partagée des cartes. C'est une imitation en mémoire,
  suffisante pour jouer le parcours en local et pour les tests : la vraie
  implémentation est api/session.js, qui tourne chez Vercel avec Upstash.
  /api/generate, lui, n'est pas imité : la génération IA exige une vraie clé.

  Usage :
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/serve.ps1
    → http://localhost:8080

  Astuce pour essayer la saisie à plusieurs : ouvre l'app dans une fenêtre, et
  /rejoindre.html dans une fenêtre de navigation privée (stockage séparé).
#>
param(
  [string]$Root = (Split-Path $PSScriptRoot -Parent),
  [int]$Port = 8080
)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

# ===== Imitation de /api/session, en memoire =====
# Meme contrat que api/session.js, en beaucoup plus court : pas de plafond par
# adresse, pas d'expiration reelle. Ne sert qu'au developpement et aux tests.
$sessions = @{}
$suivis = @{}   # etat publie par l'organisateur, lu par les invites en mode lecture
$ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function Get-HorodatageMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

function New-Code {
  -join (1..4 | ForEach-Object { $ALPHABET[(Get-Random -Maximum $ALPHABET.Length)] })
}

function New-Id { [guid]::NewGuid().ToString('N').Substring(0, 16) }

function Get-VuePublique($s) {
  $liste = @($s.joueurs.Keys | ForEach-Object {
    $j = $s.joueurs[$_]
    [ordered]@{ id = $_; prenom = $j.prenom; role = $j.role; nbCartes = @($j.cartes).Count; fini = $j.fini }
  })
  $total = 0; $liste | ForEach-Object { $total += $_.nbCartes }
  [ordered]@{
    cartesParJoueur = $s.cartesParJoueur
    mode            = $s.mode
    attendus        = @($s.attendus)
    ouverte         = $s.ouverte
    suiviSeul       = [bool]$s.suiviSeul
    inscription     = [bool]$s.inscription
    partie          = [int]($s.partie ?? 1)
    joueurs         = $liste
    total           = $total
    tousPrets       = ($liste.Count -gt 0 -and -not ($liste | Where-Object { -not $_.fini }))
  }
}

function Invoke-FausseSession($corps) {
  $action = [string]$corps.action

  if ($action -eq 'creer') {
    $n = [int]($corps.cartesParJoueur ?? 5)
    $n = [Math]::Max(2, [Math]::Min(15, $n))
    # Liste fermee de joueurs attendus, quand on rejoue avec les memes personnes
    $attendus = @()
    foreach ($brut in @($corps.joueursAttendus)) {
      $p = ([string]$brut).Trim()
      if ($p.Length -lt 1) { continue }
      if ($attendus | Where-Object { $_.ToLower() -eq $p.ToLower() }) { continue }
      $attendus += $p
    }
    # Suivi seul : partie a themes, personne ne saisit, la session nait close
    $suiviSeul = ($corps.suiviSeul -eq $true)
    # Inscription : les invites donnent leur prenom, et rien d autre
    $inscription = ($corps.inscription -eq $true)
    $code = New-Code
    $sessions[$code] = @{
      cartesParJoueur = $n
      mode            = ($corps.mode -eq 'nominatif') ? 'nominatif' : 'simple'
      jeton           = New-Id
      ouverte         = (-not $suiviSeul)
      suiviSeul       = $suiviSeul
      inscription     = $inscription
      attendus        = $attendus
      partie          = 1
      joueurs         = @{}
    }
    return @{ statut = 200; corps = [ordered]@{
      code = $code; jeton = $sessions[$code].jeton; cartesParJoueur = $n
      mode = $sessions[$code].mode; attendus = $attendus
      suiviSeul = $suiviSeul; inscription = $inscription; expireDans = 7200 } }
  }

  $code = ([string]$corps.code).ToUpper().Trim()
  if ($code.Length -ne 4) { return @{ statut = 400; corps = @{ error = 'Code de partie invalide.' } } }

  # Suivi de partie : traite avant la session, comme dans api/session.js, ou
  # c'est ce qui rend la lecture repetee bon marche.
  if ($action -eq 'suivre') {
    return @{ statut = 200; corps = [ordered]@{
      suivi = $suivis[$code]; serveur = (Get-HorodatageMs) } }
  }
  if ($action -eq 'publier') {
    if (-not $sessions.ContainsKey($code)) {
      return @{ statut = 404; corps = @{ error = 'Aucune partie ne porte ce code.' } }
    }
    if ($corps.jeton -ne $sessions[$code].jeton) {
      return @{ statut = 403; corps = @{ error = "Action reservee a l'organisateur." } }
    }
    if ($null -eq $corps.etat) {
      return @{ statut = 400; corps = @{ error = 'Etat de partie manquant.' } }
    }
    $publieA = Get-HorodatageMs
    $version = [int]($corps.v ?? 0)
    $charge = [ordered]@{ v = $version; publieA = $publieA; etat = $corps.etat }
    $json = $charge | ConvertTo-Json -Depth 12 -Compress
    if ($json.Length -gt 4096) {
      return @{ statut = 413; corps = @{ error = 'Etat de partie trop volumineux.' } }
    }
    # Meme garde que api/session.js : une publication plus ancienne n ecrase
    # jamais une plus recente, l ordre d arrivee n etant pas garanti.
    $actuel = $suivis[$code]
    if ($actuel -and [int]$actuel.v -gt $version) {
      return @{ statut = 200; corps = [ordered]@{
        v = $actuel.v; publieA = $actuel.publieA; ignore = $true } }
    }
    $suivis[$code] = ($json | ConvertFrom-Json)
    return @{ statut = 200; corps = [ordered]@{ v = $version; publieA = $publieA } }
  }

  if (-not $sessions.ContainsKey($code)) {
    return @{ statut = 404; corps = @{ error = "Aucune partie ne porte ce code. Verifie-le, ou demande-le a l'organisateur." } }
  }
  $s = $sessions[$code]

  if ($action -in @('rejoindre', 'deposer') -and -not $s.ouverte) {
    return @{ statut = 409; corps = @{ error = 'La partie a deja demarre sans toi.' } }
  }

  switch ($action) {
    'etat' { return @{ statut = 200; corps = (Get-VuePublique $s) } }

    'rejoindre' {
      $role = ($corps.role -in @('organisateur', 'sansTel')) ? $corps.role : 'invite'
      if ($role -ne 'invite' -and $corps.jeton -ne $s.jeton) {
        return @{ statut = 403; corps = @{ error = "Action reservee a l'organisateur." } }
      }
      $prenom = ([string]$corps.prenom).Trim()
      if ($prenom.Length -lt 1) { return @{ statut = 400; corps = @{ error = 'Indique ton prenom.' } } }
      if ($prenom.Length -gt 20) { $prenom = $prenom.Substring(0, 20) }
      # Liste fermee : on rejoue avec les memes joueurs, personne d'autre n'entre
      if (@($s.attendus).Count -gt 0 -and -not ($s.attendus | Where-Object { $_.ToLower() -eq $prenom.ToLower() })) {
        return @{ statut = 409; corps = [ordered]@{
          error = "Cette partie rejoue avec les mêmes joueurs : choisis ton prénom dans la liste."
          motif = 'hors-liste' } }
      }
      # Message identique a celui d'api/session.js, accents compris : les tests
      # verifient ce texte, ils doivent verifier celui que voit le joueur.
      if ($s.joueurs.Values | Where-Object { $_.prenom.ToLower() -eq $prenom.ToLower() }) {
        return @{ statut = 409; corps = [ordered]@{
          error = "Il y a déjà un $prenom dans cette partie. Ajoute une initiale pour te distinguer."
          motif = 'prenom-pris' } }
      }
      if ($s.joueurs.Count -ge 30) {
        return @{ statut = 409; corps = @{ error = 'Cette partie est complete (30 joueurs).' } }
      }
      $id = New-Id
      $s.joueurs[$id] = @{ prenom = $prenom; role = $role; cartes = @(); fini = $false }
      return @{ statut = 200; corps = [ordered]@{
        idJoueur = $id; prenom = $prenom; cartesParJoueur = $s.cartesParJoueur; mode = $s.mode } }
    }

    'deposer' {
      $id = [string]$corps.idJoueur
      if (-not $s.joueurs.ContainsKey($id)) {
        return @{ statut = 404; corps = @{ error = 'Tu as ete retire de cette partie. Rejoins-la a nouveau.' } }
      }
      $propres = @()
      foreach ($brut in @($corps.cartes)) {
        $mot = ([string]$brut).Trim()
        if ($mot.Length -lt 2) { continue }
        if ($mot.Length -gt 40) { $mot = $mot.Substring(0, 40) }
        if ($propres -contains $mot) { continue }
        $propres += $mot
        if ($propres.Count -ge 20) { break }
      }
      $fini = [bool]$corps.fini -and $propres.Count -ge $s.cartesParJoueur
      $s.joueurs[$id].cartes = $propres
      $s.joueurs[$id].fini = $fini
      return @{ statut = 200; corps = @{ nbCartes = $propres.Count; fini = $fini } }
    }

    'retirer' {
      # L organisateur retire qui il veut ; un joueur peut se retirer lui-meme
      if (-not ($corps.soiMeme -eq $true) -and $corps.jeton -ne $s.jeton) {
        return @{ statut = 403; corps = @{ error = "Action reservee a l'organisateur." } }
      }
      $id = [string]$corps.idJoueur
      if (-not $s.joueurs.ContainsKey($id)) { return @{ statut = 404; corps = @{ error = 'Ce joueur ne fait pas partie de la session.' } } }
      $s.joueurs.Remove($id)
      return @{ statut = 200; corps = @{ ok = $true } }
    }

    'fermer' {
      if ($corps.jeton -ne $s.jeton) { return @{ statut = 403; corps = @{ error = "Action reservee a l'organisateur." } } }
      # Inscription : ni attente a surveiller, ni paquet a rapatrier
      if ($s.inscription) {
        $s.ouverte = $false
        $detail = @($s.joueurs.Values | ForEach-Object { [ordered]@{ prenom = $_.prenom; role = $_.role; nbCartes = 0 } })
        return @{ statut = 200; corps = [ordered]@{ cartes = @(); joueurs = $detail } }
      }
      $enAttente = @($s.joueurs.Values | Where-Object { -not $_.fini } | ForEach-Object { $_.prenom })
      if ($enAttente.Count -gt 0) {
        return @{ statut = 409; corps = [ordered]@{ error = 'Des joueurs saisissent encore leurs cartes.'; enAttente = $enAttente } }
      }
      $cartes = @(); $s.joueurs.Values | ForEach-Object { $cartes += $_.cartes }
      if ($cartes.Count -eq 0) { return @{ statut = 409; corps = @{ error = "Aucune carte n'a ete saisie." } } }
      $s.ouverte = $false
      $detail = @($s.joueurs.Values | ForEach-Object { [ordered]@{ prenom = $_.prenom; role = $_.role; nbCartes = @($_.cartes).Count } })
      return @{ statut = 200; corps = [ordered]@{ cartes = $cartes; joueurs = $detail } }
    }

    'relancer' {
      if ($corps.jeton -ne $s.jeton) { return @{ statut = 403; corps = @{ error = "Action reservee a l'organisateur." } } }
      if ($s.joueurs.Count -eq 0) {
        return @{ statut = 409; corps = @{ error = "Cette partie n'a aucun joueur a rappeler." } }
      }
      $n = [int]($corps.cartesParJoueur ?? $s.cartesParJoueur)
      $s.cartesParJoueur = [Math]::Max(2, [Math]::Min(20, $n))
      # Le numero de partie distingue « celle que j ai jouee » de « la nouvelle »
      $s.partie = [int]($s.partie ?? 1) + 1
      $s.ouverte = $true
      $s.attendus = @($s.joueurs.Values | ForEach-Object { $_.prenom })
      foreach ($id in @($s.joueurs.Keys)) {
        $s.joueurs[$id].cartes = @()
        $s.joueurs[$id].fini = $false
      }
      # Le suivi repart de zero, sinon son compteur de version ferait rejeter
      # les publications de la nouvelle partie
      $suivis.Remove($code)
      return @{ statut = 200; corps = [ordered]@{
        code = $code; partie = $s.partie
        cartesParJoueur = $s.cartesParJoueur; attendus = @($s.attendus) } }
    }

    default { return @{ statut = 400; corps = @{ error = 'Action inconnue.' } } }
  }
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Rush est servi sur http://localhost:$Port/  (Ctrl+C pour arreter)"
Write-Output "  /api/session est imite en memoire (saisie partagee jouable en local)"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $chemin = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($chemin -eq '/') { $chemin = '/index.html' }
    if ($chemin -eq '/rejoindre') { $chemin = '/rejoindre.html' }

    # La route de session, imitee en memoire
    if ($chemin -eq '/api/session') {
      $ctx.Response.ContentType = 'application/json; charset=utf-8'
      if ($ctx.Request.HttpMethod -ne 'POST') {
        $ctx.Response.StatusCode = 405
        $sortie = '{"error":"Method not allowed"}'
      } else {
        $lecteur = [System.IO.StreamReader]::new($ctx.Request.InputStream, [System.Text.Encoding]::UTF8)
        $brut = $lecteur.ReadToEnd()
        $lecteur.Close()
        try {
          $reponse = Invoke-FausseSession ($brut | ConvertFrom-Json)
          $ctx.Response.StatusCode = $reponse.statut
          $sortie = $reponse.corps | ConvertTo-Json -Depth 6 -Compress
        } catch {
          $ctx.Response.StatusCode = 503
          $sortie = '{"error":"Le service est momentanement indisponible."}'
        }
      }
      $octets = [System.Text.Encoding]::UTF8.GetBytes($sortie)
      $ctx.Response.OutputStream.Write($octets, 0, $octets.Length)
      $ctx.Response.Close()
      continue
    }

    $fichier = Join-Path $Root ($chemin.TrimStart('/') -replace '/', '\')

    if (Test-Path $fichier -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($fichier).ToLower()
      $ctx.Response.ContentType = $mime[$ext] ?? 'application/octet-stream'
      $octets = [System.IO.File]::ReadAllBytes($fichier)
      $ctx.Response.StatusCode = 200
      $ctx.Response.OutputStream.Write($octets, 0, $octets.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 $chemin")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
  } catch {
    # requete abandonnee par le navigateur : on continue
  }
}
