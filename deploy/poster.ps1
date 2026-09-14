<#
Управление сервером ПОСТЕР на Windows одной командой (PowerShell 5.1 или 7).

  deploy\poster.ps1 run                 в текущем окне (Ctrl+C — стоп)
  deploy\poster.ps1 start|stop|restart  в фоне, скрытым окном (pid в logs\poster.pid)
  deploy\poster.ps1 status              жив ли процесс и отвечает ли /health
  deploy\poster.ps1 logs [N]            последние N строк журнала и дальше вживую
  deploy\poster.ps1 health              0 — отвечает, 1 — нет
  deploy\poster.ps1 watchdog            поднять, если не отвечает (для планировщика)
  deploy\poster.ps1 install-autostart   задача планировщика: старт при включении
                                        компьютера ещё до входа в Windows, перезапуск
                                        после сбоя, сторож раз в минуту, без сна
  deploy\poster.ps1 remove-autostart    убрать задачи планировщика
  deploy\poster.ps1 update              git pull, зависимости, перезапуск
  deploy\poster.ps1 backup              копия базы прямо сейчас

Запуск: из PowerShell «от имени администратора» для install-autostart, остальное
от обычного пользователя. Если система ругается на политику выполнения:
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

Адрес и порт — переменные POSTER_HOST и POSTER_PORT в .env (по умолчанию
0.0.0.0 и 8000).
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string] $Command = 'help',
    [Parameter(Position = 1)] [string] $Arg = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Py = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path $Py)) { $Py = '' }

function Env-Value([string] $name) {
    if (-not (Test-Path .env)) { return '' }
    $line = Get-Content .env | Where-Object { $_ -match "^$name=" } | Select-Object -Last 1
    if ($line) { return ($line -replace "^$name=", '').Trim() }
    return ''
}
$HostAddr = if ($env:POSTER_HOST) { $env:POSTER_HOST } elseif (Env-Value 'POSTER_HOST') { Env-Value 'POSTER_HOST' } else { '0.0.0.0' }
$Port = if ($env:POSTER_PORT) { $env:POSTER_PORT } elseif (Env-Value 'POSTER_PORT') { Env-Value 'POSTER_PORT' } else { '8000' }
$Health = "http://127.0.0.1:$Port/health"
$PidFile = Join-Path $Root 'logs\poster.pid'
# метка «остановлен намеренно»: пока она есть, сторож не поднимает сервер
$StopMark = Join-Path $Root 'logs\poster.stopped'
$OutFile = Join-Path $Root 'logs\uvicorn.out'
$TaskName = 'POSTER server'
$WatchdogTask = 'POSTER watchdog'
$UvicornArgs = @('-m', 'uvicorn', 'app.main:app', '--host', $HostAddr, '--port', $Port, '--workers', '1')

function Need-Venv { if (-not $Py) { throw 'нет окружения .venv: python -m venv .venv; .venv\Scripts\pip install -r requirements.txt' } }

function Health-Ok {
    try { $r = Invoke-WebRequest -Uri $Health -UseBasicParsing -TimeoutSec 5; return $r.StatusCode -eq 200 }
    catch { return $false }
}
function Wait-Health {
    for ($i = 0; $i -lt 30; $i++) { if (Health-Ok) { return $true }; Start-Sleep -Seconds 1 }
    return $false
}
function Pid-Alive {
    if (-not (Test-Path $PidFile)) { return $null }
    $id = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $id) { return $null }
    $p = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
    if ($p) { return $p } else { return $null }
}
function Task-Exists([string] $name) { return [bool](Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) }
function Is-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------------------------------------------------------------- команды
function Cmd-Run {
    Need-Venv
    Write-Host "Сервер на http://${HostAddr}:$Port/ — Ctrl+C, чтобы остановить"
    & $Py @UvicornArgs
}

function Cmd-Start {
    Need-Venv
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null
    Remove-Item $StopMark -ErrorAction SilentlyContinue
    if ((Task-Exists $TaskName) -and (Get-ScheduledTask -TaskName $TaskName).State -eq 'Running') {
        Write-Host 'Работает как задача планировщика'; return
    }
    if (Task-Exists $TaskName) { Start-ScheduledTask -TaskName $TaskName; if (Wait-Health) { Write-Host "Запущен задачей планировщика: http://${HostAddr}:$Port/" } else { throw "задача не ответила на $Health" }; return }
    if (Pid-Alive) { Write-Host "Уже запущен (pid $(Get-Content $PidFile))"; return }
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null
    $p = Start-Process -FilePath $Py -ArgumentList $UvicornArgs -WorkingDirectory $Root -WindowStyle Hidden `
        -RedirectStandardOutput $OutFile -RedirectStandardError (Join-Path $Root 'logs\uvicorn.err') -PassThru
    Set-Content -Path $PidFile -Value $p.Id
    if (Wait-Health) { Write-Host "Запущен: pid $($p.Id), http://${HostAddr}:$Port/" }
    else { throw "процесс не ответил на $Health за 30 с — смотрите $OutFile" }
}

function Cmd-Stop {
    # метка ставится первой: иначе сторож поднимет сервер через минуту
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null
    Set-Content -Path $StopMark -Value (Get-Date)
    if (Task-Exists $TaskName) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    $p = Pid-Alive
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Write-Host 'Остановлен' }
    elseif (-not (Task-Exists $TaskName)) { Write-Host 'Не запущен' }
    else { Write-Host 'Задача остановлена' }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Cmd-Status {
    if (Test-Path $StopMark) { Write-Host 'Остановлен намеренно (poster.ps1 stop) — сторож не вмешивается' }
    if (Task-Exists $TaskName) {
        $t = Get-ScheduledTask -TaskName $TaskName
        Write-Host "Задача планировщика: $($t.State); сторож: $(if (Task-Exists $WatchdogTask) { 'есть' } else { 'нет' })"
    } elseif (Pid-Alive) { Write-Host "Фоновый процесс: pid $(Get-Content $PidFile)" }
    else { Write-Host 'Процесс не запущен' }
    if (Health-Ok) { Write-Host "Отвечает: $Health" } else { Write-Host "Не отвечает: $Health"; exit 1 }
}

function Cmd-Logs {
    $n = if ($Arg) { [int]$Arg } else { 100 }
    $log = Join-Path $Root 'logs\poster.log'
    if (-not (Test-Path $log)) { throw 'журнала ещё нет — сервер не запускался' }
    Get-Content $log -Tail $n -Wait
}

function Cmd-Watchdog {
    if (Test-Path $StopMark) { return }   # остановили намеренно
    if (Health-Ok) { return }
    $stamp = Get-Date -Format 'dd.MM HH:mm'
    if (Task-Exists $TaskName) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "$stamp сторож: задача перезапущена"
    } else {
        Cmd-Stop | Out-Null
        Cmd-Start | Out-Null
        Write-Host "$stamp сторож: процесс поднят заново"
    }
}

function Cmd-InstallAutostart {
    if (-not (Is-Admin)) { throw 'нужны права администратора: откройте PowerShell от имени администратора' }
    Need-Venv
    # Задача от SYSTEM: стартует при включении компьютера, до входа любого
    # пользователя, и не зависит от того, кто сидит за машиной. Без предела
    # по времени, перезапуск после сбоя раз в минуту, сколько угодно раз.
    $action = New-ScheduledTaskAction -Execute $Py -Argument ($UvicornArgs -join ' ') -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT20S'
    $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

    # сторож: раз в минуту спрашивает /health и перезапускает задачу, если тишина
    $wdAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.PSCommandPath)`" watchdog" -WorkingDirectory $Root
    $wdTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $wdSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew -StartWhenAvailable
    Register-ScheduledTask -TaskName $WatchdogTask -Action $wdAction -Trigger $wdTrigger -Settings $wdSettings -Principal $principal -Force | Out-Null

    # компьютер не должен засыпать и выключать диск
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change hibernate-timeout-ac 0 | Out-Null
    powercfg /change disk-timeout-ac 0 | Out-Null

    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Задачи «$TaskName» и «$WatchdogTask» созданы: автозапуск при включении, перезапуск после сбоя, без сна."
    if (Wait-Health) { Write-Host "Отвечает: $Health" } else { Write-Host "Пока не отвечает — смотрите logs\uvicorn.err и logs\poster.log" }
    Write-Host 'Не забудьте в BIOS: Restore on AC Power Loss → Power On, чтобы компьютер включался после отключения света.'
}

function Cmd-RemoveAutostart {
    if (-not (Is-Admin)) { throw 'нужны права администратора' }
    foreach ($name in @($TaskName, $WatchdogTask)) {
        if (Task-Exists $name) { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $name -Confirm:$false }
    }
    Write-Host 'Задачи планировщика удалены'
}

function Cmd-Update {
    Need-Venv
    git pull --ff-only
    & $Py -m pip install -q -r requirements.txt
    if ((Task-Exists $TaskName) -or (Pid-Alive)) { Cmd-Stop; Cmd-Start } else { Write-Host 'Обновлено; сервер не был запущен' }
}

function Cmd-Backup { Need-Venv; & $Py -m scripts.backup }

function Cmd-Help { (Get-Content $MyInvocation.PSCommandPath -TotalCount 24) | Select-Object -Skip 1 | Select-Object -SkipLast 1 }

switch ($Command) {
    'run' { Cmd-Run }
    'start' { Cmd-Start }
    'stop' { Cmd-Stop }
    'restart' { Cmd-Stop; Cmd-Start }
    'status' { Cmd-Status }
    'logs' { Cmd-Logs }
    'health' { if (Health-Ok) { Write-Host 'ok' } else { Write-Host 'нет ответа'; exit 1 } }
    'watchdog' { Cmd-Watchdog }
    'install-autostart' { Cmd-InstallAutostart }
    'remove-autostart' { Cmd-RemoveAutostart }
    'update' { Cmd-Update }
    'backup' { Cmd-Backup }
    default { Cmd-Help }
}
