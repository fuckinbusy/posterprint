<#
Система (CRM) и сайт-визитка одной командой — вместе или по отдельности,
каждый своим процессом (Windows, PowerShell 5.1 или 7). Для разработки и
компьютера в мастерской; сервер в интернете — Docker (deploy\README.md).

  .\poster.ps1 run    [all|crm|site]   в этом окне; all — два процесса, Ctrl+C гасит оба
  .\poster.ps1 start  [all|crm|site]   в фоне, скрытыми окнами
  .\poster.ps1 stop   [all|crm|site]
  .\poster.ps1 status [all|crm|site]
  .\poster.ps1 logs   crm|site         журнал вживую

Что без указания — all.
  crm   система: http://localhost:8000 — через deploy\crm\poster.ps1
  site  сайт: http://localhost:5174 — в run сервер разработки с живой
        перезагрузкой, в start собранный сайт (npm run build + vite preview)

Если система ругается на политику выполнения:
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string] $Command = 'help',
    [Parameter(Position = 1)] [ValidateSet('all', 'crm', 'site')] [string] $What = 'all'
)

$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
$Crm = Join-Path $Repo 'deploy\crm\poster.ps1'
$SiteDir = Join-Path $Repo 'poster-website'
$SitePort = if ($env:POSTER_SITE_PORT) { $env:POSTER_SITE_PORT } else { '5174' }
$SitePid = Join-Path $SiteDir '.site.pid'
$SiteLog = Join-Path $SiteDir 'site.log'
# vite зовём напрямую, без npm: тогда pid — это сам сервер, и stop гасит его,
# а не обёртку npm, оставляя vite работать сиротой
$Vite = Join-Path $SiteDir 'node_modules\vite\bin\vite.js'

function Say([string] $text) { Write-Host $text }
function Die([string] $text) { Write-Host "Ошибка: $text" -ForegroundColor Red; exit 1 }

function Site-Deps {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'нет Node.js — поставьте Node 20+ (https://nodejs.org)' }
    if (-not (Test-Path (Join-Path $SiteDir 'node_modules'))) {
        Say 'Ставлю зависимости сайта (npm ci)…'
        Push-Location $SiteDir; try { npm ci --no-audit --no-fund } finally { Pop-Location }
    }
}

function Site-Alive {
    if (-not (Test-Path $SitePid)) { return $false }
    $id = Get-Content $SitePid -ErrorAction SilentlyContinue
    return [bool]($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue))
}

# процесс вместе с детьми: у python и node бывают дочерние процессы
function Stop-Tree([int] $id) { & taskkill.exe /T /F /PID $id 2>$null | Out-Null }

function Site-Run {
    Site-Deps
    Say "Сайт: http://localhost:$SitePort/ — Ctrl+C, чтобы остановить"
    Push-Location $SiteDir
    try { & node $Vite --port $SitePort --strictPort } finally { Pop-Location }
}

function Site-Start {
    if (Site-Alive) { Say "Сайт уже запущен (pid $(Get-Content $SitePid))"; return }
    Site-Deps
    Say 'Собираю сайт…'
    Push-Location $SiteDir; try { npm run build --silent | Out-Null } finally { Pop-Location }
    $p = Start-Process -FilePath node -ArgumentList @($Vite, 'preview', '--port', $SitePort, '--strictPort', '--host') `
        -WorkingDirectory $SiteDir -WindowStyle Hidden -RedirectStandardOutput $SiteLog `
        -RedirectStandardError "$SiteLog.err" -PassThru
    Set-Content -Path $SitePid -Value $p.Id
    foreach ($i in 1..20) {
        try { Invoke-WebRequest "http://127.0.0.1:$SitePort/" -UseBasicParsing -TimeoutSec 2 | Out-Null
              Say "Сайт: http://localhost:$SitePort/ (pid $($p.Id))"; return } catch { Start-Sleep -Milliseconds 500 }
    }
    Die "сайт не ответил — смотрите $SiteLog"
}

function Site-Stop {
    if (-not (Site-Alive)) { Say 'Сайт не запущен'; Remove-Item $SitePid -ErrorAction SilentlyContinue; return }
    Stop-Tree ([int](Get-Content $SitePid)); Remove-Item $SitePid -ErrorAction SilentlyContinue
    Say 'Сайт остановлен'
}

function Site-Status {
    if (Site-Alive) { Say "Сайт: запущен, pid $(Get-Content $SitePid), http://localhost:$SitePort/"; return $true }
    Say 'Сайт: не запущен'; return $false
}

function Crm([string] $cmd) { & $Crm $cmd; return ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) }

# run all: два процесса в этом окне, их вывод — здесь же. Ctrl+C или падение
# любого — гасим оба: полсистемы молча работать не должно.
function Run-All {
    Site-Deps
    $shell = (Get-Process -Id $PID).Path   # тот же PowerShell, что запущен сейчас
    $crm = Start-Process -FilePath $shell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Crm, 'run') -NoNewWindow -PassThru
    $site = Start-Process -FilePath node -ArgumentList @($Vite, '--port', $SitePort, '--strictPort') -WorkingDirectory $SiteDir -NoNewWindow -PassThru
    $crmPort = if ($env:POSTER_PORT) { $env:POSTER_PORT } else { '8000' }
    Say "Система: http://localhost:$crmPort/ · сайт: http://localhost:$SitePort/ — Ctrl+C, чтобы остановить оба"
    try {
        while (-not $crm.HasExited -and -not $site.HasExited) { Start-Sleep -Milliseconds 500 }
        Say 'Один из процессов завершился — останавливаю второй'
    } finally {
        foreach ($p in @($crm, $site)) { if (-not $p.HasExited) { Stop-Tree $p.Id } }
        Say 'Остановлены оба'
    }
}

switch ($Command) {
    'run' {
        switch ($What) { 'crm' { & $Crm run } 'site' { Site-Run } 'all' { Run-All } }
    }
    { $_ -in 'start', 'stop', 'status' } {
        $ok = $true
        if ($What -ne 'site') { if (-not (Crm $Command)) { $ok = $false } }
        if ($What -ne 'crm') {
            $r = switch ($Command) { 'start' { Site-Start; $true } 'stop' { Site-Stop; $true } 'status' { Site-Status } }
            if ($r -eq $false) { $ok = $false }
        }
        if (-not $ok) { exit 1 }
    }
    'logs' {
        switch ($What) {
            'crm' { & $Crm logs }
            'site' { if (-not (Test-Path $SiteLog)) { Die 'журнала сайта нет — он запускался только через run' }; Get-Content $SiteLog -Tail 100 -Wait }
            default { Die 'журнал чего: crm или site' }
        }
    }
    default { (Get-Content $PSCommandPath -TotalCount 20) | Select-Object -Skip 1 | Select-Object -SkipLast 1 }
}
