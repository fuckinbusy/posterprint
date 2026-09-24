<#
.SYNOPSIS
    Конвертер макетов CorelDRAW новых версий в .cdr версии 16 (CorelDRAW X6).

.DESCRIPTION
    Формат .cdr закрытый: записать его умеет только сам CorelDRAW. Поэтому
    конвертер работает в два шага и запускается на компьютере, где стоит
    лицензионный CorelDRAW X6:

      1. новый .cdr разбирается открытой библиотекой libcdr (она внутри
         Inkscape) и превращается в SVG в натуральную величину;
      2. CorelDRAW X6 управляется через автоматизацию (COM): создаёт документ
         с тем же размером страницы, импортирует SVG, ставит макет на место
         и сохраняет — получается настоящий .cdr версии 16, записанный самим
         CorelDRAW.

    Что нужно на этом компьютере:
      * CorelDRAW X6 (или новее — сохранит всё равно в версию 16);
      * Inkscape (бесплатный, inkscape.org) — чтобы читать новые .cdr.
        Без него скрипт принимает готовые .svg: их отдаёт кнопка «SVG» в окне
        просмотра макета в ПОСТЕРе.

    Чтобы макет встал точно на своё место и в свой размер, в SVG на время
    добавляется тонкая рамка по границе страницы: по ней импортированное
    выравнивается и масштабируется, после чего рамка удаляется.

    Ограничения те же, что у просмотра макета: кривые, заливки и размеры
    переносятся точно; текст, не переведённый в кривые, — приблизительно
    (шрифт должен стоять на компьютере); эффекты CorelDRAW (тени, линзы,
    PowerClip) и часть растровых вставок могут потеряться. Сверяйтесь с
    эскизом и просите у клиентов макеты в кривых.

.PARAMETER Path
    Файлы .cdr / .svg или папки с ними.

.PARAMETER Out
    Куда класть результат. По умолчанию — рядом с исходником, с хвостом «_v16».

.PARAMETER Force
    Конвертировать и те .cdr, что уже версии 16 или старше (обычно пропускаются).

.PARAMETER Info
    Только показать версии файлов, ничего не конвертировать.

.PARAMETER PrepareOnly
    Остановиться после первого шага: положить рядом подготовленные SVG и не
    трогать CorelDRAW. Годится для проверки и для компьютера без CorelDRAW.

.PARAMETER KeepSvg
    Не удалять промежуточные SVG.

.PARAMETER Visible
    Показывать окно CorelDRAW во время работы (удобно, если что-то идёт не так).

.EXAMPLE
    .\cdr_to_v16.ps1 "C:\Макеты\от клиента.cdr"

.EXAMPLE
    .\cdr_to_v16.ps1 C:\Макеты\входящие -Out C:\Макеты\v16

.EXAMPLE
    .\cdr_to_v16.ps1 C:\Макеты -Info
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Path,
    [string]$Out = '',
    [switch]$Force,
    [switch]$Info,
    [switch]$PrepareOnly,
    [switch]$KeepSvg,
    [switch]$Visible
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$TargetVersion = 16
$FrameId = 'poster-page-frame'
$VersionNames = @{
    13 = 'X3'; 14 = 'X4'; 15 = 'X5'; 16 = 'X6'; 17 = 'X7'; 18 = 'X8'; 19 = '2017'; 20 = '2018'
    21 = '2019'; 22 = '2020'; 23 = '2021'; 24 = '2022'; 25 = '2023'; 26 = '2024'; 27 = '2025'
}

# ---------------------------------------------------------------- версия .cdr
function Get-CdrVersion([string]$file) {
    # Заголовок «RIFF....CDRx»: x — цифра (4–9) или буква (A = 10, G = 16, R = 27).
    # У файлов X4 и новее он лежит внутри zip, в content/root.dat.
    $head = New-Object byte[] 16
    $stream = [System.IO.File]::OpenRead($file)
    try { [void]$stream.Read($head, 0, 16) } finally { $stream.Dispose() }

    if ($head[0] -eq 0x50 -and $head[1] -eq 0x4B) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($file)
        try {
            $entry = $zip.Entries | Where-Object { $_.FullName -match '^content/(root\.dat|riffData\.cdr)$' } | Select-Object -First 1
            if (-not $entry) { return $null }
            $inner = $entry.Open()
            try { [void]$inner.Read($head, 0, 16) } finally { $inner.Dispose() }
        } finally { $zip.Dispose() }
    }
    if ([System.Text.Encoding]::ASCII.GetString($head, 0, 4) -ne 'RIFF') { return $null }
    if ([System.Text.Encoding]::ASCII.GetString($head, 8, 3).ToUpper() -ne 'CDR') { return $null }
    $mark = [char]$head[11]
    if ($mark -ge '0' -and $mark -le '9') { return [int]([string]$mark) }
    if ($mark -ge 'A' -and $mark -le 'Z') { return ([int][char]$mark) - 65 + 10 }
    return $null
}

function Format-Version($number) {
    if ($null -eq $number) { return 'версия не распознана' }
    $name = $VersionNames[[int]$number]
    if (-not $name) { $name = [string]$number }
    return "CorelDRAW $name (версия $number)"
}

# ---------------------------------------------------------------- Inkscape
function Find-Inkscape {
    if ($env:POSTER_INKSCAPE -and (Test-Path $env:POSTER_INKSCAPE)) { return $env:POSTER_INKSCAPE }
    $cmd = Get-Command inkscape -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($guess in @(
            "$env:ProgramFiles\Inkscape\bin\inkscape.exe",
            "${env:ProgramFiles(x86)}\Inkscape\bin\inkscape.exe",
            "$env:LOCALAPPDATA\Programs\Inkscape\bin\inkscape.exe")) {
        if ($guess -and (Test-Path $guess)) { return $guess }
    }
    return $null
}

function Convert-CdrToSvg([string]$inkscape, [string]$cdr, [string]$svg) {
    # Inkscape на Windows спотыкается о кириллицу в пути — отдаём ему копию с простым именем
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("poster-cdr-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        $src = Join-Path $tmp 'design.cdr'
        $dst = Join-Path $tmp 'design.svg'
        Copy-Item -LiteralPath $cdr -Destination $src
        & $inkscape $src '--export-type=svg' '--export-plain-svg' "--export-filename=$dst" 2>$null | Out-Null
        if (-not (Test-Path $dst)) { throw 'Inkscape не смог прочитать файл — возможно, эта версия CorelDRAW ему незнакома' }
        Copy-Item -LiteralPath $dst -Destination $svg -Force
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------- подготовка SVG
function ConvertTo-Millimeters([string]$value, [double]$fallbackUnits) {
    # «210mm», «8.2677in», «595.27» (единицы страницы = пункты у libcdr)
    if ($value -match '^\s*([0-9.]+)\s*(mm|cm|in|pt|px)?\s*$') {
        $n = [double]::Parse($Matches[1], [System.Globalization.CultureInfo]::InvariantCulture)
        switch ($Matches[2]) {
            'mm' { return $n }
            'cm' { return $n * 10 }
            'in' { return $n * 25.4 }
            'px' { return $n * 25.4 / 96 }
            default { return $n * 25.4 / 72 }
        }
    }
    return $fallbackUnits * 25.4 / 72
}

function Add-PageFrame([string]$svgFile) {
    # Возвращает размер страницы в мм. Рамка по границе страницы нужна, чтобы
    # после импорта макет можно было поставить на место и привести к размеру
    # без догадок о том, как CorelDRAW понял единицы SVG.
    $xml = New-Object System.Xml.XmlDocument
    $xml.PreserveWhitespace = $true
    $xml.XmlResolver = $null
    $xml.Load($svgFile)
    $root = $xml.DocumentElement
    if ($root.LocalName -ne 'svg') { throw 'это не SVG' }

    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    $box = @()
    if ($root.GetAttribute('viewBox')) {
        $box = @($root.GetAttribute('viewBox') -split '[\s,]+' | Where-Object { $_ } | ForEach-Object { [double]::Parse($_, $inv) })
    }
    if ($box.Count -ne 4) {
        $w = ConvertTo-Millimeters $root.GetAttribute('width') 0
        $h = ConvertTo-Millimeters $root.GetAttribute('height') 0
        if ($w -le 0 -or $h -le 0) { throw 'в SVG нет ни viewBox, ни размеров страницы' }
        $box = @(0.0, 0.0, ($w * 72 / 25.4), ($h * 72 / 25.4))
        $root.SetAttribute('viewBox', ('0 0 {0} {1}' -f $box[2].ToString($inv), $box[3].ToString($inv)))
    }
    $widthMm = ConvertTo-Millimeters $root.GetAttribute('width') $box[2]
    $heightMm = ConvertTo-Millimeters $root.GetAttribute('height') $box[3]

    $ns = 'http://www.w3.org/2000/svg'
    $old = $root.SelectSingleNode("//*[@id='$FrameId']")
    if ($old) { [void]$old.ParentNode.RemoveChild($old) }
    $frame = $xml.CreateElement('rect', $ns)
    $frame.SetAttribute('id', $FrameId)
    $frame.SetAttribute('x', $box[0].ToString($inv))
    $frame.SetAttribute('y', $box[1].ToString($inv))
    $frame.SetAttribute('width', $box[2].ToString($inv))
    $frame.SetAttribute('height', $box[3].ToString($inv))
    $frame.SetAttribute('fill', 'none')
    $frame.SetAttribute('stroke', '#ff00ff')
    $frame.SetAttribute('stroke-width', ($box[2] / 20000).ToString($inv))
    [void]$root.AppendChild($frame)

    $root.SetAttribute('width', ($widthMm.ToString('0.##', $inv) + 'mm'))
    $root.SetAttribute('height', ($heightMm.ToString('0.##', $inv) + 'mm'))
    $xml.Save($svgFile)
    return @{ Width = $widthMm; Height = $heightMm }
}

# ---------------------------------------------------------------- CorelDRAW
function Start-Corel {
    foreach ($progId in @('CorelDRAW.Application.16', 'CorelDRAW.Application')) {
        try {
            $app = New-Object -ComObject $progId
            if ($app) { return $app }
        } catch { }
    }
    throw 'CorelDRAW не найден: автоматизация (COM) не отвечает. Скрипт нужно запускать на компьютере с установленным CorelDRAW X6.'
}

function Find-Frame($shapes, [double]$w, [double]$h) {
    # рамку ищем по имени (CorelDRAW берёт его из id в SVG), а не нашлась —
    # по приметам: размер со страницу, без заливки; заглядываем и в группы
    foreach ($shape in $shapes) {
        $isFrame = $false
        try { if ($shape.Name -eq $FrameId) { $isFrame = $true } } catch { }
        if (-not $isFrame) {
            try {
                if ([math]::Abs($shape.SizeWidth - $w) -lt 0.2 -and [math]::Abs($shape.SizeHeight - $h) -lt 0.2 -and
                    $shape.Type -ne 7 -and $shape.Fill.Type -eq 0) { $isFrame = $true }   # 7 = группа, 0 = без заливки
            } catch { }
        }
        if ($isFrame) { return $shape }
        try {
            if ($shape.Type -eq 7) {
                $inner = Find-Frame $shape.Shapes $w $h
                if ($inner) { return $inner }
            }
        } catch { }
    }
    return $null
}

function Save-AsCdr16($app, [string]$svg, [string]$target, $size) {
    $cdrMillimeter = 3
    $cdrCenter = 9
    $doc = $app.CreateDocument()
    try {
        $doc.Unit = $cdrMillimeter
        $doc.ReferencePoint = $cdrCenter
        $page = $doc.ActivePage
        $page.SetSize($size.Width, $size.Height)

        $doc.ActiveLayer.Import($svg)
        $range = $doc.SelectionRange
        if ($range.Count -eq 0) { throw 'CorelDRAW ничего не импортировал из SVG' }

        # рамка совпадает со страницей, значит всё импортированное вместе — тоже:
        # приводим к размеру страницы и ставим по центру
        $range.SetSize($size.Width, $size.Height)
        $range.SetPosition($page.CenterX, $page.CenterY)

        $frame = Find-Frame $range $size.Width $size.Height
        $note = ''
        if ($frame) { $frame.Delete() } else { $note = ' (служебную рамку по краю страницы найти не удалось — удалите её вручную)' }

        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
        $options = $null
        try {
            $options = $app.CreateStructSaveAsOptions()
            $options.Version = $TargetVersion      # cdrVersion16
            $options.Overwrite = $true
        } catch { $options = $null }
        if ($options) { $doc.SaveAs($target, $options) } else { $doc.SaveAs($target) }
        return $note
    } finally {
        try { $doc.Dirty = $false } catch { }
        try { $doc.Close() } catch { }
    }
}

# ---------------------------------------------------------------- работа
$files = @()
foreach ($item in $Path) {
    if (Test-Path -LiteralPath $item -PathType Container) {
        $files += Get-ChildItem -LiteralPath $item -Recurse -File | Where-Object { $_.Extension -match '^\.(cdr|svg)$' -and $_.BaseName -notmatch '_v16$' }
    } elseif (Test-Path -LiteralPath $item) {
        $files += Get-Item -LiteralPath $item
    } else {
        Write-Warning "нет такого файла: $item"
    }
}
if (-not $files) { Write-Host 'Файлов .cdr или .svg не найдено'; exit 1 }

if ($Info) {
    foreach ($file in $files) {
        if ($file.Extension -ieq '.cdr') { Write-Host ("  {0} — {1}" -f $file.Name, (Format-Version (Get-CdrVersion $file.FullName))) }
    }
    exit 0
}

$inkscape = Find-Inkscape
$app = $null
$failed = 0
$done = 0

try {
    foreach ($file in $files) {
        $isCdr = $file.Extension -ieq '.cdr'
        $label = ''
        if ($isCdr) {
            $version = Get-CdrVersion $file.FullName
            $label = Format-Version $version
            if (-not $Force -and $null -ne $version -and $version -le $TargetVersion) {
                Write-Host ("  пропуск   {0} — {1}: CorelDRAW X6 откроет его сам" -f $file.Name, $label)
                continue
            }
            if (-not $inkscape) {
                Write-Warning ("{0} — {1}: для чтения новых .cdr нужен Inkscape (inkscape.org). Без него дайте скрипту .svg из окна просмотра макета." -f $file.Name, $label)
                $failed++
                continue
            }
        }

        $targetDir = if ($Out) { $Out } else { $file.DirectoryName }
        if (-not (Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
        $target = Join-Path $targetDir ($file.BaseName + '_v16.cdr')
        $svg = Join-Path $targetDir ($file.BaseName + '_v16.svg')

        try {
            if ($isCdr) { Convert-CdrToSvg $inkscape $file.FullName $svg } else { Copy-Item -LiteralPath $file.FullName -Destination $svg -Force }
            $size = Add-PageFrame $svg
            if ($PrepareOnly) {
                Write-Host ("  подготовлен {0} → {1} ({2:0.##} × {3:0.##} мм)" -f $file.Name, (Split-Path $svg -Leaf), $size.Width, $size.Height)
                $done++
                continue
            }
            if (-not $app) {
                $app = Start-Corel
                if ($Visible) { try { $app.Visible = $true } catch { } }
            }
            $note = Save-AsCdr16 $app $svg $target $size
            Write-Host ("  готово    {0}{1} → {2} ({3:0.##} × {4:0.##} мм){5}" -f $file.Name, $(if ($label) { " — $label" } else { '' }), (Split-Path $target -Leaf), $size.Width, $size.Height, $note)
            $done++
        } catch {
            $failed++
            Write-Warning ("{0}: {1}" -f $file.Name, $_.Exception.Message)
        } finally {
            if (-not $KeepSvg -and -not $PrepareOnly -and (Test-Path -LiteralPath $svg)) { Remove-Item -LiteralPath $svg -Force -ErrorAction SilentlyContinue }
        }
    }
} finally {
    # CorelDRAW, который запустили мы сами и не показывали, за собой закрываем
    if ($app -and -not $Visible) { try { if ($app.Documents.Count -eq 0) { $app.Quit() } } catch { } }
}

Write-Host ("Итого: сконвертировано {0}, с ошибкой {1}" -f $done, $failed)
if ($failed) { exit 1 }
