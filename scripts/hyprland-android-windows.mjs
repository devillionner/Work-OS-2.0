// Вікна Android не повинні з'являтись на робочому столі під час автопосту (2026-11-02). У Waydroid `persist.waydroid.multi_windows`
// = true: кожен екран Android (Viber, екранна клавіатура) стає окремим вікном Wayland, яке Hyprland розкладає на поточному столі й
// віддає йому фокус (клас `waydroid.com.viber.voip`, `waydroid.InputMethod`). Виправлення — правило Hyprland: вікна цих класів
// ідуть тихо на прихований спеціальний стіл `special:workos` і фокус не беруть. Android працює так само: його вікна лишаються,
// просто не видно. Правило ставиться під час роботи (`hyprctl repl`, Lua-конфіг Hyprland 0.55+), файлів власника не чіпає, а
// після перезавантаження конфігу Hyprland ставиться знову при найближчій задачі. Вікно, яке власник відкриває сам
// («Відкрити вікно» → `waydroid show-full-ui`), має клас `Waydroid` (великою, без крапки) і правилом не зачіпається.
import { execFile } from 'node:child_process';

const RECHECK_MS = 60_000;
const HYPRCTL_TIMEOUT_MS = 4_000;
// `_G` у Lua-стані Hyprland живе до перезавантаження конфігу: другий виклик нічого не додає. Клас Hyprland зіставляє повністю (не за частиною
// рядка), тож шаблон закінчується на `.*`: `^waydroid\\.` без кінця не збігався з `waydroid.com.viber.voip`.
const APPLY_LUA = String.raw`if _G.__work_os_android_hidden_v2 then return "present" end if _G.__work_os_android_hidden then _G.__work_os_android_hidden:set_enabled(false) end _G.__work_os_android_hidden_v2 = hl.window_rule({ name = "work-os-android-hidden-v2", match = { class = "^waydroid\\..*$" }, workspace = "special:workos silent", no_focus = true, no_initial_focus = true }) return "applied"`;

let enabled = process.platform === 'linux';
let checkedAt = 0;
let announced = false;

function hyprctl(args, env = process.env) {
  return new Promise((resolve) => {
    execFile('hyprctl', args, { timeout: HYPRCTL_TIMEOUT_MS, encoding: 'utf8', env }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    });
  });
}

/** Підпис живого Hyprland: змінна середовища runner застаріває, коли Hyprland перезапустили. */
async function liveSignature() {
  const { HYPRLAND_INSTANCE_SIGNATURE: _stale, ...clean } = process.env;
  const result = await hyprctl(['instances', '-j'], clean);
  try { return JSON.parse(result.stdout)?.[0]?.instance || null; } catch { return null; }
}

/**
 * Гарантує правило «вікна Android — на прихований стіл». Дешево (раз на хвилину один виклик hyprctl), помилки не кидає:
 * без Hyprland автопост працює як працював.
 * @returns {Promise<'applied'|'present'|'cached'|'unavailable'>}
 */
export async function hideAndroidWindows(now = Date.now()) {
  if (!enabled) return 'unavailable';
  if (now - checkedAt < RECHECK_MS) return 'cached';
  checkedAt = now;
  let result = await hyprctl(['repl', APPLY_LUA]);
  if (result.error?.code === 'ENOENT') { enabled = false; return 'unavailable'; }
  if (result.error) {
    const signature = await liveSignature();
    if (signature) result = await hyprctl(['repl', APPLY_LUA], { ...process.env, HYPRLAND_INSTANCE_SIGNATURE: signature });
  }
  if (result.error || !/^(applied|present)/.test(result.stdout)) { checkedAt = 0; return 'unavailable'; }
  if (result.stdout.startsWith('applied') && !announced) {
    announced = true;
    console.log('Вікна Android (Waydroid) ховаються на спеціальному столі special:workos: правило Hyprland додано.');
  }
  return result.stdout.startsWith('applied') ? 'applied' : 'present';
}
