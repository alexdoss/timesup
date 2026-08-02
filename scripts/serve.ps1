#Requires -Version 7
<#
  serve.ps1 — sert l'app en local, pour la tester dans un navigateur.

  Les modules ES et le chargement des thèmes échouent en file:// : il faut un vrai
  serveur HTTP. Celui-ci ne sert que des fichiers ; /api n'est pas disponible
  (la génération IA a besoin de Vercel).

  Usage :
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/serve.ps1
    → http://localhost:8080
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

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Rush est servi sur http://localhost:$Port/  (Ctrl+C pour arreter)"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $chemin = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($chemin -eq '/') { $chemin = '/index.html' }
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
