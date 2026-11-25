# Інсталятор runner Work OS для Windows (Windows PowerShell 5.1, звичайний користувач, без прав адміністратора).
# Запускається з пакета runner, який вже завантажив і перевірив public/runner/install.ps1:
#   -Site https://…   адреса Work OS (обов'язково для встановлення)
#   -Code XXXX-XXXX   одноразовий код із «Налаштування → Сервіс → Runner на цьому ПК» (прив'язка без входу вручну)
#   -Check            лише перевірити готовність і нічого не змінювати
#   -Remove [-Purge]  прибрати runner, автозапуск і посилання workos-runner:// (-Purge ще й профіль браузера, налаштування й стан)
#   -NoStart          не запускати трей після встановлення
# Ідемпотентно: повторний запуск оновлює файли й налаштування, токен із runner.env лишається, поки не дано новий код.
param(
    [string]$Site = '',
    [string]$Code = '',
    [string]$PackageDir = '',
    [switch]$Check,
    [switch]$Remove,
    [switch]$Purge,
    [switch]$NoStart
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

function Say([string]$text) { Write-Host $text }
function Step([string]$text) { Write-Host ('▸ ' + $text) -ForegroundColor Cyan }
function Good([string]$text) { Write-Host ('  ✔ ' + $text) -ForegroundColor Green }
function Warn([string]$text) { Write-Host ('  ! ' + $text) -ForegroundColor Yellow }
function Fail([string]$text) { Write-Host ('Помилка: ' + $text) -ForegroundColor Red; exit 1 }

function Get-NodePath {
    $found = Get-Command node -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    return ''
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
        $lock = Get-Content -LiteralPath (Join-Path $StateDir 'runner.lock') -Raw | ConvertFrom-Json
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
    if (Test-Path -LiteralPath $package) { Good ('runner ' + (Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version + " у $RunnerDir") } else { Warn 'runner не встановлено'; $problems++ }
    $values = Read-Env
    if ($values['WORK_OS_URL']) { Good ('сайт: ' + $values['WORK_OS_URL']) } else { Warn 'у runner.env немає адреси сайту'; $problems++ }
    if ($values['WORK_OS_EXECUTOR_TOKEN']) { Good 'токен прив''язки є' } else { Warn 'токена прив''язки немає (створіть код у Work OS і повторіть встановлення)'; $problems++ }
    if (Test-Path -LiteralPath $ShortcutPath) { Good 'автозапуск налаштовано' } else { Warn 'автозапуску немає'; $problems++ }
    if (Test-Path $ProtocolKey) { Good 'посилання workos-runner:// зареєстровано' } else { Warn 'посилання workos-runner:// не зареєстровано'; $problems++ }
    if ((Get-TrayProcesses).Count -gt 0) { Good 'трей працює' } else { Warn 'трей не запущений'; $problems++ }
    if (Test-Port 9222) { Good 'браузер runner відповідає на порту 9222' } else { Warn 'браузер runner не відповідає на порту 9222' }
    try {
        $status = Get-Content -LiteralPath (Join-Path $StateDir 'runner-status.json') -Raw | ConvertFrom-Json
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
if (-not $Site) { Fail 'вкажіть адресу сайту: -Site https://…  (команду з готовою адресою й кодом дає «Налаштування → Сервіс → Runner на цьому ПК»)' }
$Site = $Site.TrimEnd('/')
if ($Site -notmatch '^(https://|http://localhost|http://127\.0\.0\.1)') { Fail 'адреса сайту має починатись з https://' }

Step 'Перевіряю, чого бракує'
$node = Get-NodePath
if (-not $node) { Fail ("не знайдено Node.js. Встановіть його (потрібен $NodeMin або новіший) і повторіть: winget install OpenJS.NodeJS.LTS") }
$nodeVersion = Get-NodeVersion $node
if (-not $nodeVersion -or $nodeVersion -lt $NodeMin) { Fail "Node $nodeVersion застарий: потрібен $NodeMin або новіший (winget upgrade OpenJS.NodeJS.LTS)." }
Good "Node $nodeVersion"
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
try { $version = (Get-Content -LiteralPath (Join-Path $RunnerDir 'RUNNER-PACKAGE.json') -Raw | ConvertFrom-Json).version } catch { }
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
Say 'Готово. Що далі:'
Say '  1. У вікні браузера runner, яке відкриється, увійдіть у WhatsApp Web і Telegram Web (QR-код).'
Say '  2. У меню значка в треї оберіть «Сховати браузер runner»: далі він працюватиме без вікна.'
Say '  3. У Work OS runner з''явиться як підключений. Перевірка: scripts\windows\install.ps1 -Check'
exit 0
