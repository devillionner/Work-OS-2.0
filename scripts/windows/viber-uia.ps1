# Viber Desktop (Qt6/QML) через UI Automation: один виклик — одна команда, відповідь — один рядок JSON (Windows PowerShell 5.1, без прав адміністратора).
#   status              чи запущено, які діалоги відкриті, чи відкрита розмова, скільки символів у полі повідомлення
#   set-text            записати текст у поле повідомлення (ValuePattern, фокус вікна не потрібен); текст у Base64 (UTF-8)
#   clear               очистити поле повідомлення
#   send                натиснути «Надіслати» (InvokePattern), але ЛИШЕ коли в полі рівно очікуваний текст (-ExpectBase64)
#   dismiss             натиснути кнопку діалогу за назвою (-Button, за замовчуванням OK)
# Важливо: Viber НЕ віддає через UIA назви чатів і тексти повідомлень (лише діалоги та кнопки): ця команда нічого не знає про те, який чат відкрито.
# Тому вона не вирішує, КУДИ писати; запобіжник «це саме потрібний чат» мусить бути окремим і до `send`.
param(
    [Parameter(Mandatory = $true)][ValidateSet('status', 'set-text', 'clear', 'send', 'dismiss')][string]$Command,
    [string]$TextBase64 = '',
    [string]$ExpectBase64 = '',
    [string]$Button = 'OK'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$Walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Reply($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 6)); exit 0 }
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

# Обхід із захистом від циклів (RuntimeId) і без вбудованого рекламного вебвікна: його піддерево нескінченно вкладене.
$seen = New-Object System.Collections.Generic.HashSet[string]
$nodes = New-Object System.Collections.Generic.List[object]
function Collect($element, [int]$depth) {
    if ($nodes.Count -ge 600 -or $depth -gt 14) { return }
    $current = $element.Current
    if ($current.AutomationId -like '*AdsWebView*') { return }
    if (-not $seen.Add(($element.GetRuntimeId() -join '.'))) { return }
    $nodes.Add($element)
    $child = $Walker.GetFirstChild($element)
    while ($child -ne $null -and $nodes.Count -lt 600) { Collect $child ($depth + 1); $child = $Walker.GetNextSibling($child) }
}
Collect $win 0

function FindById([string]$pattern, [string]$type = '') {
    foreach ($n in $nodes) {
        $c = $n.Current
        if ($c.AutomationId -match $pattern -and (-not $type -or $c.ControlType.ProgrammaticName -eq $type)) { return $n }
    }
    return $null
}

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

# Поле повідомлення й кнопка відправки відкритої розмови (назви класів мають різні числові суфікси залежно від збірки Viber).
$composer = FindById 'StackView_QMLTYPE_\d+\.QQuickTextEdit_QML_\d+$' 'ControlType.Edit'
$sendButton = FindById 'StackView_QMLTYPE_\d+\.SendToolbarButton$' 'ControlType.Button'
$aiPanel = FindById 'AISendButton' 'ControlType.Button'
$composerValue = ''
if ($composer) { try { $composerValue = [string]$composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { } }
$conversationOpen = [bool]($composer -and $sendButton)

switch ($Command) {
    'status' {
        Reply @{ ok = $true; running = $true; popups = $popups; conversationOpen = $conversationOpen; composerLength = $composerValue.Length; aiPanel = [bool]$aiPanel }
    }
    'dismiss' {
        foreach ($n in $nodes) {
            if ($n.Current.ClassName -eq 'QQuickPopupItem') {
                $kid = $Walker.GetFirstChild($n)
                while ($kid -ne $null) {
                    if ($kid.Current.Name -eq $Button) { $kid.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Reply @{ ok = $true; dismissed = $Button } }
                    $kid = $Walker.GetNextSibling($kid)
                }
            }
        }
        Reply @{ ok = $false; reason = 'dialog_button_not_found' }
    }
    'set-text' {
        if ($popups.Count -gt 0) { Reply @{ ok = $false; reason = 'viber_desktop_dialog'; popups = $popups } }
        if (-not $conversationOpen) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        $text = FromB64 $TextBase64
        $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($text)
        Start-Sleep -Milliseconds 400
        $after = [string]$composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
        Reply @{ ok = ($after -eq $text); matches = ($after -eq $text); length = $after.Length }
    }
    'clear' {
        if (-not $composer) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('')
        Reply @{ ok = $true }
    }
    'send' {
        if ($popups.Count -gt 0) { Reply @{ ok = $false; reason = 'viber_desktop_dialog'; popups = $popups } }
        if (-not $conversationOpen) { Reply @{ ok = $false; reason = 'viber_desktop_no_conversation' } }
        $expect = FromB64 $ExpectBase64
        if (-not $expect -or $composerValue -ne $expect) { Reply @{ ok = $false; reason = 'composer_mismatch'; length = $composerValue.Length } }
        $sendButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Start-Sleep -Milliseconds 1800
        $left = ''
        try { $left = [string]$composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { }
        Reply @{ ok = ($left.Length -eq 0); composerCleared = ($left.Length -eq 0) }
    }
}
