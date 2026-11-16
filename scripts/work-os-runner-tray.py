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
import shutil
import signal
import socket
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
WAYDROID_SHOW = ROOT / 'scripts' / 'work-os-waydroid-show.sh'
# Режим браузера runner: «headless» (без вікна) чи «window»; читає scripts/whatsapp-runner.sh при запуску браузера.
BROWSER_MODE_FILE = STATE_DIR / 'runner-browser-mode'
RUNNER_CONF = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'work-os' / 'runner.env'
BROWSER_CHECK_SECONDS = 10
# Знімки невідомих станів (скріншот і дерево екрана): runner пише їх у failures/, тут рахуються «нові» (новіші за позначку .seen).
FAILURES_DIR = STATE_DIR / 'failures'
FAILURES_CHECK_SECONDS = 20
# Браузер runner зник (закрили вікно, впав): runner сам його не піднімає, тож трей перезапускає runner (скрипт відкриває браузер).
BROWSER_GONE_RESTART_AFTER = 3
BROWSER_RESTART_GAP_SECONDS = 300
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
THROTTLE_FLAGS = ('--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling')
BROWSER_FLAGS_CHECK_SECONDS = 60
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


def missing_throttle_flags(port=9222):
    """Прапорці браузера на порту налагодження, яких бракує (None — браузер не знайдено)."""
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            args = (entry / 'cmdline').read_bytes().decode(errors='ignore').replace('\0', ' ').split()
        except OSError:
            continue
        if f'--remote-debugging-port={port}' in args and not any(a.startswith('--type=') for a in args):
            return [flag for flag in THROTTLE_FLAGS if flag not in args]
    return None


def runner_browser_profile():
    """Профіль браузера runner: runner.env (його пише інсталятор), інакше стандартний."""
    profile = os.environ.get('WORK_OS_BROWSER_PROFILE', '')
    if not profile:
        try:
            for line in RUNNER_CONF.read_text(encoding='utf-8').splitlines():
                key, _, value = line.partition('=')
                if key.strip() == 'WORK_OS_BROWSER_PROFILE':
                    profile = value.strip().strip('"\'')
        except OSError:
            pass
    return profile or str(Path.home() / '.local' / 'share' / 'work-os-runner-browser')


def port_open(port=9222):
    """Чи відповідає хоч якийсь браузер на порту налагодження (щоденний браузер власника теж годиться)."""
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            return True
    except OSError:
        return False


def runner_browser(port=9222):
    """Головний процес браузера runner (порт налагодження + профіль runner): (pid, без_вікна) або None.
    Щоденний браузер власника, що випадково стоїть на цьому порту без профілю runner, не чіпаємо."""
    profile = runner_browser_profile()
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            # Chromium переписує argv в один рядок, тож ділимо і за нулями, і за пробілами.
            args = (entry / 'cmdline').read_bytes().decode(errors='ignore').replace('\0', ' ').split()
        except OSError:
            continue
        if f'--remote-debugging-port={port}' in args and f'--user-data-dir={profile}' in args \
                and not any(a.startswith('--type=') for a in args):
            return int(entry.name), any(a.startswith('--headless') for a in args)
    return None


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
        self.flags_checked_at = 0.0
        self.flags_missing = False
        self.awake = False
        self.day = {}
        self.label = None
        self.browser = None
        self.browser_checked_at = 0.0
        self.health = {}
        self.failures_checked_at = 0.0
        self.browser_gone = 0
        self.browser_restarted_at = 0.0
        self.has_waydroid = shutil.which('waydroid') is not None
        write_icons()
        self.indicator = AppIndicator.Indicator.new(
            'work-os-runner', str(ICON_DIR / 'work-os-starting.svg'), AppIndicator.IndicatorCategory.APPLICATION_STATUS)
        self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.indicator.set_title('Work OS runner')

        menu = Gtk.Menu()
        # Зверху те, заради чого відкривають меню: що відбувається з автопостом (дані з runner-status.json, без запитів).
        self.platform_items = {}
        for pid, name in (('viber', 'Viber'), ('telegram', 'Telegram'), ('whatsapp', 'WhatsApp')):
            item = Gtk.MenuItem(label=f'{name} —')
            item.set_sensitive(False)
            menu.append(item)
            self.platform_items[pid] = item
        self.decision_platform = 'viber'
        self.decision_item = Gtk.MenuItem(label='Потребують рішення')
        self.decision_item.connect('activate', lambda _: self.open_autopost(self.decision_platform))
        menu.append(self.decision_item)
        site = Gtk.MenuItem(label='Відкрити Work OS')
        site.connect('activate', lambda _: subprocess.Popen(['xdg-open', WORK_OS_URL], start_new_session=True))
        menu.append(site)
        # Браузер runner працює без вікна; вікно потрібне лише для входу в WhatsApp чи Telegram (QR-код).
        self.browser_item = Gtk.MenuItem(label='Показати браузер runner')
        self.browser_item.connect('activate', lambda _: self.toggle_browser())
        menu.append(self.browser_item)
        # Здоров'я платформ (пробна відправка, пауза середовища): рядок лише коли щось не так.
        self.health_items = {}
        for pid, name in (('viber', 'Viber'), ('telegram', 'Telegram'), ('whatsapp', 'WhatsApp')):
            item = Gtk.MenuItem(label=name)
            item.set_sensitive(False)
            menu.append(item)
            self.health_items[pid] = item
        self.failures_item = Gtk.MenuItem(label='Нові збої')
        self.failures_item.connect('activate', lambda _: self.open_failures())
        menu.append(self.failures_item)
        self.android_item = Gtk.MenuItem(label='Показати Android')
        self.android_item.connect('activate', lambda _: subprocess.Popen([str(WAYDROID_SHOW)], start_new_session=True))
        menu.append(self.android_item)
        menu.append(Gtk.SeparatorMenuItem())
        self.state_item = Gtk.MenuItem(label='Work OS runner')
        self.state_item.set_sensitive(False)
        self.detail_item = Gtk.MenuItem(label='')
        self.detail_item.set_sensitive(False)
        menu.append(self.state_item)
        menu.append(self.detail_item)
        menu.append(Gtk.SeparatorMenuItem())
        self.opera_item = Gtk.MenuItem(label='Перезапусти Opera: без прапорців автопост гальмує за іншими вікнами')
        self.opera_item.set_sensitive(False)
        menu.append(self.opera_item)
        # Runner тримає блокування сну, поки йде автопост (поле `awake` у runner-status.json).
        self.awake_item = Gtk.MenuItem(label='Не даю заснути: іде автопост')
        self.awake_item.set_sensitive(False)
        menu.append(self.awake_item)
        restart = Gtk.MenuItem(label='Перезапустити runner')
        restart.connect('activate', lambda _: self.restart_runner())
        menu.append(restart)
        menu.append(Gtk.SeparatorMenuItem())
        off_item = Gtk.MenuItem(label='Вимкнути повністю…')
        off_item.connect('activate', lambda _: self.confirm_disable())
        menu.append(off_item)
        menu.show_all()
        self.opera_item.hide()
        self.awake_item.hide()
        self.decision_item.hide()
        self.browser_item.hide()
        self.failures_item.hide()
        for item in self.health_items.values():
            item.hide()
        if not self.has_waydroid:
            self.android_item.hide()
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
            self.awake = bool(status.get('awake'))
            self.day = status.get('day') if isinstance(status.get('day'), dict) else {}
            self.health = status.get('health') if isinstance(status.get('health'), dict) else {}
            return status.get('state', 'starting'), status.get('detail', '')
        except (OSError, ValueError):
            self.awake = False
            self.day = {}
            self.health = {}
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
        (self.awake_item.show if self.awake and self.running() else self.awake_item.hide)()
        self.show_day(state)
        self.show_health()
        self.check_browser_flags()
        self.check_browser(state)
        self.check_failures()
        return True

    def show_day(self, state):
        """Число біля значка (GNOME не показує підказок), рядки платформ і «Потребують рішення» у меню."""
        label = str(self.day.get('label') or '') if self.running() else ''
        if label != self.label:
            self.label = label
            self.indicator.set_label(label, '999/999')
        decisions, best = 0, ('viber', 0)
        for item in self.day.get('platforms') or []:
            row = self.platform_items.get(item.get('id'))
            if row is not None:
                row.set_label(str(item.get('text') or ''))
            count = int(item.get('decision') or 0)
            decisions += count
            if count > best[1]:
                best = (item.get('id'), count)
        self.decision_platform = best[0]
        if decisions:
            self.decision_item.set_label(f'Потребують рішення · {decisions}')
            self.decision_item.show()
        else:
            self.decision_item.hide()

    def show_health(self):
        """Рядок здоров'я платформи лише коли вона на паузі чи перевіряється: «Viber: Пауза: …» / «Середовище змінилось …»."""
        names = {'viber': 'Viber', 'telegram': 'Telegram', 'whatsapp': 'WhatsApp'}
        for pid, item in self.health_items.items():
            line = str(self.health.get(pid) or '')
            if line.startswith(('Пауза', 'Середовище', 'Перевіряю')):
                item.set_label(f'{names[pid]}: {line}'[:120])
                item.show()
            else:
                item.hide()

    def failures_new(self):
        """Скільки знімків збоїв новіші за позначку, яку ставить пункт меню «Нові збої»."""
        try:
            seen = (FAILURES_DIR / '.seen').stat().st_mtime if (FAILURES_DIR / '.seen').exists() else 0
            return sum(1 for entry in FAILURES_DIR.iterdir() if entry.is_dir() and not entry.name.startswith('.') and entry.stat().st_mtime > seen)
        except OSError:
            return 0

    def check_failures(self):
        now = time.time()
        if now - self.failures_checked_at < FAILURES_CHECK_SECONDS:
            return
        self.failures_checked_at = now
        count = self.failures_new()
        if count:
            self.failures_item.set_label(f'Нові збої: {count}')
            self.failures_item.show()
        else:
            self.failures_item.hide()

    def open_failures(self):
        try:
            FAILURES_DIR.mkdir(parents=True, exist_ok=True)
            (FAILURES_DIR / '.seen').touch()
        except OSError:
            pass
        self.failures_item.hide()
        subprocess.Popen(['xdg-open', str(FAILURES_DIR)], start_new_session=True)

    def open_autopost(self, platform):
        subprocess.Popen(['xdg-open', f'{WORK_OS_URL}/?go=platforms:{platform}:autopost'], start_new_session=True)

    # ── браузер runner: без вікна чи з вікном ──────────────────────────────────────────
    def check_browser(self, state):
        now = time.time()
        if now - self.browser_checked_at < BROWSER_CHECK_SECONDS:
            return
        self.browser_checked_at = now
        found = runner_browser()
        self.browser = found
        if found is None:
            self.browser_item.hide()
            # Браузера runner немає (закрили вікно чи він упав), а runner живий і не зайнятий: WhatsApp і Telegram без нього не працюють.
            # Скрипт запуску сам відкриває браузер, тож перезапускаємо runner (не частіше за раз на 5 хв).
            self.browser_gone = self.browser_gone + 1 if not port_open() else 0
            if (self.browser_gone >= BROWSER_GONE_RESTART_AFTER and state != 'working' and self.running()
                    and time.time() - self.browser_restarted_at > BROWSER_RESTART_GAP_SECONDS and time.time() - self.started_at > 60):
                self.browser_restarted_at = time.time()
                self.browser_gone = 0
                self.restart_runner()
            return
        self.browser_gone = 0
        self.browser_item.set_label('Показати браузер runner' if found[1] else 'Сховати браузер runner')
        self.browser_item.set_sensitive(state != 'working')
        self.browser_item.show()

    def toggle_browser(self):
        """Перезапускає браузер runner у протилежному режимі з тим самим профілем (сесії WhatsApp і Telegram лишаються)."""
        found = runner_browser()
        if found is None:
            return
        pid, headless = found
        want_window = headless
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            BROWSER_MODE_FILE.write_text('window' if want_window else 'headless', encoding='utf-8')
        except OSError:
            return
        self.stop_runner()
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        for _ in range(100):
            if runner_browser() is None:
                break
            time.sleep(0.1)
        else:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        self.backoff = BACKOFF_START
        self.next_start_at = 0.0
        self.browser_checked_at = 0.0
        self.start_runner()
        self.refresh()

    def check_browser_flags(self):
        """Opera без прапорців проти гальмування: один рядок у меню; сам браузер власника не чіпаємо."""
        now = time.time()
        if now - self.flags_checked_at < BROWSER_FLAGS_CHECK_SECONDS:
            return
        self.flags_checked_at = now
        missing = missing_throttle_flags()
        want = bool(missing)
        if want != self.flags_missing:
            self.flags_missing = want
            (self.opera_item.show if want else self.opera_item.hide)()

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
