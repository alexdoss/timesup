<#
  Rush — les joueurs simules

  Tient le role des invites absents pendant un essai en local : ils rejoignent,
  deposent leurs cartes, et jouent leur tour quand l'organisateur le leur confie.
  Sans ce script, essayer le jeu a plusieurs demande autant de telephones que de
  joueurs.

  Usage :
    pwsh -File scripts/joueurs-simules.ps1 -Code Y4X6 -Prenoms Lou,Sacha
    pwsh -File scripts/joueurs-simules.ps1 -Code Y4X6            # veille seule
    pwsh -File scripts/joueurs-simules.ps1 -Code Y4X6 -Trouvees 4
    pwsh -File scripts/joueurs-simules.ps1 -Code Y4X6 -Prenoms Lou -Prod

  -Prod vise le site en ligne au lieu du serveur de developpement. Les vraies
  parties d essai s y jouent aussi, et rien ne distingue un code de l un de
  l autre : sans ce drapeau, le script cherche la partie au mauvais endroit et
  ne trouve rien.

  Le script inscrit les prenoms demandes, leur fait deposer un paquet de cartes,
  puis reste en veille : des qu'un tour est confie a l'un d'eux, il le joue et
  rend son comptage. Ctrl+C pour l'arreter — ou -Tours pour qu'il s'arrete seul.

  Il ne fait jamais que ce que ferait un vrai telephone : les memes appels, dans
  le meme ordre. Le tour est joue d'un coup parce que le paquet est prete d'un
  coup — c'est le protocole, pas un raccourci.
#>
param(
  [Parameter(Mandatory = $true)][string]$Code,
  [string]$Prenoms = '',
  [int]$Port = 8080,
  # Ou tourne la partie. Par defaut le serveur de developpement ; -Prod vise le
  # site en ligne, parce que le PM y essaie aussi de vraies parties.
  [switch]$Prod,
  [string]$Site = 'https://rush-alexina.vercel.app',
  # Combien de cartes le joueur simule trouve a chaque tour. -1 = tout le paquet,
  # ce qui vide la manche et declenche le report du temps restant.
  [int]$Trouvees = 5,
  # Secondes rendues avec le comptage : ce qui restait au chrono. 0 = temps ecoule.
  [int]$Restant = 0,
  # Nombre de tours a jouer avant de rendre la main. 0 = sans fin.
  [int]$Tours = 0,
  [int]$IntervalleMs = 1500
)

$ErrorActionPreference = 'Stop'
$racine = if ($Prod) { "$Site/api/session" } else { "http://localhost:$Port/api/session" }

function Appeler([string]$action, [hashtable]$corps = @{}) {
  $corps['action'] = $action
  try {
    return Invoke-RestMethod -Uri $racine -Method Post -ContentType 'application/json' `
                             -Body ($corps | ConvertTo-Json -Compress -Depth 6)
  } catch {
    # PowerShell 7 rend un HttpResponseMessage, pas l objet .NET Framework :
    # appeler GetResponseStream() dessus masquait la vraie erreur derriere une
    # panne du gestionnaire d erreur lui-meme. Le corps est deja lu pour nous.
    $detail = $_.ErrorDetails?.Message
    if (-not $detail) { $detail = $_.Exception.Message }
    throw "$action a echoue sur $racine : $detail"
  }
}

# Un vivier assez large pour que deux joueurs n'aient jamais le meme mot :
# les doublons declenchent la boite de dialogue de l'organisateur, qui n'a rien
# a voir avec ce qu'on essaie de tester.
$VIVIER = @(
  'Montgolfiere','Tire-bouchon','Karaoke','Belle-mere','Trampoline','Aspirateur',
  'Hamac','Chorale','Pieuvre','Rond-point','Tatouage','Papier bulle','Perceuse',
  'Igloo','Fanfare','Boule a neige','Perroquet','Sieste','Lampe de poche',
  'Machine a laver','Detective','Feu d artifice','Moustache','Parapluie',
  'Tondeuse','Accordeon','Chamallow','Toboggan','Cerf-volant','Brouette',
  'Menhir','Sous-marin','Chaussette','Reveil','Pelle a tarte','Girouette'
)

$etat = Appeler 'etat' @{ code = $Code }
Write-Output "Partie $Code — mode $($etat.mode), $($etat.cartesParJoueur) cartes par joueur"

# ===== 1. Les prenoms demandes rejoignent et deposent =====
# On ne tient QUE les prenoms demandes. Prendre en charge tous les joueurs de la
# session ferait jouer ce script a la place de celui qui essaie le jeu : il lui
# volerait son tour, ce qui est exactement le contraire du service rendu.
$presents = @{}
foreach ($j in $etat.joueurs) { $presents[$j.prenom] = $j.id }

$miens = @{}   # prenom -> idJoueur, uniquement les notres
$aInscrire = @($Prenoms -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$curseur = 0
foreach ($prenom in $aInscrire) {
  if ($presents.ContainsKey($prenom)) {
    $miens[$prenom] = $presents[$prenom]
    Write-Output "  $prenom etait deja la"
    continue
  }
  $r = Appeler 'rejoindre' @{ code = $Code; prenom = $prenom }
  $miens[$prenom] = $r.idJoueur
  Write-Output "  $prenom rejoint"

  # Une partie a themes ne demande pas de cartes : s'inscrire suffit.
  if (-not $etat.inscription) {
    $combien = [int]$etat.cartesParJoueur
    $cartes = $VIVIER[$curseur..($curseur + $combien - 1)]
    $curseur += $combien
    Appeler 'deposer' @{ code = $Code; idJoueur = $r.idJoueur; cartes = @($cartes); fini = $true } | Out-Null
    Write-Output "     depose $combien cartes"
  }
}

$apres = Appeler 'etat' @{ code = $Code }
$prets = @($apres.joueurs | Where-Object { $_.fini }).Count
Write-Output "  --- $prets / $($apres.joueurs.Count) prets · $($apres.total) cartes · tousPrets=$($apres.tousPrets)"

# ===== 2. La veille : jouer les tours qu'on nous confie =====
# On ne surveille que les joueurs qu'on tient. Un tour confie a quelqu'un
# d'autre — l'organisateur, ou un vrai telephone — ne nous regarde pas.
$aNous = @{}
foreach ($p in $miens.Keys) { $aNous[[string]$miens[$p]] = $p }
if (-not $aNous.Count) { Write-Output "Aucun joueur a tenir, rien a surveiller."; return }

Write-Output ""
Write-Output "En veille sur $($aNous.Count) joueur(s) : $($aNous.Values -join ', ')"
Write-Output "(Ctrl+C pour arreter)"

$joues = 0
$dejaJoue = @{}   # empreinte du tour -> deja rendu, pour ne pas le rejouer

while ($true) {
  Start-Sleep -Milliseconds $IntervalleMs

  # Chaque joueur demande son propre tour : le serveur ne rend le paquet qu'a
  # celui a qui il est confie, exactement comme sur un vrai telephone.
  # La veille ne doit jamais s'arreter sur un incident : un tour rate se
  # rejouera au tour de boucle suivant, un script mort laisse le joueur en plan.
  foreach ($id in @($aNous.Keys)) {
   try {
    $prenom = $aNous[$id]
    try { $lu = Appeler 'lireTour' @{ code = $Code; idJoueur = $id } } catch { continue }
    $tour = $lu.tour
    if (-not $tour) { continue }
    if ([string]$tour.idJoueur -ne [string]$id) { continue }
    if ($null -ne $tour.rendu) { continue }
    if ($null -eq $tour.mots) { continue }   # tour d'un autre, resume sans le paquet

    $empreinte = "$($tour.idJoueur)|$($tour.confieA)"
    if ($dejaJoue.ContainsKey($empreinte)) { continue }

    # Les mots arrivent en JSON : selon le contenu, PowerShell rend tantot un
    # tableau, tantot une chaine seule. On force la forme avant de compter,
    # sinon le decompte se retrouve a manipuler un tableau la ou un entier
    # est attendu.
    $mots = @()
    foreach ($mot in @($tour.mots)) { $mots += [string]$mot }
    if ($mots.Count -eq 0) { continue }

    # Le partage se fait a la main plutot qu'avec Select-Object : passer le
    # compte en parametre le soumet a la conversion de type de PowerShell, qui
    # echouait ici sans qu'on voie pourquoi. Un parcours ne convertit rien.
    $total = [int]($mots.Count)
    $combien = if ($Trouvees -lt 0) { $total } else { [Math]::Min([int]$Trouvees, $total) }
    $combien = [int]$combien

    # `$devinees` et non `$trouvees` : PowerShell ignore la casse des noms de
    # variables, si bien que `$trouvees` designerait le parametre `-Trouvees`,
    # qui est un entier. Lui affecter un tableau echouait sans rien dire de
    # clair — l'erreur parlait d'une conversion vers Int32 dix lignes plus bas.
    $devinees = @()
    $manquees = @()
    for ($i = 0; $i -lt $total; $i++) {
      if ($i -lt $combien) { $devinees += $mots[$i] } else { $manquees += $mots[$i] }
    }

    # Le paquet vide rend les secondes qui restaient : c'est ce qui ouvre la
    # manche suivante pour la meme equipe. Sinon le chrono est alle au bout.
    [int]$rend = if ($manquees.Count -eq 0) { if ($Restant -gt 1) { $Restant } else { 1 } } else { $Restant }

    Write-Output ("[{0}] {1} joue : {2} trouvees, {3} manquees, rend {4} s" -f `
      (Get-Date -Format 'HH:mm:ss'), $prenom, $devinees.Count, $manquees.Count, $rend)

    Appeler 'rendreTour' @{
      code = $Code; idJoueur = $id
      trouvees = $devinees; manquees = $manquees; restant = $rend
    } | Out-Null

    $dejaJoue[$empreinte] = $true
    $joues++
    if ($Tours -gt 0 -and $joues -ge $Tours) {
      Write-Output "$joues tour(s) joue(s), c'est fini."
      return
    }
   } catch {
     Write-Output ("[{0}] incident sur {1} ligne {2} : {3}" -f (Get-Date -Format 'HH:mm:ss'), $id,
       $_.InvocationInfo.ScriptLineNumber, $_.Exception.Message)
     Write-Output ("        > " + $_.InvocationInfo.Line.Trim())
   }
  }
}
