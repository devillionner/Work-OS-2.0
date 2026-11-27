# Work OS runner: значок у треї Windows (Windows PowerShell 5.1, без прав адміністратора).
# Робить те саме, що scripts/work-os-runner-tray.py на Linux:
#   * запускає runner (scripts\platform\windows-launch.mjs) і показує його стан із runner-status.json;
#   * перезапускає runner, коли змінилися його файли (лише між задачами), і каже про це;
#   * піднімає runner, що впав (пауза 5 с, 10 с, 20 с … до 5 хв); підхоплює runner, що пережив трей;
#   * випадкової зупинки немає: єдиний вихід — «Вимкнути повністю…» з підтвердженням;
#   * повторний запуск (посилання workos-runner://start) лише будить трей, що вже працює, файлом state\wake.
# Число (відправлено за день) малюється прямо в значку: Windows не показує текст поруч із ним.
param([switch]$Wake, [switch]$Replace)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace WorkOs -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr handle);'
[System.Windows.Forms.Application]::EnableVisualStyles()
# Помилка в обробнику меню не повинна показувати системне вікно винятку: пишемо її в журнал трея (режим задається до створення елементів керування).
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Base = Join-Path $env:LOCALAPPDATA 'WorkOS'
$StateDir = Join-Path $Base 'state'
$ConfigDir = Join-Path $Base 'config'
$StatusFile = Join-Path $StateDir 'runner-status.json'
$LogFile = Join-Path $StateDir 'whatsapp-runner.log'
$TrayLog = Join-Path $StateDir 'tray.log'
$WakeFile = Join-Path $StateDir 'wake'
$ModeFile = Join-Path $StateDir 'runner-browser-mode'
$BrowserFile = Join-Path $StateDir 'browser.json'
$LockFile = Join-Path $StateDir 'runner.lock'
$HintFile = Join-Path $StateDir 'first-run-hint'
$FailuresDir = Join-Path $StateDir 'failures'
$RunnerEnv = Join-Path $ConfigDir 'runner.env'
$Launcher = Join-Path $Root 'scripts\platform\windows-launch.mjs'
$Standby = Join-Path $Root 'scripts\platform\runner-standby.mjs'
$StandbyLock = Join-Path $StateDir 'standby.lock'
$RunnerEntry = Join-Path $Root 'scripts\chat-discovery-runner.mjs'
$AppMeta = Join-Path $Root 'lib\app-meta.ts'
New-Item -ItemType Directory -Force -Path $StateDir, $ConfigDir | Out-Null

$UpdateQuietSeconds = 4
$BackoffStart = 5; $BackoffMax = 300; $BackoffResetAfter = 60
$UpdateNoteSeconds = 600
$BrowserCheckSeconds = 10
$FailuresCheckSeconds = 20
$BrowserGoneRestartAfter = 3
$BrowserRestartGapSeconds = 300
$StandbyCheckSeconds = 30
$CdpPort = 9222

function Write-TrayLog([string]$text) {
    try { Add-Content -LiteralPath $TrayLog -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) -Encoding UTF8 } catch { }
}

[System.Windows.Forms.Application]::add_ThreadException({ param($sender, $e) Write-TrayLog ('Виняток: ' + $e.Exception.Message) })

function Read-RunnerEnv {
    $values = @{}
    try {
        foreach ($line in [System.IO.File]::ReadAllLines($RunnerEnv, [System.Text.Encoding]::UTF8)) {
            if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $values[$Matches[1]] = $Matches[2].Trim('"', "'") }
        }
    } catch { }
    return $values
}
$Settings = Read-RunnerEnv
$WorkOsUrl = if ($Settings['WORK_OS_URL']) { $Settings['WORK_OS_URL'].TrimEnd('/') } else { 'https://work-os-2-staging.devillionner.workers.dev' }
if ($Settings['WORK_OS_CDP_PORT']) { $CdpPort = [int]$Settings['WORK_OS_CDP_PORT'] }
$NodeExe = $Settings['WORK_OS_NODE']
if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) {
    $found = Get-Command node -ErrorAction SilentlyContinue
    $NodeExe = if ($found) { $found.Source } else { 'node' }
}

# ── один трей на користувача ───────────────────────────────────────────────────────────────────────
$mutex = New-Object System.Threading.Mutex($false, 'Local\WorkOsRunnerTray')
$acquired = $false
try { $acquired = $mutex.WaitOne($(if ($Replace) { 20000 } else { 0 })) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
if (-not $acquired) {
    # Другий запуск (посилання workos-runner://start): будимо трей, що вже працює.
    try { Set-Content -LiteralPath $WakeFile -Value (Get-Date).ToString('o') } catch { }
    exit 0
}

# ── допоміжне ──────────────────────────────────────────────────────────────────────────────────────
function Get-AppVersion {
    try { if ((Get-Content -LiteralPath $AppMeta -Raw -Encoding UTF8) -match "APP_VERSION\s*=\s*'([^']+)'") { return $Matches[1] } } catch { }
    return ''
}

function Test-PortOpen([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $port)
        return ($task.Wait(800) -and $client.Connected)
    } catch { return $false } finally { $client.Close() }
}

function Test-ProcessAlive([int]$processId, [string]$name) {
    if ($processId -le 0) { return $false }
    $p = Get-Process -Id $processId -ErrorAction SilentlyContinue
    return ($null -ne $p -and ($p.ProcessName -like $name))
}

function Read-Json([string]$path) {
    try { return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

# Файли, зміна яких означає нову версію runner: вхідний файл, усе, що він імпортує (відносні імпорти), і лаунчер.
$ImportRe = [regex]"(?:from|import)\s*\(?\s*['""](\.{1,2}/[^'""]+)['""]"
function Get-WatchedFiles {
    $seen = New-Object System.Collections.Generic.HashSet[string]
    $stack = New-Object System.Collections.Generic.Stack[string]
    foreach ($entry in @($RunnerEntry, $Launcher)) { $stack.Push($entry) }
    while ($stack.Count -gt 0) {
        $path = $stack.Pop()
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or -not $seen.Add($path)) { continue }
        try { $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) } catch { continue }
        foreach ($m in $ImportRe.Matches($text)) {
            $candidate = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $path) $m.Groups[1].Value))
            if ($candidate -match '\.(mjs|js|ts)$') { $stack.Push($candidate) }
        }
    }
    return @($seen | Sort-Object)
}
$script:WatchedList = Get-WatchedFiles
function Get-Signature {
    $parts = foreach ($file in $script:WatchedList) {
        try { $item = Get-Item -LiteralPath $file -ErrorAction Stop; '{0}|{1}|{2}' -f $file, $item.LastWriteTimeUtc.Ticks, $item.Length } catch { }
    }
    return ($parts -join ';')
}
$script:Sig = Get-Signature
$script:ChangedAt = $null
$SelfItem = Get-Item -LiteralPath $PSCommandPath
$script:SelfSig = '{0}|{1}' -f $SelfItem.LastWriteTimeUtc.Ticks, $SelfItem.Length

# ── runner ─────────────────────────────────────────────────────────────────────────────────────────
$script:Proc = $null
$script:StartedAt = [DateTime]::MinValue
$script:Backoff = $BackoffStart
$script:NextStartAt = [DateTime]::MinValue
$script:UpdateNote = ''
$script:UpdateNoteUntil = [DateTime]::MinValue

function Get-RunnerPid {
    # Runner пише свій pid у state\runner.lock (запис лаунчера).
    $lock = Read-Json $LockFile
    if ($lock -and $lock.pid -and (Test-ProcessAlive ([int]$lock.pid) 'node')) { return [int]$lock.pid }
    return 0
}

function Test-RunnerRunning {
    if ($script:Proc -ne $null -and -not $script:Proc.HasExited) { return $true }
    return ((Get-RunnerPid) -gt 0)
}

function Start-Runner([bool]$updated = $false) {
    if (Test-RunnerRunning) { return }
    try { if ((Get-Item -LiteralPath $LogFile -ErrorAction SilentlyContinue).Length -gt 5MB) { Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.old') -Force } } catch { }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    # Подвійні лапки навколо всієї команди: так cmd розбирає /c "…" з кількома лапкованими шляхами.
    $psi.Arguments = '/d /c ""' + $NodeExe + '" "' + $Launcher + '" >> "' + $LogFile + '" 2>&1 < NUL"'
    $psi.WorkingDirectory = $StateDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    if ($updated) { $psi.EnvironmentVariables['WORK_OS_RUNNER_UPDATED'] = '1' } else { [void]$psi.EnvironmentVariables.Remove('WORK_OS_RUNNER_UPDATED') }
    $script:Proc = [System.Diagnostics.Process]::Start($psi)
    $script:StartedAt = Get-Date
}

function Stop-Runner {
    # Без /T: браузер runner (Edge) окремий процес і має пережити перезапуск runner; блокування сну завершується разом з ним.
    $runnerPid = Get-RunnerPid
    if ($runnerPid -gt 0) { Stop-Process -Id $runnerPid -Force -ErrorAction SilentlyContinue }
    if ($script:Proc -ne $null -and -not $script:Proc.HasExited) { try { $script:Proc.Kill() } catch { } }
    $script:Proc = $null
    Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
}

function Restart-Runner([bool]$updated = $false, [string]$reason = 'вручну з меню') {
    Write-TrayLog ("Перезапуск runner: $reason")
    Stop-Runner
    $script:Backoff = $BackoffStart
    Start-Runner $updated
}

function Invoke-Wake {
    $script:Backoff = $BackoffStart
    $script:NextStartAt = [DateTime]::MinValue
    Start-Runner
}

# Черговий (runner-standby.mjs): завжди на зв'язку з Work OS і запускає runner кнопкою з телефону. Переживає «Вимкнути повністю».
$script:StandbyCheckedAt = [DateTime]::MinValue
$script:AppVersion = ''
$script:VersionReadAt = [DateTime]::MinValue
function Start-Standby {
    $now = Get-Date
    if (($now - $script:StandbyCheckedAt).TotalSeconds -lt $StandbyCheckSeconds) { return }
    $script:StandbyCheckedAt = $now
    if (-not (Test-Path -LiteralPath $Standby)) { return }
    $lock = Read-Json $StandbyLock
    if ($lock -and $lock.pid -and (Test-ProcessAlive ([int]$lock.pid) 'node')) { return }
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $NodeExe
        $psi.Arguments = '"' + $Standby + '"'
        $psi.WorkingDirectory = $StateDir
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        [void][System.Diagnostics.Process]::Start($psi)
    } catch { Write-TrayLog ('Черговий: ' + $_.Exception.Message) }
}

# ── значок ─────────────────────────────────────────────────────────────────────────────────────────
$Colors = @{
    working = '#2563eb'; ready = '#16a34a'; starting = '#16a34a'; paused = '#9ca3af'; no_token = '#f59e0b'
    no_browser = '#f59e0b'; attention = '#f59e0b'; stopped = '#dc2626'; reconnecting = '#f59e0b'
}
$Labels = @{
    working = 'Працює'; ready = 'Готовий'; starting = 'Запускається'; paused = 'Пауза'; no_token = 'Не підключений'
    no_browser = 'Немає браузера'; attention = 'Потрібна увага'; stopped = 'Зупинений'; reconnecting = 'Перепідключення'
}

function New-StateIcon([string]$state, [string]$digits) {
    $hex = if ($Colors.ContainsKey($state)) { $Colors[$state] } else { $Colors['starting'] }
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 8
    $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90); $path.AddArc(31 - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $path.AddArc(31 - $r * 2, 31 - $r * 2, $r * 2, $r * 2, 0, 90); $path.AddArc(0, 31 - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))
    $g.FillPath($brush, $path)
    if ($digits) {
        $size = if ($digits.Length -ge 3) { 13 } elseif ($digits.Length -eq 2) { 17 } else { 20 }
        $font = New-Object System.Drawing.Font('Segoe UI', $size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center; $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $g.DrawString($digits, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 1, 32, 32), $format)
        $font.Dispose(); $format.Dispose()
    } else {
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 3.2
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $points = [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF 7.5, 10.5), (New-Object System.Drawing.PointF 11.5, 22.5), (New-Object System.Drawing.PointF 16, 13.5), (New-Object System.Drawing.PointF 20.5, 22.5), (New-Object System.Drawing.PointF 24.5, 10.5))
        $g.DrawLines($pen, $points)
        $pen.Dispose()
    }
    $brush.Dispose(); $path.Dispose(); $g.Dispose()
    $handle = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($handle)
    return @{ Icon = $icon; Handle = $handle; Bitmap = $bmp }
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$script:IconKey = ''
$script:IconHandle = [IntPtr]::Zero
function Set-TrayIcon([string]$state, [string]$digits) {
    $key = "$state|$digits"
    if ($key -eq $script:IconKey) { return }
    $script:IconKey = $key
    $made = New-StateIcon $state $digits
    $old = $script:IconHandle
    $notify.Icon = $made.Icon
    $script:IconHandle = $made.Handle
    $made.Bitmap.Dispose()
    if ($old -ne [IntPtr]::Zero) { [void][WorkOs.Native]::DestroyIcon($old) }
}

# Підказка значка: у .NET Framework ліміт 63 символи, обхід через приватне поле піднімає його до 127.
function Set-TrayText([string]$text) {
    if ($text.Length -gt 127) { $text = $text.Substring(0, 126) + '…' }
    try {
        $type = [System.Windows.Forms.NotifyIcon]
        $type.GetField('text', [System.Reflection.BindingFlags]'NonPublic,Instance').SetValue($notify, $text)
        if ($notify.Visible) { [void]$type.GetMethod('UpdateIcon', [System.Reflection.BindingFlags]'NonPublic,Instance').Invoke($notify, @($true)) }
    } catch { $notify.Text = $text.Substring(0, [Math]::Min(62, $text.Length)) }
}

# ── меню ───────────────────────────────────────────────────────────────────────────────────────────
$menu = New-Object System.Windows.Forms.ContextMenuStrip
function Add-Item([string]$text, [scriptblock]$onClick, [bool]$enabled = $true) {
    $item = New-Object System.Windows.Forms.ToolStripMenuItem $text
    $item.Enabled = $enabled
    if ($onClick) { $item.Add_Click($onClick) }
    [void]$menu.Items.Add($item)
    return $item
}

$platformNames = [ordered]@{ viber = 'Viber'; telegram = 'Telegram'; whatsapp = 'WhatsApp' }
$platformItems = @{}
foreach ($id in $platformNames.Keys) { $platformItems[$id] = Add-Item ($platformNames[$id] + ' —') $null $false }
$script:DecisionPlatform = 'telegram'
$decisionItem = Add-Item 'Потребують рішення' { Start-Process "$WorkOsUrl/?go=platforms:$($script:DecisionPlatform):autopost" }
$decisionItem.Visible = $false
[void](Add-Item 'Відкрити Work OS' { Start-Process $WorkOsUrl })
$browserItem = Add-Item 'Показати браузер runner' { Switch-BrowserMode }
$browserItem.Visible = $false
$healthItems = @{}
foreach ($id in $platformNames.Keys) { $healthItems[$id] = Add-Item $platformNames[$id] $null $false; $healthItems[$id].Visible = $false }
$failuresItem = Add-Item 'Нові збої' {
    try { New-Item -ItemType Directory -Force -Path $FailuresDir | Out-Null; (New-Item -ItemType File -Force -Path (Join-Path $FailuresDir '.seen')).LastWriteTime = Get-Date } catch { }
    $failuresItem.Visible = $false
    Start-Process explorer.exe $FailuresDir
}
$failuresItem.Visible = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$stateItem = Add-Item 'Work OS runner' $null $false
$detailItem = Add-Item '' $null $false
$awakeItem = Add-Item 'Не даю заснути: іде автопост' $null $false
$awakeItem.Visible = $false
[void](Add-Item 'Перезапустити runner' { Restart-Runner $false 'з меню «Перезапустити runner»'; Update-Tray })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void](Add-Item 'Вимкнути повністю…' { Confirm-Disable })
$notify.ContextMenuStrip = $menu
# Лівий клік теж відкриває меню (за замовчуванням його відкриває лише правий).
$notify.Add_MouseUp({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        try { [System.Windows.Forms.NotifyIcon].GetMethod('ShowContextMenu', [System.Reflection.BindingFlags]'NonPublic,Instance').Invoke($notify, $null) } catch { }
    }
})

# ── браузер runner ─────────────────────────────────────────────────────────────────────────────────
$script:BrowserCheckedAt = [DateTime]::MinValue
$script:BrowserGone = 0
$script:BrowserRestartedAt = [DateTime]::MinValue
$script:FailuresCheckedAt = [DateTime]::MinValue

function Get-RunnerBrowser {
    $info = Read-Json $BrowserFile
    if (-not $info -or -not $info.pid) { return $null }
    $browserPid = [int]$info.pid
    if ((Test-ProcessAlive $browserPid 'msedge') -or (Test-ProcessAlive $browserPid 'chrome')) { return $info }
    return $null
}

function Update-BrowserItem([string]$state) {
    $now = Get-Date
    if (($now - $script:BrowserCheckedAt).TotalSeconds -lt $BrowserCheckSeconds) { return }
    $script:BrowserCheckedAt = $now
    $info = Get-RunnerBrowser
    if (-not $info) {
        $browserItem.Visible = $false
        # Браузера runner немає (закрили вікно чи він упав), а runner живий і не зайнятий: без браузера WhatsApp і Telegram не працюють.
        # Лаунчер сам його відкриває, тож перезапускаємо runner (не частіше за раз на 5 хв).
        if (-not (Test-PortOpen $CdpPort)) { $script:BrowserGone++ } else { $script:BrowserGone = 0 }
        if ($script:BrowserGone -ge $BrowserGoneRestartAfter -and $state -ne 'working' -and (Test-RunnerRunning) `
                -and (($now - $script:BrowserRestartedAt).TotalSeconds -gt $BrowserRestartGapSeconds) -and (($now - $script:StartedAt).TotalSeconds -gt 60)) {
            $script:BrowserRestartedAt = $now; $script:BrowserGone = 0
            Restart-Runner $false 'браузер runner не відповідає (порт закритий 3 перевірки поспіль)'
        }
        return
    }
    $script:BrowserGone = 0
    $browserItem.Text = if ($info.headless) { 'Показати браузер runner' } else { 'Сховати браузер runner' }
    $browserItem.Enabled = ($state -ne 'working')
    $browserItem.Visible = $true
}

function Switch-BrowserMode {
    # Перезапускає браузер runner у протилежному режимі з тим самим профілем (сесії WhatsApp і Telegram лишаються).
    $info = Get-RunnerBrowser
    if (-not $info) { return }
    $wantWindow = [bool]$info.headless
    Write-TrayLog $(if ($wantWindow) { 'Показати браузер runner: перезапуск браузера з вікном' } else { 'Сховати браузер runner: перезапуск браузера без вікна' })
    try { Set-Content -LiteralPath $ModeFile -Value $(if ($wantWindow) { 'window' } else { 'headless' }) -Encoding ASCII } catch { return }
    Stop-Runner
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NodeExe
    $psi.Arguments = '"' + $Launcher + '" --close-browser'
    $psi.WorkingDirectory = $StateDir; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $closer = [System.Diagnostics.Process]::Start($psi)
    [void]$closer.WaitForExit(30000)
    $script:Backoff = $BackoffStart
    $script:NextStartAt = [DateTime]::MinValue
    $script:BrowserCheckedAt = [DateTime]::MinValue
    Start-Runner
    Update-Tray
}

function Update-Failures {
    $now = Get-Date
    if (($now - $script:FailuresCheckedAt).TotalSeconds -lt $FailuresCheckSeconds) { return }
    $script:FailuresCheckedAt = $now
    $count = 0
    try {
        $seenFile = Join-Path $FailuresDir '.seen'
        $seen = if (Test-Path -LiteralPath $seenFile) { (Get-Item -LiteralPath $seenFile).LastWriteTime } else { [DateTime]::MinValue }
        $count = @(Get-ChildItem -LiteralPath $FailuresDir -Directory -ErrorAction SilentlyContinue | Where-Object { -not $_.Name.StartsWith('.') -and $_.LastWriteTime -gt $seen }).Count
    } catch { }
    if ($count -gt 0) { $failuresItem.Text = "Нові збої: $count"; $failuresItem.Visible = $true } else { $failuresItem.Visible = $false }
}

# ── оновлення ──────────────────────────────────────────────────────────────────────────────────────
function Invoke-MaybeUpdate([string]$state) {
    $now = Get-Date
    $new = Get-Signature
    if ($new -ne $script:Sig) {
        $script:Sig = $new; $script:ChangedAt = $now
        $script:WatchedList = Get-WatchedFiles
    }
    if ($script:ChangedAt -eq $null -or ($now - $script:ChangedAt).TotalSeconds -lt $UpdateQuietSeconds -or $state -eq 'working') { return }
    $script:ChangedAt = $null
    $version = Get-AppVersion
    $script:UpdateNote = if ($version) { "Runner оновлено до $version" } else { 'Runner оновлено' }
    $script:UpdateNoteUntil = $now.AddSeconds($UpdateNoteSeconds)
    Restart-Runner $true "оновлення до $version"
}

# Змінився сам скрипт трея (оновлення пакета): запускаємо нову копію й виходимо, runner переживає.
function Invoke-SelfReplace([string]$state) {
    if ($state -eq 'working') { return }
    try {
        $item = Get-Item -LiteralPath $PSCommandPath
        if (('{0}|{1}' -f $item.LastWriteTimeUtc.Ticks, $item.Length) -eq $script:SelfSig) { return }
    } catch { return }
    Write-TrayLog 'Скрипт трея оновився: запускаю нову копію.'
    $argText = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Replace'
    Start-Process -FilePath "$env:SystemRoot\System32\conhost.exe" -ArgumentList $argText -WindowStyle Hidden
    Close-Tray -KeepRunner
}

# ── стан ───────────────────────────────────────────────────────────────────────────────────────────
$script:Day = $null
$script:Health = $null
$script:Awake = $false

function Read-Status {
    $status = Read-Json $StatusFile
    if (-not $status) { $script:Day = $null; $script:Health = $null; $script:Awake = $false; return @('starting', 'Запускається…') }
    $script:Awake = [bool]$status.awake
    $script:Day = $status.day
    $script:Health = $status.health
    $state = if ($status.state) { [string]$status.state } else { 'starting' }
    return @($state, [string]$status.detail)
}

function Update-Day {
    $digits = ''
    $summary = ''
    $decisions = 0; $best = 'telegram'; $bestCount = 0
    if ($script:Day -and (Test-RunnerRunning)) {
        $label = [string]$script:Day.label
        if ($label -match '(\d+)\s*/\s*(\d+)') { $digits = if ([int]$Matches[1] -gt 999) { '999' } else { $Matches[1] }; $summary = $label }
        foreach ($row in @($script:Day.platforms)) {
            if (-not $row) { continue }
            $id = [string]$row.id
            if ($platformItems.ContainsKey($id)) { $platformItems[$id].Text = [string]$row.text }
            $count = [int]$row.decision
            $decisions += $count
            if ($count -gt $bestCount) { $bestCount = $count; $best = $id }
        }
    }
    $script:DecisionPlatform = $best
    if ($decisions -gt 0) { $decisionItem.Text = "Потребують рішення · $decisions"; $decisionItem.Visible = $true } else { $decisionItem.Visible = $false }
    return @{ Digits = $digits; Summary = $summary }
}

function Update-Health {
    foreach ($id in $healthItems.Keys) {
        $line = ''
        if ($script:Health) { try { $line = [string]$script:Health.$id } catch { } }
        if ($line -match '^(Пауза|Середовище|Перевіряю)') { $healthItems[$id].Text = ("{0}: {1}" -f $platformNames[$id], $line); $healthItems[$id].Visible = $true } else { $healthItems[$id].Visible = $false }
    }
}

function Update-Tray {
    try {
        $now = Get-Date
        if (Test-Path -LiteralPath $WakeFile) { Remove-Item -LiteralPath $WakeFile -Force -ErrorAction SilentlyContinue; Invoke-Wake }
        if (Test-RunnerRunning) {
            $script:NextStartAt = [DateTime]::MinValue
            if ($script:Backoff -ne $BackoffStart -and ($now - $script:StartedAt).TotalSeconds -gt $BackoffResetAfter) { $script:Backoff = $BackoffStart }
            $read = Read-Status
            $state = $read[0]; $detail = $read[1]
            if ($state -eq 'stopped') { $state = 'starting'; $detail = 'Запускається…' }
            Invoke-MaybeUpdate $state
            if ($script:UpdateNote -and $now -lt $script:UpdateNoteUntil -and $state -ne 'working') { $detail = $script:UpdateNote }
        } else {
            # Runner помер сам: піднімаємо його з наростаючою паузою. У журнал трея — скільки прожив і з яким кодом вийшов.
            if ($script:NextStartAt -eq [DateTime]::MinValue) {
                $exitCode = try { if ($script:Proc -ne $null -and $script:Proc.HasExited) { $script:Proc.ExitCode } else { '?' } } catch { '?' }
                $lived = if ($script:StartedAt -gt [DateTime]::MinValue) { [int]($now - $script:StartedAt).TotalSeconds } else { 0 }
                Write-TrayLog ("Runner зупинився сам: код $exitCode, працював $lived с")
                $ran = if ($script:StartedAt -gt [DateTime]::MinValue) { ($now - $script:StartedAt).TotalSeconds } else { 0 }
                if ($ran -gt $BackoffResetAfter) { $script:Backoff = $BackoffStart }
                $script:NextStartAt = $now.AddSeconds($script:Backoff)
                $script:Backoff = [Math]::Min($script:Backoff * 2, $BackoffMax)
            }
            if ($now -ge $script:NextStartAt) { $script:NextStartAt = [DateTime]::MinValue; Start-Runner }
            $wait = if ($script:NextStartAt -gt [DateTime]::MinValue) { [Math]::Max(0, [int]($script:NextStartAt - $now).TotalSeconds) } else { 0 }
            $state = 'stopped'
            $detail = 'Runner зупинився, піднімаю знову' + $(if ($wait -gt 0) { " за $wait с" } else { '' })
            [void](Read-Status)
        }
        $title = if ($Labels.ContainsKey($state)) { $Labels[$state] } else { $state }
        $day = Update-Day
        Set-TrayIcon $(if ($Colors.ContainsKey($state)) { $state } else { 'starting' }) $day.Digits
        $tip = "Work OS runner — $title"
        if ($day.Summary) { $tip += " · $($day.Summary)" }
        Set-TrayText $tip
        # Версія runner (з пакета на диску) видна просто в меню: «Work OS runner 3.23.2 · Готовий».
        if (($now - $script:VersionReadAt).TotalSeconds -ge 30) { $script:AppVersion = Get-AppVersion; $script:VersionReadAt = $now }
        $stateItem.Text = if ($script:AppVersion) { "Work OS runner $($script:AppVersion) · $title" } else { "Work OS runner: $title" }
        $detailItem.Text = if ($detail.Length -gt 90) { $detail.Substring(0, 90) } else { $detail }
        $detailItem.Visible = [bool]$detail
        $awakeItem.Visible = ($script:Awake -and (Test-RunnerRunning))
        Update-Health
        Update-BrowserItem $state
        Update-Failures
        Start-Standby
        Invoke-SelfReplace $state
    } catch {
        Write-TrayLog ("Оновлення трея: " + $_.Exception.Message)
    }
}

# ── вихід ──────────────────────────────────────────────────────────────────────────────────────────
function Close-Tray([switch]$KeepRunner) {
    Write-TrayLog $(if ($KeepRunner) { 'Трей закривається для оновлення (runner лишається)' } else { 'Вимкнено повністю з меню' })
    try { $timer.Stop() } catch { }
    if (-not $KeepRunner) { Stop-Runner }
    try { $notify.Visible = $false; $notify.Dispose() } catch { }
    if ($script:IconHandle -ne [IntPtr]::Zero) { [void][WorkOs.Native]::DestroyIcon($script:IconHandle) }
    try { $mutex.ReleaseMutex() } catch { }
    [System.Windows.Forms.Application]::Exit()
}

function Confirm-Disable {
    $answer = [System.Windows.Forms.MessageBox]::Show(
        "Автопост, перевірки й сповіщення з ПК зупиняться. Runner і ця іконка не повернуться самі до наступного входу в систему або кнопки «Запустити runner» у Work OS (вона працює й з телефону, поки ПК увімкнений).",
        'Вимкнути Work OS runner повністю?',
        [System.Windows.Forms.MessageBoxButtons]::OKCancel, [System.Windows.Forms.MessageBoxIcon]::Warning, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
    if ($answer -eq [System.Windows.Forms.DialogResult]::OK) { Close-Tray }
}

# ── запуск ─────────────────────────────────────────────────────────────────────────────────────────
Set-TrayIcon 'starting' ''
$notify.Visible = $true
Set-TrayText 'Work OS runner — запускається'
Write-TrayLog ("Трей запущено" + $(if ($Wake) { ' (команда «Запустити runner»)' } elseif ($Replace) { ' (оновлення)' } else { '' }))
Start-Runner
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-Tray })
$timer.Start()
Update-Tray

# Перший запуск: профіль браузера порожній, вікно з QR-кодами потрібне, поки власник не увійде в WhatsApp і Telegram.
if (-not (Test-Path -LiteralPath $HintFile) -and -not (Test-Path -LiteralPath $ModeFile)) {
    try {
        Set-Content -LiteralPath $HintFile -Value (Get-Date).ToString('o')
        $notify.ShowBalloonTip(20000, 'Work OS runner', 'Увійдіть у WhatsApp і Telegram у вікні браузера runner (QR-код), потім у меню значка оберіть «Сховати браузер runner».', [System.Windows.Forms.ToolTipIcon]::Info)
    } catch { }
}

$context = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($context)
