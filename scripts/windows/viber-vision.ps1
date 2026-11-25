# Знімок вікна Viber Desktop й OCR (Windows.Media.Ocr, без залежностей і без прав адміністратора). Знімається ЛИШЕ вікно Viber (PrintWindow із
# PW_RENDERFULLCONTENT, фокус вікна й видимість на екрані не потрібні), не весь екран. Відповідь — один рядок JSON.
#   ocr    -Rects "x,y,w,h;x,y,w,h"  (екранні фізичні координати з viber-uia.ps1 geometry)  -Langs "ru-RU,en-US"  [-Scale 3]
#          для кожної смуги — розпізнаний текст усіма мовами й обома варіантами (як є й інвертований: темна тема дає світлий текст на темному)
#   shot   -Out файл.png  [-Rects одна смуга]   зберегти знімок вікна (чи смуги) у файл, напр. для теки збоїв
# Українського пакета OCR у Windows немає: назви чатів читаються ru-RU (кирилиця) і en-US (латиниця), порівняння — нечітке (lib/ocr-name-match.mjs).
param(
    [Parameter(Mandatory = $true)][ValidateSet('ocr', 'shot', 'langs')][string]$Command,
    [string]$Rects = '',
    [string]$Langs = 'ru-RU,en-US',
    [int]$Scale = 3,
    [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Runtime.WindowsRuntime
Add-Type @'
using System; using System.Runtime.InteropServices;
public class VV {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  public struct RECT { public int L, T, R, B; }
}
'@
[void][VV]::SetProcessDPIAware()
function Reply($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 8)); exit 0 }

[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataWriter, Windows.Foundation, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($operation, $resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    [void]$task.Wait(-1)
    return $task.Result
}

if ($Command -eq 'langs') {
    $available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
    Reply @{ ok = $true; available = $available }
}

# Вікно Viber: дескриптор головного вікна (як у viber-uia.ps1). Згорнуте вікно знімком не відновлюємо (це робить viber-uia.ps1 window restore).
$proc = Get-Process -Name Viber -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Reply @{ ok = $false; reason = 'viber_desktop_not_running' } }
$AE = [System.Windows.Automation.AutomationElement]
$win = $AE::FromHandle($proc.MainWindowHandle)
if (-not $win -or $win.Current.ClassName -notlike 'MainWindow_*') { Reply @{ ok = $false; reason = 'viber_desktop_window_missing' } }
$hwnd = [IntPtr]$win.Current.NativeWindowHandle
if ([VV]::IsIconic($hwnd)) { Reply @{ ok = $false; reason = 'viber_desktop_minimized' } }

$wr = New-Object VV+RECT
[void][VV]::GetWindowRect($hwnd, [ref]$wr)
$width = $wr.R - $wr.L
$height = $wr.B - $wr.T
$full = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($full)
$hdc = $g.GetHdc()
[void][VV]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()

function Crop([int]$x, [int]$y, [int]$w, [int]$h) {
    $left = [Math]::Max(0, $x - $wr.L)
    $top = [Math]::Max(0, $y - $wr.T)
    $w = [Math]::Min($w, $width - $left)
    $h = [Math]::Min($h, $height - $top)
    if ($w -le 1 -or $h -le 1) { return $null }
    return $full.Clone((New-Object System.Drawing.Rectangle $left, $top, $w, $h), $full.PixelFormat)
}

# Підготовка до OCR: збільшення (бікубічне), поля навколо, у відтінках сірого; інвертований варіант — для світлого тексту на темному тлі.
function Prepare([System.Drawing.Bitmap]$src, [bool]$invert) {
    $pad = 24
    $w = $src.Width * $Scale + 2 * $pad
    $h = $src.Height * $Scale + 2 * $pad
    $dst = New-Object System.Drawing.Bitmap $w, $h
    $gg = [System.Drawing.Graphics]::FromImage($dst)
    $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # Фон полів — середній колір кута знімка (тло смуги), щоб рамка не різала літери.
    $bg = $src.GetPixel(1, 1)
    $gg.Clear($bg)
    # Матриця кольору: сірий (0.299/0.587/0.114), для інвертованого варіанта з протилежним знаком і зсувом на 1.
    $sign = if ($invert) { -1 } else { 1 }
    $shift = if ($invert) { 1 } else { 0 }
    $rows = New-Object 'single[][]' 5
    $rows[0] = [single[]]@((0.299 * $sign), (0.299 * $sign), (0.299 * $sign), 0, 0)
    $rows[1] = [single[]]@((0.587 * $sign), (0.587 * $sign), (0.587 * $sign), 0, 0)
    $rows[2] = [single[]]@((0.114 * $sign), (0.114 * $sign), (0.114 * $sign), 0, 0)
    $rows[3] = [single[]]@(0, 0, 0, 1, 0)
    $rows[4] = [single[]]@($shift, $shift, $shift, 0, 1)
    $m = New-Object System.Drawing.Imaging.ColorMatrix (,$rows)
    $attrs = New-Object System.Drawing.Imaging.ImageAttributes
    $attrs.SetColorMatrix($m)
    $gg.DrawImage($src, (New-Object System.Drawing.Rectangle $pad, $pad, ($src.Width * $Scale), ($src.Height * $Scale)), 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
    $gg.Dispose()
    return $dst
}

function ToSoftwareBitmap([System.Drawing.Bitmap]$bitmap) {
    $ms = New-Object System.IO.MemoryStream
    $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter $ras
    $writer.WriteBytes($ms.ToArray())
    [void](Await ($writer.StoreAsync()) ([uint32]))
    $ras.Seek(0)
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    return Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
}

$engines = @{}
foreach ($tag in ($Langs -split ',')) {
    $tag = $tag.Trim()
    if (-not $tag) { continue }
    $lang = New-Object Windows.Globalization.Language $tag
    if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) { $engines[$tag] = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang) }
}

$rectList = @()
foreach ($part in ($Rects -split ';')) {
    if (-not $part.Trim()) { continue }
    $n = $part.Split(',') | ForEach-Object { [int]$_ }
    $rectList += , @($n[0], $n[1], $n[2], $n[3])
}

if ($Command -eq 'shot') {
    if (-not $Out) { Reply @{ ok = $false; reason = 'out_required' } }
    $bmp = if ($rectList.Count -gt 0) { Crop $rectList[0][0] $rectList[0][1] $rectList[0][2] $rectList[0][3] } else { $full }
    if (-not $bmp) { Reply @{ ok = $false; reason = 'rect_outside_window' } }
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    Reply @{ ok = $true; width = $bmp.Width; height = $bmp.Height }
}

if ($engines.Count -eq 0) { Reply @{ ok = $false; reason = 'viber_ocr_unavailable'; detail = 'немає жодної з мов OCR: ' + $Langs } }

$results = @()
foreach ($r in $rectList) {
    $crop = Crop $r[0] $r[1] $r[2] $r[3]
    if (-not $crop) { $results += @{ rect = $r; texts = @() }; continue }
    $texts = @()
    foreach ($invert in @($false, $true)) {
        $prepared = Prepare $crop $invert
        $soft = ToSoftwareBitmap $prepared
        foreach ($tag in $engines.Keys) {
            $result = Await ($engines[$tag].RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
            $lines = @($result.Lines | ForEach-Object { $_.Text })
            $texts += @{ lang = $tag; inverted = $invert; text = (($lines -join "`n").Trim()); lines = $lines }
        }
        $prepared.Dispose()
    }
    $results += @{ rect = $r; texts = $texts }
}
Reply @{ ok = $true; scale = $Scale; results = $results }
