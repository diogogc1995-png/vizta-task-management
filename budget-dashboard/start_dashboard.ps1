# Arranca o dashboard em segundo plano (sem janela) se ainda não estiver a correr.
# Usado pelo atalho na pasta de Arranque do Windows (ver README: "Arrancar sozinho com o Windows").
$dir = $PSScriptRoot
$python = Join-Path $dir ".venv\Scripts\python.exe"
$port = 8765
try {
    $cfg = Get-Content (Join-Path $dir "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.port) { $port = [int]$cfg.port }
} catch {}

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { exit 0 }  # já está a correr

$env:PYTHONIOENCODING = "utf-8"
Start-Process -FilePath $python -ArgumentList "-W", "ignore", "-u", "app.py", "--no-browser" `
    -WorkingDirectory $dir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $env:TEMP "budget_app.log") `
    -RedirectStandardError (Join-Path $env:TEMP "budget_app.err.log")
