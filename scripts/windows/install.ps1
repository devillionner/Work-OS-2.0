# Інсталятор runner Work OS для Windows (Windows PowerShell 5.1, звичайний користувач, без прав адміністратора).
# Запускається з пакета runner, який вже завантажив і перевірив public/runner/install.ps1:
#   -Site https://…   адреса Work OS (обов'язково для встановлення)
#   -Code XXXX-XXXX   одноразовий код із «Налаштування → Сервіс → Runner на цьому ПК» (прив'язка без входу вручну)
#   -Check            лише перевірити готовність і нічого не змінювати
#   -Remove [-Purge]  прибрати runner, автозапуск і посилання workos-runner:// (-Purge ще й профіль браузера, налаштування й стан)
#   -NoStart          не запускати трей після встановлення
#   -Yes              на всі питання відповідати «так» (Node, Viber Desktop, розпізнавання тексту, сон від мережі)
# Чого бракує, ставить сам: Node (портативний, з nodejs.org з перевіркою SHA-256, без прав адміністратора), Viber Desktop (winget),
# розпізнавання тексту ru-RU для Viber (одне вікно UAC). Наприкінці — список того, що лишилось зробити людині (QR-входи).
# Ідемпотентно: повторний запуск оновлює файли й налаштування, токен із runner.env лишається, поки не дано новий код.
param(
    [string]$Site = '',
    [string]$Code = '',
    [string]$PackageDir = '',
    [switch]$Check,
    [switch]$Remove,
    [switch]$Purge,
    [switch]$NoStart,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Base = Join-Path $env:LOCALAPPDATA 'WorkOS'
$RunnerDir = Join-Path $Base 'runner'
$StateDir = Join-Path $Base 'state'
$ConfigDir = Join-Path $Base 'config'
$BrowserDir = Join-Path $Base 'browser'
$RunnerEnv = Join-Path $ConfigDir 'runner.env'
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Work OS runner.lnk'
$ProtocolKey = 'HKCU:\Software\Classes\workos-runner'
$Conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$NodeMin = [version]'22.13.0'
$NodeDir = Join-Path $Base 'node'
$OcrCapability = 'Language.OCR~~~ru-RU~0.0.1.0'

function Say([string]$text) { Write-Host $text }
function Step([string]$text) { Write-Host ('▸ ' + $text) -ForegroundColor Cyan }
function Good([string]$text) { Write-Host ('  ✔ ' + $text) -ForegroundColor Green }
function Warn([string]$text) { Write-Host ('  ! ' + $text) -ForegroundColor Yellow }
function Fail([string]$text) { Write-Host ('Помилка: ' + $text) -ForegroundColor Red; exit 1 }

function Get-NodePath {
    # Спершу системний Node (якщо досить новий), інакше портативний у %LOCALAPPDATA%\WorkOS\node, який ставить цей інсталятор.
    $portable = Join-Path $NodeDir 'node.exe'
    $found = Get-Command node -ErrorAction SilentlyContinue
    if ($found -and (Get-NodeVersion $found.Source) -ge $NodeMin) { return $found.Source }
    if (Test-Path -LiteralPath $portable) { return $portable }
    if ($found) { return $found.Source }
    return ''
}

function Ask([string]$question, [bool]$default = $true) {
    if ($Yes) { return $true }
    $hint = if ($default) { '[Т/н]' } else { '[т/Н]' }
    $answer = ''
    try { $answer = Read-Host ('  ' + $question + ' ' + $hint) } catch { return $default }
    if (-not $answer) { return $default }
    return ($answer.Trim().ToLower() -match '^(т|так|y|yes|д|да)$')
}

# Портативний Node LTS з nodejs.org: zip, звірка SHA-256 із SHASUMS256.txt того ж випуску до розпакування. Без прав адміністратора.
function Install-PortableNode {
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
    $pick = $index | Where-Object { $_.lts -and ([version]($_.version.TrimStart('v'))) -ge $NodeMin -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
    if (-not $pick) { throw 'на nodejs.org не знайшлось придатного випуску LTS' }
    $ver = $pick.version
    $name = "node-$ver-win-x64.zip"
    $work = Join-Path ([IO.Path]::GetTempPath()) ('wos-node-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    try {
        $zip = Join-Path $work $name
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$ver/$name" -OutFile $zip
        $sums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$ver/SHASUMS256.txt").Content
        if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
        $line = ([string]$sums -split "`n") | Where-Object { $_ -match ('\s' + [regex]::Escape($name) + '\s*$') } | Select-Object -First 1
        $expected = ([regex]::Match([string]$line, '^[0-9a-f]{64}')).Value
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
        if (-not $expected -or $expected -ne $actual) { throw 'контрольна сума Node не збіглась, нічого не розпаковано' }
        & (Join-Path $env:SystemRoot 'System32\tar.exe') -xf $zip -C $work
        if ($LASTEXITCODE -ne 0) { throw 'не вдалося розпакувати Node' }
        if (Test-Path -LiteralPath $NodeDir) { Remove-Item -LiteralPath $NodeDir -Recurse -Force }
        Move-Item -LiteralPath (Join-Path $work "node-$ver-win-x64") -Destination $NodeDir
    } finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    return (Join-Path $NodeDir 'node.exe')
}

function Get-ViberPath {
    foreach ($candidate in @((Join-Path $env:LOCALAPPDATA 'Viber\Viber.exe'), (Join-Path $env:ProgramFiles 'Viber\Viber.exe'))) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return ''
}

# Viber Desktop увійшов (прив'язаний до телефону): у %APPDATA%\ViberPC з'являється тека з номером телефону.
function Test-ViberActivated {
    $root = Join-Path $env:APPDATA 'ViberPC'
    return [bool](Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d{6,}$' } | Select-Object -First 1)
}

# Мови розпізнавання тексту Windows (потрібна ru-RU: нею Viber Desktop читає назви чатів). Через WinRT, як у viber-vision.ps1.
function Get-OcrLanguages {
    try {
        [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
        return @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
    } catch { return @() }
}

# Хвилини до сну від мережі (0 — ніколи, -1 — невідомо). Поки ПК спить, кнопка «Запустити runner» з телефону до нього не дійде.
function Get-AcSleepMinutes {
    try {
        $out = & powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null
        $hex = @($out | ForEach-Object { if ($_ -match ':\s*0x([0-9a-fA-F]{8})\s*$') { $Matches[1] } })
        if ($hex.Count -ge 2) { return [int]([Convert]::ToInt64($hex[$hex.Count - 2], 16) / 60) }
    } catch { }
    return -1
}

function Get-StandbyRunning {
    return [bool](Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*runner-standby.mjs*' } | Select-Object -First 1)
}

# Інсталятор, запущений із програми в пакеті MSIX (Claude Desktop, вбудовані термінали), пише в AppData не туди: Windows перенаправляє
# такі записи в %LOCALAPPDATA%\Packages\...\LocalCache, і автозапуск веде в порожню теку. Перевіряємо пробним файлом.
function Test-Virtualized {
    $probe = 'WorkOS-probe-' + [guid]::NewGuid().ToString('N')
    $path = Join-Path $env:LOCALAPPDATA $probe
    try {
        Set-Content -LiteralPath $path -Value 'probe' -ErrorAction Stop
        # Пошук за шаблоном шляху (Packages\*\…) пробного файла не знаходив (перевірено 27.11), тож перебираємо теки пакетів.
        foreach ($package in Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -ErrorAction SilentlyContinue) {
            if (Test-Path -LiteralPath (Join-Path $package.FullName ('LocalCache\Local\' + $probe))) { return $true }
        }
        return $false
    } catch { return $false } finally { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}

# Розпізнавання тексту російською є (Windows називає мову і «ru», і «ru-RU»).
function Test-OcrRussian {
    return [bool](@(Get-OcrLanguages) | Where-Object { $_ -like 'ru*' } | Select-Object -First 1)
}

function Get-NodeVersion([string]$node) {
    try { return [version](((& $node -v) -replace '^v', '').Trim()) } catch { return $null }
}

function Get-BrowserPath {
    $roots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA) | Where-Object { $_ }
    foreach ($relative in @('Microsoft\Edge\Application\msedge.exe', 'Google\Chrome\Application\chrome.exe')) {
        foreach ($root in $roots) {
            $candidate = Join-Path $root $relative
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
    }
    return ''
}

function Grant-OwnerAccess([string]$path, [string]$rights) {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $path /grant:r ('{0}:{1}' -f $me, $rights) 2>&1 | Out-Null
}

function Read-Env {
    $values = [ordered]@{}
    if (Test-Path -LiteralPath $RunnerEnv) {
        try { $lines = [IO.File]::ReadAllLines($RunnerEnv, [Text.Encoding]::UTF8) }
        catch {
            # Власник файла завжди може повернути собі доступ (так було б після невдалого обмеження прав): відновлюємо й читаємо ще раз.
            Grant-OwnerAccess $RunnerEnv 'F'
            $lines = [IO.File]::ReadAllLines($RunnerEnv, [Text.Encoding]::UTF8)
        }
        foreach ($line in $lines) {
            if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $values[$Matches[1]] = $Matches[2] }
        }
    }
    return $values
}

function Write-Env($values) {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $lines = foreach ($key in $values.Keys) { '{0}={1}' -f $key, $values[$key] }
    [IO.File]::WriteAllLines($RunnerEnv, [string[]]@($lines), (New-Object Text.UTF8Encoding $false))
    # Токен лише для цього користувача: прибираємо успадковані права й даємо читання/запис лише йому.
    # Увага: прапорці (OI)(CI) на файлі роблять запис лише успадковуваним і залишають файл без чинних прав, тож для файла вони не потрібні.
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $ConfigDir /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $me) 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Warn "не вдалося обмежити права на $ConfigDir" }
    & icacls.exe $RunnerEnv /inheritance:r /grant:r ('{0}:F' -f $me) 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Warn "не вдалося обмежити права на $RunnerEnv" }
}

function Get-TrayProcesses {
    # Скрипт трея запущено через powershell.exe: шукаємо за командним рядком (один виклик CIM на встановлення чи видалення).
    return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*work-os-runner-tray.ps1*' })
}

function Get-RunnerLockPid {
    try {
        $lock = Get-Content -LiteralPath (Join-Path $StateDir 'runner.lock') -Raw -Encoding UTF8 | ConvertFrom-Json
        $p = Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq 'node') { return [int]$lock.pid }
    } catch { }
    return 0
}

function Stop-RunnerSide {
    # Спершу трей (інакше він підніме runner знову), потім runner. Браузер runner не чіпаємо: його закриває лише -Remove.
    foreach ($tray in Get-TrayProcesses) { Stop-Process -Id $tray.ProcessId -Force -ErrorAction SilentlyContinue }
    $runnerPid = Get-RunnerLockPid
    if ($runnerPid -gt 0) { Stop-Process -Id $runnerPid -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath (Join-Path $StateDir 'runner.lock') -Force -ErrorAction SilentlyContinue
    # Черговий (кнопка «Запустити runner» з телефону): нова копія стартує разом із треєм.
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*runner-standby.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 700
}

function Test-Port([int]$port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $task = $client.ConnectAsync('127.0.0.1', $port); return ($task.Wait(800) -and $client.Connected) } catch { return $false } finally { $client.Close() }
}

function New-StartupShortcut {
    $tray = Join-Path $RunnerDir 'scripts\windows\work-os-runner-tray.ps1'
    $arguments = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $tray + '"'
    try {
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut($ShortcutPath)
        $link.TargetPath = $Conhost
        $link.Arguments = $arguments
        $link.WorkingDirectory = $StateDir
        $link.WindowStyle = 7
        $link.Description = 'Work OS runner'
        $link.Save()
        Good 'автозапуск: ярлик у теці «Автозавантаження»'
    } catch {
        # Запасний шлях: завдання Планувальника на вхід поточного користувача (прав адміністратора не потрібно).
        $action = New-ScheduledTaskAction -Execute $Conhost -Argument $arguments
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        Register-ScheduledTask -TaskName 'Work OS runner' -Action $action -Trigger $trigger -Force | Out-Null
        Good 'автозапуск: завдання Планувальника «Work OS runner»'
    }
}

function Set-ProtocolHandler {
    $tray = Join-Path $RunnerDir 'scripts\windows\work-os-runner-tray.ps1'
    New-Item -Path $ProtocolKey -Force | Out-Null
    Set-ItemProperty -Path $ProtocolKey -Name '(default)' -Value 'URL:Work OS runner'
    Set-ItemProperty -Path $ProtocolKey -Name 'URL Protocol' -Value ''
    New-Item -Path (Join-Path $ProtocolKey 'shell\open\command') -Force | Out-Null
    $command = '"{0}" --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{1}" -Wake' -f $Conhost, $tray
    Set-ItemProperty -Path (Join-Path $ProtocolKey 'shell\open\command') -Name '(default)' -Value $command
    Good 'посилання workos-runner://start зареєстровано (кнопка «Запустити runner» у Work OS)'
}

# ── -Check ────────────────────────────────────────────────────────────────────────────────────────
if ($Check) {
    $problems = 0
    Step 'Перевірка runner на цьому ПК'
    $node = Get-NodePath
    $nodeVersion = if ($node) { Get-NodeVersion $node } else { $null }
    if ($nodeVersion -and $nodeVersion -ge $NodeMin) { Good "Node $nodeVersion ($node)" } else { Warn "потрібен Node $NodeMin або новіший"; $problems++ }
    $browser = Get-BrowserPath
    if ($browser) { Good "браузер: $browser" } else { Warn 'не знайдено Edge чи Chrome'; $problems++ }
    $package = Join-Path $RunnerDir 'RUNNER-PACKAGE.json'
    if (Test-Path -LiteralPath $package) { Good ('runner ' + (Get-Content -LiteralPath $package -Raw -Encoding UTF8 | ConvertFrom-Json).version + " у $RunnerDir") } else { Warn 'runner не встановлено'; $problems++ }
    $values = Read-Env
    if ($values['WORK_OS_URL']) { Good ('сайт: ' + $values['WORK_OS_URL']) } else { Warn 'у runner.env немає адреси сайту'; $problems++ }
    if ($values['WORK_OS_EXECUTOR_TOKEN']) { Good 'токен прив''язки є' } else { Warn 'токена прив''язки немає (створіть код у Work OS і повторіть встановлення)'; $problems++ }
    if (Test-Path -LiteralPath $ShortcutPath) { Good 'автозапуск налаштовано' } else { Warn 'автозапуску немає'; $problems++ }
    if (Test-Path $ProtocolKey) { Good 'посилання workos-runner:// зареєстровано' } else { Warn 'посилання workos-runner:// не зареєстровано'; $problems++ }
    if (@(Get-TrayProcesses).Count -gt 0) { Good 'трей працює' } else { Warn 'трей не запущений'; $problems++ }
    if (Test-Port 9222) { Good 'браузер runner відповідає на порту 9222' } else { Warn 'браузер runner не відповідає на порту 9222' }
    if (Get-StandbyRunning) { Good 'черговий працює: «Запустити runner» з телефону дійде' } else { Warn 'черговий не працює: з телефону runner не запустити (він стартує разом зі значком у треї)' }
    $viber = Get-ViberPath
    if (-not $viber) { Warn 'Viber Desktop не встановлено (потрібен для автопосту Viber)'; $problems++ }
    elseif (Test-ViberActivated) { Good 'Viber Desktop встановлено й увійдено' }
    else { Warn 'Viber Desktop встановлено, але не увійдено: відкрий його й увійди QR-кодом з телефону'; $problems++ }
    if ((Test-OcrRussian)) { Good 'розпізнавання тексту ru-RU є' } else { Warn 'немає розпізнавання тексту ru-RU (без нього Viber не перевіряє назви чатів): повтори встановлення, воно поставить'; $problems++ }
    $sleep = Get-AcSleepMinutes
    if ($sleep -eq 0) { Good 'від мережі ноутбук не засинає' } elseif ($sleep -gt 0) { Warn "від мережі ноутбук засинає через $sleep хв: поки спить, runner не працює й з телефону не запуститься" }
    try {
        $status = Get-Content -LiteralPath (Join-Path $StateDir 'runner-status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        Say ('  стан runner: {0} — {1}' -f $status.state, $status.detail)
    } catch { Say '  стан runner: файла стану ще немає' }
    if ($problems -gt 0) { Say ''; Say "Потребує уваги: $problems. Команду встановлення з кодом дає «Налаштування → Сервіс → Runner на цьому ПК»."; exit 1 }
    Say ''; Say 'Усе готово.'
    exit 0
}

# ── -Remove ───────────────────────────────────────────────────────────────────────────────────────
if ($Remove) {
    Step 'Прибираю Work OS runner'
    Stop-RunnerSide
    $node = Get-NodePath
    $launcher = Join-Path $RunnerDir 'scripts\platform\windows-launch.mjs'
    if ($node -and (Test-Path -LiteralPath $launcher)) { try { & $node $launcher --close-browser | Out-Null } catch { } }
    Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue
    try { Unregister-ScheduledTask -TaskName 'Work OS runner' -Confirm:$false -ErrorAction Stop } catch { }
    Remove-Item -Path $ProtocolKey -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $RunnerDir -Recurse -Force -ErrorAction SilentlyContinue
    Good 'runner, автозапуск і посилання workos-runner:// прибрано'
    if ($Purge) {
        Remove-Item -LiteralPath $BrowserDir, $StateDir, $ConfigDir -Recurse -Force -ErrorAction SilentlyContinue
        Good 'профіль браузера runner, налаштування й стан видалено'
    } else {
        Say '  Профіль браузера (входи WhatsApp і Telegram), налаштування й стан лишилися; повне прибирання: -Remove -Purge.'
    }
    exit 0
}

# ── встановлення ──────────────────────────────────────────────────────────────────────────────────
if ($PSVersionTable.PSVersion.Major -lt 5) { Fail 'потрібен Windows PowerShell 5.1 або новіший.' }
if (Test-Virtualized) { Fail 'це вікно запущене з програми в пакеті (Claude чи інша програма з Microsoft Store): Windows перенаправляє її файли, і runner встановився б не туди. Відкрий Win+X → «Термінал» і встав команду там.' }
if (-not $Site) { Fail 'вкажіть адресу сайту: -Site https://…  (команду з готовою адресою й кодом дає «Налаштування → Сервіс → Runner на цьому ПК»)' }
$Site = $Site.TrimEnd('/')
if ($Site -notmatch '^(https://|http://localhost|http://127\.0\.0\.1)') { Fail 'адреса сайту має починатись з https://' }

Step 'Перевіряю, чого бракує'
$node = Get-NodePath
$nodeVersion = if ($node) { Get-NodeVersion $node } else { $null }
if (-not $nodeVersion -or $nodeVersion -lt $NodeMin) {
    Say $(if ($node) { "  Node $nodeVersion застарий (потрібен $NodeMin або новіший)." } else { '  Node.js не знайдено.' })
    if (-not (Ask 'Поставити Node окремо для runner (з nodejs.org, без прав адміністратора)?')) { Fail "без Node $NodeMin або новішого runner не працює." }
    try { $node = Install-PortableNode } catch { Fail ('не вдалося поставити Node: ' + $_.Exception.Message) }
    $nodeVersion = Get-NodeVersion $node
    if (-not $nodeVersion -or $nodeVersion -lt $NodeMin) { Fail 'Node поставився, але не запускається.' }
}
Good "Node $nodeVersion ($node)"
$browser = Get-BrowserPath
if (-not $browser) { Fail 'не знайдено Edge чи Chrome. Runner працює через браузер з окремим профілем.' }
Good "браузер: $browser"

$source = if ($PackageDir) { (Resolve-Path -LiteralPath $PackageDir).Path } else { (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) }
if (-not (Test-Path -LiteralPath (Join-Path $source 'scripts\chat-discovery-runner.mjs'))) { Fail 'пакет неповний: немає файлів runner.' }

Step 'Зупиняю попередній runner (якщо був) і розкладаю файли'
New-Item -ItemType Directory -Force -Path $RunnerDir, $StateDir, $ConfigDir | Out-Null
Stop-RunnerSide
if ((Resolve-Path -LiteralPath $source).Path -ne (Resolve-Path -LiteralPath $RunnerDir).Path) {
    & robocopy.exe $source $RunnerDir /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "не вдалося скопіювати файли runner (robocopy $LASTEXITCODE)." }
}
$version = ''
try { $version = (Get-Content -LiteralPath (Join-Path $RunnerDir 'RUNNER-PACKAGE.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
Good ("runner $version у $RunnerDir")

Step 'Прив''язка до Work OS'
$values = Read-Env
$values['WORK_OS_URL'] = $Site
$values['WORK_OS_BROWSER_PROFILE'] = $BrowserDir
$values['WORK_OS_NODE'] = $node
if ($Code) {
    $hostName = ($env:COMPUTERNAME -replace '[^A-Za-z0-9._ -]', '')
    $body = [Text.Encoding]::UTF8.GetBytes((@{ action = 'redeem'; code = $Code; host = $hostName } | ConvertTo-Json -Compress))
    try {
        $reply = Invoke-RestMethod -Method Post -Uri "$Site/api/runner/enroll" -ContentType 'application/json' -Body $body
    } catch {
        $detail = ''
        try { $detail = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
        Fail ($(if ($detail) { $detail } else { 'не вдалося зв''язатися з Work OS: ' + $_.Exception.Message }))
    }
    if (-not $reply.token) { Fail 'Work OS не повернув токен прив''язки.' }
    $values['WORK_OS_EXECUTOR_TOKEN'] = $reply.token
    Good 'код прийнято, токен записано (тільки для вашого облікового запису Windows)'
} elseif ($values['WORK_OS_EXECUTOR_TOKEN']) {
    Good 'токен прив''язки лишився з попереднього встановлення'
} else {
    Warn 'коду немає: runner спробує прочитати токен зі сторінки Work OS у своєму браузері (увійдіть у Work OS у вікні runner і натисніть «Підключити цей браузер»).'
}
Write-Env $values

Step 'Viber Desktop і розпізнавання тексту'
$viber = Get-ViberPath
if (-not $viber) {
    Say '  Viber Desktop не встановлено: без нього автопост Viber не працює.'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget -and (Ask 'Встановити Viber Desktop зараз (winget)?')) {
        & $winget.Source install --id Rakuten.Viber -e --scope user --accept-source-agreements --accept-package-agreements
        $viber = Get-ViberPath
    }
    if ($viber) { Good "Viber Desktop: $viber" } else { Warn 'Viber Desktop не встановлено: постав його з viber.com/download і повтори встановлення (або працюй без Viber)' }
} else { Good "Viber Desktop: $viber" }
if ((Test-OcrRussian)) {
    Good 'розпізнавання тексту ru-RU є'
} else {
    Say '  Немає розпізнавання тексту ru-RU: ним Viber Desktop читає назви чатів (українського пакета у Windows немає).'
    if (Ask 'Поставити його зараз? Windows спитає дозвіл адміністратора (одне вікно).') {
        try {
            Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList @('-NoProfile', '-Command', "Add-WindowsCapability -Online -Name '$OcrCapability' | Out-Null")
        } catch { Warn 'дозвіл не дали: розпізнавання тексту не поставлено' }
    }
    if ((Test-OcrRussian)) { Good 'розпізнавання тексту ru-RU поставлено' } else { Warn 'розпізнавання тексту ru-RU немає: Viber не працюватиме, поки його не поставлено (повтори встановлення)' }
}

Step 'Сон ноутбука'
$sleep = Get-AcSleepMinutes
if ($sleep -eq 0) {
    Good 'від мережі ноутбук не засинає'
} elseif ($sleep -gt 0) {
    Say "  Від мережі ноутбук засинає через $sleep хв. Поки ПК спить, runner не працює, і кнопка «Запустити runner» з телефону до нього не дійде."
    if (Ask 'Вимкнути сон від мережі (від батареї все лишиться як було)?') {
        & powercfg.exe /change standby-timeout-ac 0
        if ((Get-AcSleepMinutes) -eq 0) { Good 'від мережі ноутбук тепер не засинає (екран гасне, як і раніше)' } else { Warn 'не вдалося змінити налаштування сну: зміни в «Параметри → Система → Живлення»' }
    }
}

Step 'Автозапуск і посилання'
New-StartupShortcut
Set-ProtocolHandler

if (-not $NoStart) {
    Step 'Запускаю трей'
    $tray = Join-Path $RunnerDir 'scripts\windows\work-os-runner-tray.ps1'
    Start-Process -FilePath $Conhost -ArgumentList ('--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $tray + '"') -WindowStyle Hidden
    Good 'трей запущено: значок з''явиться біля годинника'
}

Say ''
Say 'Готово. Лишилось зробити вручну:'
$todo = 0
$freshProfile = -not (Test-Path -LiteralPath (Join-Path $BrowserDir 'Default'))
if ($freshProfile) {
    $todo++; Say "  $todo. У вікні браузера runner, яке відкриється, увійди у WhatsApp Web і Telegram Web (QR-код з телефону)."
    $todo++; Say "  $todo. У меню значка runner біля годинника обери «Сховати браузер runner»: далі він працюватиме без вікна."
}
if ($viber -and -not (Test-ViberActivated)) { $todo++; Say "  $todo. Відкрий Viber Desktop і увійди QR-кодом з телефону (Viber на телефоні → QR-сканер)." }
if (-not $viber) { $todo++; Say "  $todo. Постав Viber Desktop і увійди в нього (або працюй без Viber)." }
if ($todo -eq 0) { Say '  нічого: входи збережені, runner підключиться сам.' }
Say ''
Say 'Перевірити все одним кроком: та сама команда з -Check замість -Code.'
exit 0
