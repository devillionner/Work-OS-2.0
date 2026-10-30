#!/usr/bin/env python3
"""Work OS runner tray icon (Linux, StatusNotifier/AppIndicator).

Owns the local runner without any hands-on work:
  * starts scripts/whatsapp-runner.sh and shows its state from the status file the runner writes;
  * restarts the runner by itself when its files change (only between tasks) and says so;
  * brings the runner back when it dies (growing pause), and adopts a runner that outlived the tray;
  * has no accidental «stop»: the only way out is «Вимкнути повністю» with a confirmation;
  * a second launch (the workos-runner:// link handler) just wakes the running tray.
The tray itself is kept alive by the systemd user unit work-os-runner-tray.service (Restart=on-failure).
"""
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

import gi

gi.require_version('Gtk', '3.0')
try:
    gi.require_version('AyatanaAppIndicator3', '0.1')
    from gi.repository import AyatanaAppIndicator3 as AppIndicator
except (ValueError, ImportError):
    gi.require_version('AppIndicator3', '0.1')
    from gi.repository import AppIndicator3 as AppIndicator
from gi.repository import GLib, Gtk

ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local' / 'state')) / 'work-os'
LOG_FILE = STATE_DIR / 'whatsapp-runner.log'
STATUS_FILE = STATE_DIR / 'runner-status.json'
ICON_DIR = STATE_DIR / 'tray-icons'
LOCK_FILE = Path(os.environ.get('XDG_RUNTIME_DIR', '/tmp')) / 'work-os-runner-tray.lock'
RUNNER_SCRIPT = ROOT / 'scripts' / 'whatsapp-runner.sh'
RUNNER_ENTRY = ROOT / 'scripts' / 'chat-discovery-runner.mjs'
APP_META = ROOT / 'lib' / 'app-meta.ts'
RUNNER_MARK = 'scripts/chat-discovery-runner.mjs'
WORK_OS_URL = os.environ.get('WORK_OS_URL', 'https://work-os-2-staging.devillionner.workers.dev')

# Файли змінилися й стоять без змін стільки секунд: можна перезапускати (git pull чи збірка пишуть кілька файлів підряд).
UPDATE_QUIET_SECONDS = 4
# Пауза між спробами підняти runner, що впав: 5 с, 10 с, 20 с … до 5 хв; після хвилини стабільної роботи починається спочатку.
BACKOFF_START, BACKOFF_MAX, BACKOFF_RESET_AFTER = 5, 300, 60
UPDATE_NOTE_SECONDS = 600

COLORS = {
    'working': '#2563eb', 'ready': '#16a34a', 'starting': '#16a34a', 'paused': '#9ca3af',
    'no_token': '#f59e0b', 'no_browser': '#f59e0b', 'attention': '#f59e0b', 'stopped': '#dc2626',
    'reconnecting': '#f59e0b',
}
LABELS = {
    'working': 'Працює', 'ready': 'Готовий', 'starting': 'Запускається', 'paused': 'Пауза',
    'no_token': 'Не підключений', 'no_browser': 'Немає браузера', 'attention': 'Потрібна увага', 'stopped': 'Зупинений',
    'reconnecting': 'Перепідключення',
}
IMPORT_RE = re.compile(r"""(?:from|import)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]""")


def write_icons():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for state, color in COLORS.items():
        (ICON_DIR / f'work-os-{state}.svg').write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">'
            f'<rect x="1" y="1" width="20" height="20" rx="6" fill="{color}"/>'
            '<path d="M5 7l2.4 8 2.6-6 2.6 6L15 7" fill="none" stroke="#fff" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round"/></svg>'
        )


def runner_pids():
    """Runner processes that already exist (started by a previous tray, old autostart, manual launch)."""
    pids = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            cmdline = (entry / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='ignore')
        except OSError:
            continue
        if RUNNER_MARK in cmdline and 'node' in cmdline:
            pids.append(int(entry.name))
    return pids


def pid_alive(pid):
    try:
        cmdline = (Path('/proc') / str(pid) / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='ignore')
    except OSError:
        return False
    return RUNNER_MARK in cmdline


def watched_files():
    """The runner entry, everything it imports (relative imports, recursively) and the launch script."""
    seen, stack = set(), [RUNNER_ENTRY]
    while stack:
        path = stack.pop()
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        try:
            text = path.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        for match in IMPORT_RE.findall(text):
            candidate = (path.parent / match).resolve()
            if candidate.suffix in ('.mjs', '.js', '.ts'):
                stack.append(candidate)
    seen.add(RUNNER_SCRIPT)
    return seen


def signature():
    items = []
    for path in sorted(watched_files()):
        try:
            stat = path.stat()
        except OSError:
            continue
        items.append((str(path), stat.st_mtime_ns, stat.st_size))
    return tuple(items)


def app_version():
    try:
        match = re.search(r"APP_VERSION\s*=\s*'([^']+)'", APP_META.read_text(encoding='utf-8'))
        return match.group(1) if match else ''
    except OSError:
        return ''


class Tray:
    def __init__(self):
        self.process = None
        self.adopted = None
        self.started_at = 0.0
        self.backoff = BACKOFF_START
        self.next_start_at = 0.0
        self.sig = signature()
        self.changed_at = None
        self.update_note = ''
        self.update_note_until = 0.0
        write_icons()
        self.indicator = AppIndicator.Indicator.new(
            'work-os-runner', str(ICON_DIR / 'work-os-starting.svg'), AppIndicator.IndicatorCategory.APPLICATION_STATUS)
        self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.indicator.set_title('Work OS runner')

        menu = Gtk.Menu()
        self.state_item = Gtk.MenuItem(label='Work OS runner')
        self.state_item.set_sensitive(False)
        self.detail_item = Gtk.MenuItem(label='')
        self.detail_item.set_sensitive(False)
        menu.append(self.state_item)
        menu.append(self.detail_item)
        menu.append(Gtk.SeparatorMenuItem())
        restart = Gtk.MenuItem(label='Перезапустити runner')
        restart.connect('activate', lambda _: self.restart_runner())
        menu.append(restart)
        site = Gtk.MenuItem(label='Відкрити Work OS')
        site.connect('activate', lambda _: subprocess.Popen(['xdg-open', WORK_OS_URL], start_new_session=True))
        menu.append(site)
        menu.append(Gtk.SeparatorMenuItem())
        off_item = Gtk.MenuItem(label='Вимкнути повністю…')
        off_item.connect('activate', lambda _: self.confirm_disable())
        menu.append(off_item)
        menu.show_all()
        self.indicator.set_menu(menu)

        self.start_runner()
        GLib.timeout_add_seconds(2, self.refresh)
        self.refresh()

    # ── runner process ────────────────────────────────────────────────────────────────────────────────────
    def running(self):
        if self.process is not None and self.process.poll() is None:
            return True
        return self.adopted is not None and pid_alive(self.adopted)

    def start_runner(self, updated=False):
        if self.running():
            return
        # Runner пережив попередній трей (його перезапустив systemd після збою): підхоплюємо, а не вбиваємо, бо задача могла йти.
        existing = runner_pids()
        if existing:
            self.adopted = existing[0]
            self.started_at = self.started_at or time.time()
            return
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ)
        if updated:
            env['WORK_OS_RUNNER_UPDATED'] = '1'
        log = open(LOG_FILE, 'a', encoding='utf-8')
        self.adopted = None
        self.process = subprocess.Popen([str(RUNNER_SCRIPT)], cwd=str(ROOT), stdout=log, stderr=subprocess.STDOUT,
                                        stdin=subprocess.DEVNULL, start_new_session=True, env=env)
        log.close()
        self.started_at = time.time()

    def stop_runner(self):
        if self.process is not None and self.process.poll() is None:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
                self.process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except OSError:
                    pass
        elif self.adopted is not None and pid_alive(self.adopted):
            try:
                os.kill(self.adopted, signal.SIGTERM)
                for _ in range(50):
                    if not pid_alive(self.adopted):
                        break
                    time.sleep(0.1)
                else:
                    os.kill(self.adopted, signal.SIGKILL)
            except OSError:
                pass
        self.process = None
        self.adopted = None

    def restart_runner(self, updated=False):
        self.stop_runner()
        self.backoff = BACKOFF_START
        self.start_runner(updated=updated)
        self.refresh()

    def wake(self):
        """workos-runner://start: the tray is already here; make sure the runner runs and the pause is forgotten."""
        self.backoff = BACKOFF_START
        self.next_start_at = 0.0
        self.start_runner()
        self.refresh()
        return True

    # ── state ─────────────────────────────────────────────────────────────────────────────────────────────
    def read_status(self):
        try:
            status = json.loads(STATUS_FILE.read_text(encoding='utf-8'))
            return status.get('state', 'starting'), status.get('detail', '')
        except (OSError, ValueError):
            return 'starting', 'Запускається…'

    def maybe_update(self, state):
        """Runner files changed: restart the runner between tasks (never in the middle of one)."""
        new = signature()
        now = time.time()
        if new != self.sig:
            self.sig, self.changed_at = new, now
        if self.changed_at is None or now - self.changed_at < UPDATE_QUIET_SECONDS or state == 'working':
            return
        self.changed_at = None
        version = app_version()
        self.update_note = f'Runner оновлено до {version}' if version else 'Runner оновлено'
        self.update_note_until = now + UPDATE_NOTE_SECONDS
        self.restart_runner(updated=True)

    def maintain(self):
        """The runner died on its own: bring it back after a growing pause."""
        now = time.time()
        if self.next_start_at == 0.0:
            ran = now - self.started_at if self.started_at else 0
            if ran > BACKOFF_RESET_AFTER:
                self.backoff = BACKOFF_START
            self.next_start_at = now + self.backoff
            self.backoff = min(self.backoff * 2, BACKOFF_MAX)
        if now >= self.next_start_at:
            self.next_start_at = 0.0
            self.start_runner()

    def refresh(self):
        if self.running():
            self.next_start_at = 0.0
            if self.backoff != BACKOFF_START and time.time() - self.started_at > BACKOFF_RESET_AFTER:
                self.backoff = BACKOFF_START
            state, detail = self.read_status()
            if state == 'stopped':
                state, detail = 'starting', 'Запускається…'
            self.maybe_update(state)
            if self.update_note and time.time() < self.update_note_until and state != 'working':
                detail = self.update_note
        else:
            self.maintain()
            wait = max(0, int(self.next_start_at - time.time())) if self.next_start_at else 0
            state, detail = 'stopped', f'Runner зупинився, піднімаю знову{f" за {wait} с" if wait else ""}'
        icon = ICON_DIR / f'work-os-{state if state in COLORS else "starting"}.svg'
        self.indicator.set_icon_full(str(icon), LABELS.get(state, state))
        self.indicator.set_title(f'Work OS runner — {LABELS.get(state, state)}')
        self.state_item.set_label(f'Work OS runner: {LABELS.get(state, state)}')
        self.detail_item.set_label(detail[:90])
        return True

    # ── the only way out ──────────────────────────────────────────────────────────────────────────────────
    def confirm_disable(self):
        dialog = Gtk.MessageDialog(
            transient_for=None, flags=0, message_type=Gtk.MessageType.WARNING, buttons=Gtk.ButtonsType.NONE,
            text='Вимкнути Work OS runner повністю?')
        dialog.format_secondary_text(
            'Автопост, перевірки й сповіщення з ПК зупиняться. Runner і ця іконка не повернуться самі до наступного входу в систему '
            'або ручного запуску (кнопка «Запустити runner» у Work OS).')
        dialog.add_button('Скасувати', Gtk.ResponseType.CANCEL)
        dialog.add_button('Вимкнути повністю', Gtk.ResponseType.OK)
        dialog.set_default_response(Gtk.ResponseType.CANCEL)
        response = dialog.run()
        dialog.destroy()
        if response == Gtk.ResponseType.OK:
            self.quit()

    def quit(self):
        self.stop_runner()
        Gtk.main_quit()


def signal_running_tray():
    """A second launch: wake the tray that holds the lock (it reads its pid from the lock file)."""
    try:
        pid = int(LOCK_FILE.read_text().strip())
        os.kill(pid, signal.SIGUSR1)
    except (OSError, ValueError):
        pass


def main():
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock = open(LOCK_FILE, 'a+')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        signal_running_tray()
        print('Work OS tray is already running.')
        return 0
    lock.seek(0)
    lock.truncate()
    lock.write(str(os.getpid()))
    lock.flush()
    tray = Tray()
    for sig in (signal.SIGTERM, signal.SIGINT):
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, lambda *_: (tray.quit(), False)[1])
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, lambda *_: tray.wake())
    Gtk.main()
    return 0


if __name__ == '__main__':
    sys.exit(main())
