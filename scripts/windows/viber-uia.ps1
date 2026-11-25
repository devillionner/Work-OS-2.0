# Viber Desktop (Qt6/QML) через UI Automation: один виклик — одна команда, відповідь — один рядок JSON (Windows PowerShell 5.1, без прав адміністратора).
#   status          чи запущено, які діалоги відкриті, чи відкрита розмова, скільки символів у полі повідомлення
#   info            версія Viber Desktop і збірка Windows (відбиток середовища)
#   window          стан вікна (-Button state|restore|minimize): згорнуте вікно відновлюється без активації й без фокусу
#   geometry        екранні координати (фізичні пікселі): вікно, розмова, шапка (смуга назви чату), поле повідомлення, рядки списку чатів
#   messages        тексти повідомлень, видимих у стрічці відкритої розмови (UIA віддає повний текст; Y і X потрібні, щоб знайти останнє)
#   set-text/clear  записати/очистити поле повідомлення (ValuePattern, фокус вікна не потрібен); текст у Base64 (UTF-8)
#   send            натиснути «Надіслати», але ЛИШЕ коли в полі рівно очікуваний текст (-ExpectBase64)
#   search          записати текст у поле пошуку (-TextBase64); search-clear — очистити
#   open-row        відкрити чат зі списку ліворуч (-Index порядковий номер видимого рядка, -Y очікуване положення: рядок має лишитись на місці)
#   attach          натиснути «+» (діалог «Send a file» відкривається окремим вікном: далі viber-dialog.ps1)
#   preview         стан вікна перегляду фото (підпис, кнопки, межі); preview-caption записує підпис, preview-send надсилає (лише з тим самим підписом),
#                   preview-close закриває перегляд без відправки
#   scroll-bottom   кнопка «до кінця стрічки»; wheel — прокрутка стрічки колесом (-Index дельта у «клацаннях», додатне — вгору)
#   dismiss         натиснути кнопку діалогу чи рекламної панелі за назвою (-Button, за замовчуванням OK)
# Важливо: Viber НЕ віддає через UIA назву чату (ні в шапці, ні в списку, ні в перегляді фото): ця команда нічого не знає про те, який чат відкрито.
# Тому вона не вирішує, КУДИ писати; запобіжник «це саме потрібний чат» (OCR шапки) мусить бути окремим і до `send`/`preview-send`.
param(
    [Parameter(Mandatory = $true)][ValidateSet('status', 'info', 'window', 'geometry', 'messages', 'set-text', 'clear', 'send', 'search', 'search-clear', 'open-row', 'attach', 'preview', 'preview-caption', 'preview-send', 'preview-close', 'scroll-bottom', 'wheel', 'dismiss')][string]$Command,
    [string]$TextBase64 = '',
    [string]$ExpectBase64 = '',
    [string]$Button = 'OK',
    [int]$Index = -1,
    [int]$Y = -1
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public class VU {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
}
'@
[void][VU]::SetProcessDPIAware()
# Контроль фокусу: команди, що щось змінюють у Viber, не мають забирати активне вікно в людини (Viber може бути на іншому робочому столі, і Windows
# перемкне екран). Активне вікно до дії порівнюється з активним після неї; зміну віддаємо у відповіді (focusStolen), і адаптер зупиняється.
$fgBefore = [VU]::GetForegroundWindow()
$mutating = @('set-text', 'clear', 'send', 'search', 'search-clear', 'open-row', 'attach', 'preview-caption', 'preview-send', 'preview-close', 'scroll-bottom', 'wheel', 'dismiss') -contains $Command
$AE = [System.Windows.Automation.AutomationElement]
$Walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Reply($value) {
    if ($script:mutating -and $value -is [hashtable]) {
        $fgAfter = [VU]::GetForegroundWindow()
        if ($fgAfter -ne $script:fgBefore -and $script:hwnd -and $fgAfter -eq $script:hwnd) { $value['focusStolen'] = $true }
    }
    [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 8)); exit 0
}
function FromB64([string]$value) { if (-not $value) { return '' } return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value)) }

$proc = Get-Process -Name Viber -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Reply @{ ok = $false; reason = 'viber_desktop_not_running' } }

# Головне вікно: пошук серед вікон процесу надійний не завжди, тому запасний шлях — дескриптор головного вікна.
$win = $null
try {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $proc.Id)
    foreach ($w in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) { if ($w.Current.ClassName -like 'MainWindow_*') { $win = $w } }
} catch { }
if (-not $win) { $win = $AE::FromHandle($proc.MainWindowHandle) }
if (-not $win -or $win.Current.ClassName -notlike 'MainWindow_*') { Reply @{ ok = $false; reason = 'viber_desktop_window_missing' } }
$hwnd = [IntPtr]$win.Current.NativeWindowHandle

if ($Command -eq 'window') {
    $iconic = [VU]::IsIconic($hwnd)
    if ($Button -eq 'restore' -and $iconic) { [void][VU]::ShowWindow($hwnd, 4); Start-Sleep -Milliseconds 700 }   # SW_SHOWNOACTIVATE: відновити без активації
    if ($Button -eq 'minimize' -and -not $iconic) { [void][VU]::ShowWindow($hwnd, 7) }                            # SW_SHOWMINNOACTIVE
    Reply @{ ok = $true; iconic = [bool]$iconic; zoomed = [bool][VU]::IsZoomed($hwnd) }
}

# Обхід у ширину (від вікна донизу) з лімітом вузлів: Qt повторює елементи в піддеревах списку чатів і рекламного вебвікна з різними RuntimeId,
# тож обхід у глибину вичерпував ліміт на списку, а права панель (розмова) то з'являлась, то зникала. Рядки списку (delegateLoader) і
# AdsWebView не розгортаємо: їхні діти не потрібні, а розмова лежить значно вище за ці гілки.
$seen = New-Object System.Collections.Generic.HashSet[string]
$nodes = New-Object System.Collections.Generic.List[object]
$queue = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue(@($win, 0))
while ($queue.Count -gt 0 -and $nodes.Count -lt 1500) {
    $item = $queue.Dequeue()
    $element = $item[0]
    $depth = $item[1]
    $current = $element.Current
    if ($current.AutomationId -like '*AdsWebView*') { continue }
    if (-not $seen.Add(($element.GetRuntimeId() -join '.'))) { continue }
    $nodes.Add($element)
    if ($depth -ge 14 -or $current.AutomationId -match '(^|.)delegateLoader$') { continue }
    $child = $Walker.GetFirstChild($element)
    while ($child -ne $null) { $queue.Enqueue(@($child, ($depth + 1))); $child = $Walker.GetNextSibling($child) }
}

function IdOf($n) { return [string]$n.Current.AutomationId }
function FindById([string]$pattern, [string]$type = '') {
    foreach ($n in $nodes) {
        $c = $n.Current
        if ($c.AutomationId -match $pattern -and (-not $type -or $c.ControlType.ProgrammaticName -eq $type)) { return $n }
    }
    return $null
}
function FindAllById([string]$pattern, [string]$type = '') {
    $found = @()
    foreach ($n in $nodes) {
        $c = $n.Current
        if ($c.AutomationId -match $pattern -and (-not $type -or $c.ControlType.ProgrammaticName -eq $type)) { $found += $n }
    }
    return $found
}
# Межі елемента у фізичних екранних пікселях; поза екраном (нескінченні значення) — $null.
function RectOf($n) {
    if (-not $n) { return $null }
    $b = $n.Current.BoundingRectangle
    if ($b.IsEmpty -or [double]::IsInfinity($b.X) -or [double]::IsInfinity($b.Y) -or [double]::IsInfinity($b.Width) -or [double]::IsInfinity($b.Height)) { return $null }
    return @{ x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height }
}
function ValueOf($n) {
    try { return [string]$n.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { return '' }
}
function SetValueOf($n, [string]$text) { $n.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($text) }
# Справжній клік у вікно (PostMessage миші): Invoke на рядках списку чатів Viber не відкриває розмову. Координати — екранні фізичні.
function ClickAt([int]$sx, [int]$sy) {
    $cp = New-Object VU+POINT; [void][VU]::ClientToScreen($hwnd, [ref]$cp)
    $cx = $sx - $cp.X; $cy = $sy - $cp.Y
    $l = [IntPtr]((($cy -band 0xFFFF) -shl 16) -bor ($cx -band 0xFFFF))
    [void][VU]::PostMessage($hwnd, 0x0200, [IntPtr]::Zero, $l)   # WM_MOUSEMOVE
    Start-Sleep -Milliseconds 120
    [void][VU]::PostMessage($hwnd, 0x0201, [IntPtr]1, $l)         # WM_LBUTTONDOWN
    Start-Sleep -Milliseconds 90
    [void][VU]::PostMessage($hwnd, 0x0202, [IntPtr]::Zero, $l)    # WM_LBUTTONUP
}
function InvokeOf($n) { $n.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }

# Діалоги Qt Quick Controls: заголовок і назви кнопок (це службовий текст застосунку, не чати).
$popups = @()
foreach ($n in $nodes) {
    if ($n.Current.ClassName -eq 'QQuickPopupItem') {
        $buttons = @()
        $kid = $Walker.GetFirstChild($n)
        while ($kid -ne $null) { if ($kid.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $kid.Current.Name) { $buttons += $kid.Current.Name }; $kid = $Walker.GetNextSibling($kid) }
        $popups += @{ title = [string]$n.Current.Name; buttons = $buttons }
    }
}

# Розмова: панель стрічки (StackView), поле повідомлення й кнопка відправки (числові суфікси класів залежать від збірки Viber).
$stack = FindById 'SplitView_QMLTYPE_\d+\.StackView_QMLTYPE_\d+$' 'ControlType.Pane'
$composer = FindById 'StackView_QMLTYPE_\d+\.QQuickTextEdit_QML_\d+$' 'ControlType.Edit'
$sendButton = FindById 'StackView_QMLTYPE_\d+\.SendToolbarButton$' 'ControlType.Button'
$aiPanel = FindById 'AISendButton' 'ControlType.Button'
$composerValue = if ($composer) { ValueOf $composer } else { '' }
$conversationOpen = [bool]($composer -and $sendButton)

# Перегляд фото (Popup після вибору файла): підпис, кнопка відправки, «×».
$previewCaption = FindById 'Popup\.ScrollView_QMLTYPE_\d+\.TextArea_QMLTYPE_\d+(_QML_\d+)?$' 'ControlType.Edit'
$previewSend = FindById 'Popup\.RoundIconButton_QMLTYPE_\d+(_QML_\d+)?$' 'ControlType.Button'
$previewClose = $null
foreach ($n in (FindAllById 'Popup\.IconButton_QMLTYPE_\d+(_QML_\d+)?$' 'ControlType.Button')) {
    $r = RectOf $n
    if ($r -and (-not $previewClose -or $r.y -lt (RectOf $previewClose).y)) { $previewClose = $n }
}
$previewOpen = [bool]($previewCaption -and $previewSend)

# Рядки списку чатів ліворуч: групи delegateLoader, що лежать лівіше за розмову. Назв UIA не віддає, лише межі.
function ListRows() {
    $stackRect = RectOf $stack
    $winRect = New-Object VU+RECT; [void][VU]::GetWindowRect($hwnd, [ref]$winRect)
    $rows = @()
    foreach ($n in (FindAllById '(^|\.)delegateLoader$' 'ControlType.Group')) {
        $r = RectOf $n
        if (-not $r -or $r.h -lt 50 -or $r.h -gt 140 -or $r.w -lt 200 -or $r.w -gt 420) { continue }
        if ($stackRect -and $r.x -ge $stackRect.x) { continue }
        if ($r.y -lt 120 -or ($r.y + $r.h) -gt $winRect.B) { continue }
        $rows += $r
    }
    return @($rows | Sort-Object { $_.y })
}

switch ($Command) {
    'info' {
        $version = ''
        try { $version = [string]$proc.MainModule.FileVersionInfo.FileVersion } catch { }
        Reply @{ ok = $true; version = $version; windows = ('Windows ' + [System.Environment]::OSVersion.Version.ToString()) }
    }
    'status' {
        Reply @{ ok = $true; running = $true; popups = $popups; conversationOpen = $conversationOpen; composerLength = $composerValue.Length; aiPanel = [bool]$aiPanel; previewOpen = $previewOpen }
    }
    'geometry' {
        $wr = New-Object VU+RECT; [void][VU]::GetWindowRect($hwnd, [ref]$wr)
        $cr = New-Object VU+RECT; [void][VU]::GetClientRect($hwnd, [ref]$cr)
        $cp = New-Object VU+POINT; [void][VU]::ClientToScreen($hwnd, [ref]$cp)
        $stackRect = RectOf $stack
        $search = FindById 'SplitView_QMLTYPE_\d+\.StackView_QMLTYPE_\d+\.SearchButton_QMLTYPE_\d+$' 'ControlType.Button'
        $searchRect = RectOf $search
        $headerRect = $null
        if ($stackRect -and $searchRect) {
            # Смуга назви: від правого краю аватара до кнопки пошуку, по центру кнопок шапки. Усе від меж стрічки, не фіксовані пікселі.
            $centerY = $searchRect.y + [int]($searchRect.h / 2)
            $top = [Math]::Max($stackRect.y, $centerY - 40)
            $left = $stackRect.x + 70
            $headerRect = @{ x = $left; y = $top; w = [Math]::Max(0, $searchRect.x - 8 - $left); h = 80 }
        }
        $searchField = FindById 'SearchItem_QMLTYPE_\d+(_QML_\d+)?\.TextFieldItem_QMLTYPE_\d+$' 'ControlType.Edit'
        Reply @{
            ok = $true
            window = @{ hwnd = [int64]$hwnd; x = $wr.L; y = $wr.T; w = ($wr.R - $wr.L); h = ($wr.B - $wr.T); clientX = $cp.X; clientY = $cp.Y; clientW = $cr.R; clientH = $cr.B; iconic = [bool][VU]::IsIconic($hwnd); zoomed = [bool][VU]::IsZoomed($hwnd) }
            conversationOpen = $conversationOpen
            stack = $stackRect
            header = $headerRect
            composer = (RectOf $composer)
            searchField = (RectOf $searchField)
            searchValue = $(if ($searchField) { ValueOf $searchField } else { '' })
            previewOpen = $previewOpen
            rows = @(ListRows)
        }
    }
    'messages' {
        if (-not $conversationOpen) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        $stackRect = RectOf $stack
        $composerRect = RectOf $composer
        $feedTop = if ($stackRect) { $stackRect.y + 60 } else { 0 }
        $feedBottom = if ($composerRect) { $composerRect.y } else { 100000 }
        $items = @()
        $keys = @{}
        foreach ($n in (FindAllById 'StackView_QMLTYPE_\d+(\.FeedDelegate_QMLTYPE_\d+)?\.TextEditItem_QMLTYPE_\d+(_QML_\d+)?$' 'ControlType.Edit')) {
            $r = RectOf $n
            if (-not $r -or ($r.y + $r.h) -lt $feedTop -or $r.y -gt $feedBottom) { continue }
            $v = ValueOf $n
            if (-not $v) { continue }
            $key = "$($r.y)|$v"
            if ($keys.ContainsKey($key)) { continue }
            $keys[$key] = 1
            $items += @{ x = $r.x; y = $r.y; w = $r.w; h = $r.h; length = $v.Length; text = $(if ($v.Length -gt 600) { $v.Substring(0, 600) } else { $v }) }
        }
        Reply @{ ok = $true; stack = $stackRect; feedTop = $feedTop; feedBottom = $feedBottom; messages = @($items | Sort-Object { $_.y }) }
    }
    'dismiss' {
        foreach ($n in $nodes) {
            if ($n.Current.ClassName -eq 'QQuickPopupItem') {
                $kid = $Walker.GetFirstChild($n)
                while ($kid -ne $null) {
                    if ($kid.Current.Name -eq $Button) { InvokeOf $kid; Reply @{ ok = $true; dismissed = $Button } }
                    $kid = $Walker.GetNextSibling($kid)
                }
            }
        }
        # Рекламні панелі Viber («Give images a new look») — не QQuickPopupItem: кнопку шукаємо за назвою по всьому вікну.
        foreach ($n in $nodes) {
            if ($n.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $n.Current.Name -eq $Button) { InvokeOf $n; Reply @{ ok = $true; dismissed = $Button } }
        }
        Reply @{ ok = $false; reason = 'dialog_button_not_found' }
    }
    'set-text' {
        if ($popups.Count -gt 0) { Reply @{ ok = $false; reason = 'viber_desktop_dialog'; popups = $popups } }
        if (-not $conversationOpen) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        $text = FromB64 $TextBase64
        SetValueOf $composer $text
        Start-Sleep -Milliseconds 400
        $after = ValueOf $composer
        Reply @{ ok = ($after -eq $text); matches = ($after -eq $text); length = $after.Length }
    }
    'clear' {
        if (-not $composer) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        SetValueOf $composer ''
        Reply @{ ok = $true }
    }
    'send' {
        if ($popups.Count -gt 0) { Reply @{ ok = $false; reason = 'viber_desktop_dialog'; popups = $popups } }
        if (-not $conversationOpen) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        $expect = FromB64 $ExpectBase64
        if (-not $expect -or $composerValue -ne $expect) { Reply @{ ok = $false; reason = 'composer_mismatch'; length = $composerValue.Length } }
        InvokeOf $sendButton
        Start-Sleep -Milliseconds 1800
        $left = if ($composer) { ValueOf $composer } else { '' }
        Reply @{ ok = ($left.Length -eq 0); composerCleared = ($left.Length -eq 0) }
    }
    'search' {
        $field = FindById 'SearchItem_QMLTYPE_\d+(_QML_\d+)?\.TextFieldItem_QMLTYPE_\d+$' 'ControlType.Edit'
        if (-not $field) { Reply @{ ok = $false; reason = 'viber_desktop_search_missing' } }
        $text = FromB64 $TextBase64
        SetValueOf $field $text
        Start-Sleep -Milliseconds 900
        $after = ValueOf $field
        Reply @{ ok = ($after -eq $text); value = $after }
    }
    'search-clear' {
        $field = FindById 'SearchItem_QMLTYPE_\d+(_QML_\d+)?\.TextFieldItem_QMLTYPE_\d+$' 'ControlType.Edit'
        if ($field) { SetValueOf $field '' }
        Reply @{ ok = $true }
    }
    'open-row' {
        $rowNodes = @()
        $stackRect = RectOf $stack
        $winRect = New-Object VU+RECT; [void][VU]::GetWindowRect($hwnd, [ref]$winRect)
        foreach ($n in (FindAllById '(^|\.)delegateLoader$' 'ControlType.Group')) {
            $r = RectOf $n
            if (-not $r -or $r.h -lt 50 -or $r.h -gt 140 -or $r.w -lt 200 -or $r.w -gt 420) { continue }
            if ($stackRect -and $r.x -ge $stackRect.x) { continue }
            if ($r.y -lt 120 -or ($r.y + $r.h) -gt $winRect.B) { continue }
            $rowNodes += @{ node = $n; y = $r.y; x = $r.x; w = $r.w; h = $r.h }
        }
        $rowNodes = @($rowNodes | Sort-Object { $_.y })
        if ($Index -lt 0 -or $Index -ge $rowNodes.Count) { Reply @{ ok = $false; reason = 'row_not_found'; count = $rowNodes.Count } }
        $pick = $rowNodes[$Index]
        if ($Y -ge 0 -and [Math]::Abs($pick.y - $Y) -gt 4) { Reply @{ ok = $false; reason = 'row_moved'; expectedY = $Y; actualY = $pick.y } }
        # Клік по тілу рядка (правіше за аватар, лівіше за час): на назві чату.
        ClickAt ($pick.x + 150) ($pick.y + 28)
        Start-Sleep -Milliseconds 1200
        Reply @{ ok = $true; y = $pick.y }
    }
    'attach' {
        if ($popups.Count -gt 0) { Reply @{ ok = $false; reason = 'viber_desktop_dialog'; popups = $popups } }
        if (-not $conversationOpen) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        # «+» — найлівіша кнопка-іконка в рядку поля повідомлення (на тій самій висоті, що й поле).
        $composerRect = RectOf $composer
        $plus = $null
        foreach ($n in (FindAllById 'StackView_QMLTYPE_\d+\.IconButton_QMLTYPE_\d+(_QML_\d+)?$')) {
            $r = RectOf $n
            if (-not $r -or [Math]::Abs(($r.y + $r.h / 2) - ($composerRect.y + $composerRect.h / 2)) -gt 30 -or $r.x -ge $composerRect.x) { continue }
            if (-not $plus -or $r.x -lt (RectOf $plus).x) { $plus = $n }
        }
        if (-not $plus) { Reply @{ ok = $false; reason = 'viber_desktop_attach_missing' } }
        InvokeOf $plus
        Reply @{ ok = $true }
    }
    'preview' {
        $closeRect = RectOf $previewClose
        Reply @{ ok = $true; previewOpen = $previewOpen; captionLength = $(if ($previewCaption) { (ValueOf $previewCaption).Length } else { 0 }); send = (RectOf $previewSend); close = $closeRect; caption = (RectOf $previewCaption) }
    }
    'preview-caption' {
        if (-not $previewOpen) { Reply @{ ok = $false; reason = 'viber_desktop_no_preview' } }
        $text = FromB64 $TextBase64
        SetValueOf $previewCaption $text
        Start-Sleep -Milliseconds 500
        $after = ValueOf $previewCaption
        Reply @{ ok = ($after -eq $text); length = $after.Length }
    }
    'preview-send' {
        if (-not $previewOpen) { Reply @{ ok = $false; reason = 'viber_desktop_no_preview' } }
        $expect = FromB64 $ExpectBase64
        $current = ValueOf $previewCaption
        # Підпис порожній лише коли це відправка фото без підпису (-ExpectBase64 порожній і поле порожнє).
        if ($current -ne $expect) { Reply @{ ok = $false; reason = 'caption_mismatch'; length = $current.Length } }
        InvokeOf $previewSend
        Start-Sleep -Milliseconds 2500
        Reply @{ ok = $true }
    }
    'preview-close' {
        if (-not $previewClose) { Reply @{ ok = $true; closed = $false } }
        InvokeOf $previewClose
        Start-Sleep -Milliseconds 700
        Reply @{ ok = $true; closed = $true }
    }
    'scroll-bottom' {
        $b = FindById 'StackView_QMLTYPE_\d+\.ScrollToBottomItem_QMLTYPE_\d+(_QML_\d+)?$' 'ControlType.Button'
        if ($b) { InvokeOf $b; Start-Sleep -Milliseconds 500 }
        Reply @{ ok = $true; pressed = [bool]$b }
    }
    'wheel' {
        $stackRect = RectOf $stack
        if (-not $stackRect) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        $cx = $stackRect.x + [int]($stackRect.w / 2)
        $cy = $stackRect.y + [int]($stackRect.h / 2)
        $delta = [int]($Index * 120)
        $wParam = [IntPtr]((($delta -band 0xFFFF) -shl 16))
        $lParam = [IntPtr](((($cy -band 0xFFFF) -shl 16)) -bor ($cx -band 0xFFFF))
        [void][VU]::PostMessage($hwnd, 0x020A, $wParam, $lParam)
        Start-Sleep -Milliseconds 400
        Reply @{ ok = $true; at = @($cx, $cy) }
    }
}
