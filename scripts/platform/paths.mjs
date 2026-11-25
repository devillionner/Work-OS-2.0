// Єдине місце, де runner дізнається, де лежать його стан, налаштування й дані (3.21.0).
// Linux (як і раніше): ~/.local/state/work-os, ~/.config/work-os, ~/.local/share/work-os з урахуванням XDG_*.
// Windows: %LOCALAPPDATA%\WorkOS\state, \config, \runner (без прав адміністратора, поза «Документами» й синхронізацією).
import { homedir } from 'node:os';
import { join } from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

const winRoot = () => join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'WorkOS');

/** Теки стану: runner-status.json, health.json, failures/, лог, режим браузера. */
export const stateDir = () => (IS_WINDOWS ? join(winRoot(), 'state') : join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'work-os'));
/** Налаштування (runner.env із токеном): права лише користувача. */
export const configDir = () => (IS_WINDOWS ? join(winRoot(), 'config') : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'work-os'));
/** Де лежить пакет runner, поставлений з сайту. */
export const runnerDir = () => (IS_WINDOWS ? join(winRoot(), 'runner') : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'work-os', 'runner'));
/** Профіль браузера runner (входи WhatsApp і Telegram). */
export const browserProfileDir = () => (IS_WINDOWS ? join(winRoot(), 'browser') : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'work-os-runner-browser'));

export const runnerEnvFile = () => join(configDir(), 'runner.env');
export const statusFile = () => process.env.WORK_OS_RUNNER_STATUS_FILE || join(stateDir(), 'runner-status.json');
