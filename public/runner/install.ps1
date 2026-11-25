# Work OS runner for Windows: one-line installer bootstrap (ASCII only on purpose).
#   & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString((iwr -UseBasicParsing 'https://SITE/runner/install.ps1').RawContentStream.ToArray()))) -Site 'https://SITE' -Code 'XXXX-XXXX'
# Other modes: -Check (read-only check), -Remove [-Purge], -NoStart.
# This file only downloads the runner package from the same site, verifies its SHA-256 BEFORE unpacking and starts the real installer
# (scripts\windows\install.ps1 inside the package, UTF-8 with BOM, messages in Ukrainian). Windows PowerShell 5.1, no administrator rights.
# It never calls "exit" at the top level: a scriptblock started from an open console must not close the user's window.
param(
    [string]$Site = '',
    [string]$Code = '',
    [switch]$Check,
    [switch]$Remove,
    [switch]$Purge,
    [switch]$NoStart
)

function Install-WorkOsRunner {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

    function Stop-Here([string]$text) { Write-Host ('Error: ' + $text) -ForegroundColor Red; $global:LASTEXITCODE = 1 }

    if ($env:OS -ne 'Windows_NT') { Stop-Here 'this installer is for Windows only (Linux: use the install script from the same page).'; return }
    $runnerDir = Join-Path (Join-Path $env:LOCALAPPDATA 'WorkOS') 'runner'
    $installed = Join-Path $runnerDir 'scripts\windows\install.ps1'
    $common = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')

    # -Check and -Remove work with the runner that is already installed (no download).
    if ($Check -or $Remove) {
        if (-not (Test-Path -LiteralPath $installed)) {
            if ($Remove) { Write-Host 'Work OS runner is not installed: nothing to remove.'; $global:LASTEXITCODE = 0; return }
            Stop-Here ('runner is not installed in ' + $runnerDir); return
        }
        $extra = @()
        if ($Site) { $extra += @('-Site', $Site) }
        if ($Check) { $extra += '-Check' }
        if ($Remove) { $extra += '-Remove' }
        if ($Purge) { $extra += '-Purge' }
        & powershell.exe ($common + @($installed) + $extra)
        return
    }

    if (-not $Site) { Stop-Here 'pass the site address: -Site https://...  (the ready command with address and code is shown in Settings > Service > Runner on this PC)'; return }
    $Site = $Site.TrimEnd('/')
    if ($Site -notmatch '^(https://|http://localhost|http://127\.0\.0\.1)') { Stop-Here 'the site address must start with https://'; return }
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tar)) { Stop-Here 'tar.exe was not found (Windows 10 1803 or newer is required).'; return }

    $work = Join-Path ([IO.Path]::GetTempPath()) ('wos-runner-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    try {
        Write-Host ('> Downloading the runner package from ' + $Site)
        Invoke-WebRequest -UseBasicParsing -Uri ($Site + '/runner/runner.tar.gz') -OutFile (Join-Path $work 'runner.tar.gz')
        $shaReply = (Invoke-WebRequest -UseBasicParsing -Uri ($Site + '/runner/runner.sha256')).Content
        if ($shaReply -is [byte[]]) { $shaReply = [Text.Encoding]::ASCII.GetString($shaReply) }
        $expected = ([regex]::Match([string]$shaReply, '[0-9a-fA-F]{64}')).Value.ToLower()
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $work 'runner.tar.gz')).Hash.ToLower()
        if (-not $expected -or $expected -ne $actual) { Stop-Here 'the package checksum does not match; nothing was unpacked.'; return }
        Write-Host ('  OK SHA-256 matches (' + $actual.Substring(0, 12) + '...)')

        $package = Join-Path $work 'package'
        New-Item -ItemType Directory -Force -Path $package | Out-Null
        & $tar -xzf (Join-Path $work 'runner.tar.gz') -C $package
        if ($LASTEXITCODE -ne 0) { Stop-Here 'the package could not be unpacked.'; return }
        $realInstaller = Join-Path $package 'scripts\windows\install.ps1'
        if (-not (Test-Path -LiteralPath $realInstaller)) { Stop-Here 'this package has no Windows installer (the site is older than the Windows runner).'; return }

        $arguments = @('-Site', $Site, '-PackageDir', $package)
        if ($Code) { $arguments += @('-Code', $Code) }
        if ($NoStart) { $arguments += '-NoStart' }
        & powershell.exe ($common + @($realInstaller) + $arguments)
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Install-WorkOsRunner
