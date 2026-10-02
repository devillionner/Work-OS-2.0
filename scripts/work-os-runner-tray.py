#!/usr/bin/env python3
"""Work OS runner tray icon (Linux, StatusNotifier/AppIndicator).

Owns the local runner: starts scripts/whatsapp-runner.sh, shows its state from the status file the
runner writes, and lets the operator stop, start or restart it, open Work OS, or quit everything.
"""
import fcntl
import json
import os
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
RUNNER_MARK = 'scripts/chat-discovery-runner.mjs'
WORK_OS_URL = os.environ.get('WORK_OS_URL', 'https://work-os-2-staging.devillionner.workers.dev')

COLORS = {
    'working': '#2563eb', 'ready': '#16a34a', 'starting': '#16a34a', 'paused': '#9ca3af',
    'no_token': '#f59e0b', 'no_browser': '#f59e0b', 'stopped': '#dc2626',
}
LABELS = {
    'working': 'Працює', 'ready': 'Готовий', 'starting': 'Запускається', 'paused': 'Пауза',
    'no_token': 'Не підключений', 'no_browser': 'Немає браузера', 'stopped': 'Зупинений',
}


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
    """Runner processes started outside the tray (old autostart, manual launch)."""
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


class Tray:
    def __init__(self):
        self.process = None
        self.stopping = False
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
        self.toggle_item = Gtk.MenuItem(label='Зупинити runner')
        self.toggle_item.connect('activate', lambda _: self.stop_runner() if self.running() else self.start_runner())
        menu.append(self.toggle_item)
        restart = Gtk.MenuItem(label='Перезапустити runner')
        restart.connect('activate', lambda _: self.restart_runner())
        menu.append(restart)
        site = Gtk.MenuItem(label='Відкрити Work OS')
        site.connect('activate', lambda _: subprocess.Popen(['xdg-open', WORK_OS_URL], start_new_session=True))
        menu.append(site)
        menu.append(Gtk.SeparatorMenuItem())
        quit_item = Gtk.MenuItem(label='Вийти (зупинити runner)')
        quit_item.connect('activate', lambda _: self.quit())
        menu.append(quit_item)
        menu.show_all()
        self.indicator.set_menu(menu)

        self.start_runner()
        GLib.timeout_add_seconds(2, self.refresh)
        self.refresh()

    def running(self):
        return self.process is not None and self.process.poll() is None

    def start_runner(self):
        if self.running():
            return
        for pid in runner_pids():
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
        time.sleep(0.5)
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        log = open(LOG_FILE, 'a', encoding='utf-8')
        self.stopping = False
        self.process = subprocess.Popen([str(RUNNER_SCRIPT)], cwd=str(ROOT), stdout=log, stderr=subprocess.STDOUT,
                                        stdin=subprocess.DEVNULL, start_new_session=True)
        log.close()

    def stop_runner(self):
        self.stopping = True
        if self.running():
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
                self.process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except OSError:
                    pass
        self.process = None
        self.refresh()

    def restart_runner(self):
        self.stop_runner()
        self.start_runner()
        self.refresh()

    def read_status(self):
        try:
            status = json.loads(STATUS_FILE.read_text(encoding='utf-8'))
            return status.get('state', 'starting'), status.get('detail', '')
        except (OSError, ValueError):
            return 'starting', 'Запускається…'

    def refresh(self):
        if self.running():
            state, detail = self.read_status()
            if state == 'stopped':
                state, detail = 'starting', 'Запускається…'
        elif self.stopping or self.process is None:
            state, detail = 'stopped', 'Зупинений вручну — база не опитується'
        else:
            state, detail = 'stopped', f'Runner завершився (код {self.process.returncode}) — див. журнал'
        icon = ICON_DIR / f'work-os-{state if state in COLORS else "starting"}.svg'
        self.indicator.set_icon_full(str(icon), LABELS.get(state, state))
        self.indicator.set_title(f'Work OS runner — {LABELS.get(state, state)}')
        self.state_item.set_label(f'Work OS runner: {LABELS.get(state, state)}')
        self.detail_item.set_label(detail[:90])
        self.toggle_item.set_label('Зупинити runner' if self.running() else 'Запустити runner')
        return True

    def quit(self):
        self.stop_runner()
        Gtk.main_quit()


def main():
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock = open(LOCK_FILE, 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print('Work OS tray is already running.')
        return 0
    tray = Tray()
    for sig in (signal.SIGTERM, signal.SIGINT):
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, lambda *_: (tray.quit(), False)[1])
    Gtk.main()
    return 0


if __name__ == '__main__':
    sys.exit(main())
