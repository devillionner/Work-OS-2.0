# Системний діалог вибору файла Viber Desktop («Send a file», клас #32770). UI Automation цього діалогу не бачить (порожні нащадки), тож він береться
# через Win32: вікно того самого процесу Viber, поле імені файла (Edit, id 1148) і кнопка «Open» (id 1). Текст пишеться WM_SETTEXT, кнопка тисне BM_CLICK:
# вікно не активується й фокус у людини не забирається. Відповідь — один рядок JSON.
#   find     чи відкрито діалог (-WaitSeconds до скількох секунд чекати)
#   pick     вписати повний шлях (-Path) і натиснути «Open»
#   cancel   закрити діалог кнопкою «Cancel» (id 2), нічого не вибираючи
param(
    [Parameter(Mandatory = $true)][ValidateSet('find', 'pick', 'cancel')][string]$Command,
    [string]$Path = '',
    [int]$WaitSeconds = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class VD {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string Cls(IntPtr h) { var c = new StringBuilder(256); GetClassName(h, c, 256); return c.ToString(); }
  public static IntPtr FindDialog(HashSet<uint> pids) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pids.Contains(pid) && IsWindowVisible(h) && Cls(h) == "#32770") { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static IntPtr FindChild(IntPtr dlg, string cls, int id) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(dlg, (h, l) => { if (GetDlgCtrlID(h) == id && Cls(h) == cls && IsWindowVisible(h)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
'@
function Reply($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 4)); exit 0 }

$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
Get-Process -Name Viber -ErrorAction SilentlyContinue | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }
if ($pids.Count -eq 0) { Reply @{ ok = $false; reason = 'viber_desktop_not_running' } }

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$dialog = [IntPtr]::Zero
do {
    $dialog = [VD]::FindDialog($pids)
    if ($dialog -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if ($dialog -eq [IntPtr]::Zero) { Reply @{ ok = $false; found = $false; reason = 'file_dialog_not_found' } }

switch ($Command) {
    'find' { Reply @{ ok = $true; found = $true } }
    'cancel' {
        $cancel = [VD]::FindChild($dialog, 'Button', 2)
        if ($cancel -ne [IntPtr]::Zero) { [void][VD]::SendMessage($cancel, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) }
        Reply @{ ok = ($cancel -ne [IntPtr]::Zero) }
    }
    'pick' {
        if (-not $Path -or -not [System.IO.Path]::IsPathRooted($Path)) { Reply @{ ok = $false; reason = 'path_must_be_absolute' } }
        $edit = [VD]::FindChild($dialog, 'Edit', 1148)
        $open = [VD]::FindChild($dialog, 'Button', 1)
        if ($edit -eq [IntPtr]::Zero -or $open -eq [IntPtr]::Zero) { Reply @{ ok = $false; reason = 'file_dialog_controls_missing' } }
        [void][VD]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $Path)   # WM_SETTEXT
        Start-Sleep -Milliseconds 300
        [void][VD]::SendMessage($open, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)   # BM_CLICK
        Reply @{ ok = $true }
    }
}
