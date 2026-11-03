# ============================================================================
#  MAPFINDER - serveur local de secours (PowerShell, sans Python ni Node.js)
#  Sert le dossier courant sur http://localhost:8000
# ============================================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8000
$url  = "http://localhost:$port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".gif"  = "image/gif"
  ".ico"  = "image/x-icon"
  ".map"  = "application/json; charset=utf-8"
  ".md"   = "text/markdown; charset=utf-8"
}

Write-Host ""
Write-Host "  MAPFINDER - serveur local PowerShell"
Write-Host "  Racine  : $root"
Write-Host "  Adresse : $url"
Write-Host "  Ctrl+C pour arreter."
Write-Host ""

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try {
  $listener.Start()
} catch {
  Write-Host "  Impossible d'ouvrir le port $port : $($_.Exception.Message)"
  Write-Host "  (essayez de lancer PowerShell en administrateur, ou utilisez Python)"
  Read-Host "Appuyez sur Entree pour fermer"
  exit 1
}

Start-Process $url

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
  } catch { break }

  $req = $ctx.Request
  $res = $ctx.Response
  $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
  if ($rel -eq "/" -or $rel -eq "") { $rel = "/index.html" }

  $full = Join-Path $root ($rel.TrimStart("/") -replace "/", "\")
  $fullResolved = [System.IO.Path]::GetFullPath($full)

  if (-not $fullResolved.StartsWith([System.IO.Path]::GetFullPath($root))) {
    $res.StatusCode = 403
    $body = [System.Text.Encoding]::UTF8.GetBytes("Acces refuse")
    $res.OutputStream.Write($body, 0, $body.Length)
    $res.Close()
    continue
  }

  if (Test-Path $fullResolved -PathType Leaf) {
    $ext = [System.IO.Path]::GetExtension($fullResolved).ToLower()
    $type = $mime[$ext]
    if (-not $type) { $type = "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($fullResolved)
    $res.ContentType = $type
    $res.Headers.Add("Cache-Control", "no-cache")
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $res.StatusCode = 404
    $body = [System.Text.Encoding]::UTF8.GetBytes("Fichier introuvable : $rel")
    $res.OutputStream.Write($body, 0, $body.Length)
  }
  $res.Close()
}
