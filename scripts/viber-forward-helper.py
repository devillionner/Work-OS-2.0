#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Work OS: автопост у Viber на Linux через пересилання нотатки з «Мої нотатки» (My Notes).

Оператор раз на день створює в «Мої нотатки» по одному повідомленню «фото + підпис» на кожен варіант оголошення.
Для кожного цільового чату помічник: відкриває чат за viber://-посиланням, у «Мої нотатки» знаходить нотатку з
точно таким підписом, відкриває «Forward», вибирає цільовий чат за назвою (лише коли результат рівно один і
аватар збігається з аватаром відкритого чату), пересилає й підтверджує, що повідомлення з'явилося в чаті.

Дії (JSON у stdin, один рядок JSON у stdout, журнал у stderr):
  status   лише перевірка середовища: Viber запущений, доступність увімкнена, вікно є. Нічого не чіпає.
  post     пересилання; з "dryRun": true перевіряє середовище, посилання й наявність нотатки, нічого не надсилає.
  avatar   діагностика: порівняння аватара відкритого чату з рядком у вікні «Forward» (без вибору й відправки).

Спирається на AT-SPI (Viber запущено з QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1), hyprctl (Hyprland 0.5x, Lua-диспатчери),
wl-clipboard, grim і python-evdev (миша). Viber ніколи не запускає й не перезапускає. Мова інтерфейсу Viber: англійська.

Статуси: sent | skipped | failed | dry_run | ready. Серйозність причини (severity):
  env   середовище не готове, нічого не зроблено; безпечно повторити пізніше
  job   причина в самому завданні (немає нотатки, неоднозначний чат тощо); нічого не надіслано, не повторювати
  after Forward уже натиснуто, але результат не підтверджено; повторювати не можна (дубль гірший за пропуск)
"""
import gi
import io
import json
import os
import re
import subprocess
import sys
import time
import unicodedata

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi  # noqa: E402

WINDOW_CLASS = 'ViberPC'
LOG_PREFIX = '[viber-forward] '
STEP_TIMEOUT = 20.0

# XKB-коди клавіш (evdev + 8): не залежать від розкладки (в оператора активна українська, ім'я клавіші «V» не знаходиться).
CODE_V = 55
CODE_A = 38
CODE_RETURN = 36
CODE_ESCAPE = 9

# Усі розміри пікселів задано відносно лівого верхнього кута вікна Viber (AT-SPI дає екранні координати).
HEADER_AVATAR = (317, 53, 46)       # x, y, сторона
DIALOG_AVATAR_DX = 36               # центр аватара рядка вікна «Forward» від лівого краю діалогу
DIALOG_AVATAR_SIZE = 30
MY_NOTES_TILE = (28, 76)            # центр плитки «Обраних чатів» у лівій панелі: перша плитка — My Notes

# Поріг подібності аватара (0..1): відкалібровано на реальних групах, див. docs і avatar_similarity().
AVATAR_MATCH_MIN = 0.78

BLOCKING_RULES = [
    (re.compile(r'inactive link|link.*(?:no longer|expired|invalid)|not found|does not exist'), 'viber_chat_missing'),
    (re.compile(r'only (?:admins?|administrators?)|read.?only|cannot (?:send|post)|can.?t (?:send|post)'), 'viber_read_only'),
    (re.compile(r'banned|blocked|removed|unable to join'), 'viber_banned'),
    (re.compile(r'oops|something went wrong|try again|error'), 'viber_transient_error'),
]
CLOSE_NAMES = {'ok', 'close', 'got it', 'cancel'}
JOIN_NAMES = {'join community', 'join group', 'join', 'join chat'}


class Stop(Exception):
    """Завершення дії з пояснюваною причиною."""

    def __init__(self, status, reason, severity='job', detail=''):
        super().__init__(reason)
        self.status = status
        self.reason = reason
        self.severity = severity
        self.detail = detail


def log(message):
    print(LOG_PREFIX + message, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- система: hyprctl, буфер обміну, знімки

def run(cmd, timeout=6, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kwargs)


def hypr_dispatch(expression):
    result = run(['hyprctl', 'dispatch', expression])
    return (result.stdout + result.stderr).strip()


def hypr_clients():
    try:
        return json.loads(run(['hyprctl', 'clients', '-j']).stdout or '[]')
    except (ValueError, OSError, subprocess.SubprocessError):
        return []


def viber_client():
    for client in hypr_clients():
        if client.get('class') == WINDOW_CLASS:
            return client
    return None


def viber_process_running():
    result = run(['pgrep', '-f', r'usr/bin/Viber( |$)'])
    return bool(result.stdout.strip())


def key(mods, code):
    answer = hypr_dispatch('hl.dsp.send_shortcut({ mods = "%s", key = "code:%d", window = "class:%s" })' % (mods, code, WINDOW_CLASS))
    if answer != 'ok':
        raise Stop('skipped', 'viber_window_unavailable', 'env', 'send_shortcut: ' + answer[:80])


def clipboard_read():
    try:
        result = subprocess.run(['wl-paste', '--no-newline'], capture_output=True, timeout=3)
        return result.stdout.decode('utf-8', 'replace') if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def clipboard_write(text):
    subprocess.run(['wl-copy', '--', text], check=True, timeout=5)


def grab(x, y, w, h):
    from PIL import Image
    png = subprocess.run(['grim', '-g', '%d,%d %dx%d' % (x, y, w, h), '-'], capture_output=True, timeout=8).stdout
    return Image.open(io.BytesIO(png)).convert('RGB')


class Pointer:
    """Віртуальна миша через uinput (ACL на /dev/uinput є в оператора). Курсор ставить Hyprland, uinput лише тисне й крутить."""

    def __init__(self):
        self.device = None
        self.origin = None

    def _ensure(self):
        if self.device is None:
            from evdev import UInput, ecodes
            self.ecodes = ecodes
            self.device = UInput({ecodes.EV_KEY: [ecodes.BTN_LEFT, ecodes.BTN_RIGHT], ecodes.EV_REL: [ecodes.REL_X, ecodes.REL_Y, ecodes.REL_WHEEL]}, name='work-os-viber-pointer')
            time.sleep(0.7)
            try:
                x, y = run(['hyprctl', 'cursorpos']).stdout.strip().split(',')
                self.origin = (int(x), int(y))
            except ValueError:
                self.origin = None

    def _warp(self, x, y):
        hypr_dispatch('hl.dsp.cursor.move({ x = %d, y = %d })' % (x, y))
        time.sleep(0.12)
        # Без руху після warp клієнт не отримує pointer-enter, і клік губиться.
        for delta in (1, -1):
            self.device.write(self.ecodes.EV_REL, self.ecodes.REL_X, delta)
            self.device.syn()
            time.sleep(0.08)
        time.sleep(0.1)

    def hover(self, x, y):
        self._ensure()
        self._warp(x, y)
        time.sleep(0.4)

    def click(self, x, y):
        self._ensure()
        self._warp(x, y)
        self.device.write(self.ecodes.EV_KEY, self.ecodes.BTN_LEFT, 1)
        self.device.syn()
        time.sleep(0.06)
        self.device.write(self.ecodes.EV_KEY, self.ecodes.BTN_LEFT, 0)
        self.device.syn()
        time.sleep(0.25)

    def wheel(self, x, y, notches):
        """notches > 0 — униз, < 0 — угору."""
        self._ensure()
        self._warp(x, y)
        step = -1 if notches > 0 else 1
        for _ in range(abs(notches)):
            self.device.write(self.ecodes.EV_REL, self.ecodes.REL_WHEEL, step)
            self.device.syn()
            time.sleep(0.03)
        time.sleep(0.5)

    def restore(self):
        if self.device is not None:
            if self.origin:
                hypr_dispatch('hl.dsp.cursor.move({ x = %d, y = %d })' % self.origin)
            try:
                self.device.close()
            except OSError:
                pass


# ---------------------------------------------------------------- AT-SPI

def atspi_app():
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if app is not None and app.get_name() == WINDOW_CLASS:
            return app
    return None


def extents(node):
    e = node.get_extents(Atspi.CoordType.SCREEN)
    return (e.x, e.y, e.width, e.height)


def children(node):
    try:
        return [node.get_child_at_index(i) for i in range(node.get_child_count())]
    except Exception:  # noqa: BLE001
        return []


def walk(node, visit, depth=0):
    if node is None or depth > 14:
        return
    visit(node)
    for child in children(node):
        walk(child, visit, depth + 1)


def find_nodes(root, role=None, name=None, predicate=None):
    found = []

    def visit(node):
        try:
            if role is not None and node.get_role_name() != role:
                return
            if name is not None and (node.get_name() or '').strip().lower() != name.lower():
                return
            if predicate is not None and not predicate(node):
                return
            found.append(node)
        except Exception:  # noqa: BLE001
            return

    walk(root, visit)
    return found


def has_state(node, state):
    try:
        return node.get_state_set().contains(state)
    except Exception:  # noqa: BLE001
        return False


def visible(node):
    try:
        e = extents(node)
        return e[2] > 0 and e[3] > 0
    except Exception:  # noqa: BLE001
        return False


def do_action(node, action):
    for index in range(node.get_n_actions()):
        if node.get_action_name(index) == action:
            return bool(node.do_action(index))
    return False


def read_text(node):
    try:
        iface = Atspi.Accessible.get_text_iface(node)
        if iface and iface.get_character_count() > 0:
            return Atspi.Text.get_text(iface, 0, iface.get_character_count())
    except Exception:  # noqa: BLE001
        pass
    return ''


def normalize_text(value):
    value = unicodedata.normalize('NFC', value or '').replace(' ', '\n').replace(' ', '\n').replace('\xa0', ' ')
    value = re.sub(r'[​-‏‪-‮⁠-⁩﻿]', '', value)
    value = re.sub(r'[ \t]+', ' ', value)
    value = re.sub(r'\s*\n\s*', '\n', value)
    return value.strip()


def normalize_name(value):
    return re.sub(r'\s+', ' ', normalize_text(value)).lower()


def plain_name(value):
    """Назва без емодзі та розділових знаків: запасний запит, якщо точна назва нічого не знайшла."""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]+', ' ', normalize_text(value))).strip()


# ---------------------------------------------------------------- сеанс Viber

class Session:
    def __init__(self, payload):
        self.payload = payload
        self.app = None
        self.window = None
        self.pointer = Pointer()
        self.saved_clipboard = clipboard_read()
        self.steps = []
        self.started = time.time()

    # --- середовище
    def mark(self, step):
        self.steps.append([step, round(time.time() - self.started, 2)])
        log(step)

    def preflight(self):
        if not viber_process_running():
            raise Stop('skipped', 'viber_not_running', 'env')
        self.app = atspi_app()
        if self.app is None:
            raise Stop('skipped', 'accessibility_off', 'env')
        self.refresh_window()
        self.mark('середовище перевірено')

    def refresh_window(self):
        client = viber_client()
        if client is None:
            self.reveal_from_tray()
            client = viber_client()
        if client is None:
            raise Stop('skipped', 'viber_window_unavailable', 'env')
        self.window = client
        return client

    def reveal_from_tray(self):
        """Viber згорнуто в трей: пункт «Open Viber» його меню (dbusmenu) відкриває вікно, нічого не запускаючи."""
        try:
            import gi as _gi
            _gi.require_version('Gio', '2.0')
            from gi.repository import Gio, GLib
            bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
            watcher = bus.call_sync('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.freedesktop.DBus.Properties', 'Get',
                                    GLib.Variant('(ss)', ('org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems')), None, Gio.DBusCallFlags.NONE, 3000, None)
            items = [item for item in watcher.unpack()[0] if item.endswith('/StatusNotifierItem')]
            names = run(['busctl', '--user', 'list', '--no-legend']).stdout
            owners = {}
            for line in names.splitlines():
                parts = line.split()
                if len(parts) >= 3 and parts[2] == 'Viber':
                    owners[parts[0]] = True
            for item in items:
                bus_name = item.split('/')[0]
                if bus_name in owners:
                    bus.call_sync(bus_name, '/MenuBar', 'com.canonical.dbusmenu', 'Event', GLib.Variant('(isvu)', (1, 'clicked', GLib.Variant('s', ''), 0)), None, Gio.DBusCallFlags.NONE, 3000, None)
                    time.sleep(1.5)
                    return
        except Exception as error:  # noqa: BLE001
            log('трей недоступний: %s' % error)

    def frame(self):
        frames = [child for child in children(self.app) if child.get_role_name() == 'frame' and (child.get_name() or '') == 'Rakuten Viber']
        if not frames:
            frames = [child for child in children(self.app) if child.get_role_name() == 'frame' and visible(child)]
        if not frames:
            raise Stop('skipped', 'viber_window_unavailable', 'env')
        return frames[0]

    def origin(self):
        x, y, _, _ = extents(self.frame())
        return x, y

    def activate(self):
        hypr_dispatch('hl.dsp.focus({ window = "class:%s" })' % WINDOW_CLASS)
        deadline = time.time() + 3
        while time.time() < deadline:
            if has_state(self.frame(), Atspi.StateType.ACTIVE):
                return
            time.sleep(0.15)
        raise Stop('skipped', 'viber_window_unavailable', 'env', 'вікно не стало активним')

    def finish(self):
        try:
            self.pointer.restore()
        finally:
            if self.saved_clipboard is not None:
                try:
                    clipboard_write(self.saved_clipboard)
                except Exception:  # noqa: BLE001
                    pass

    # --- діалоги
    def dialogs(self):
        return [d for d in find_nodes(self.app, 'dialog') if visible(d)]

    def classify_dialog(self, dialog):
        title = (dialog.get_name() or '').strip()
        lowered = title.lower()
        for pattern, reason in BLOCKING_RULES:
            if pattern.search(lowered):
                return reason, title
        return 'blocking_dialog', title

    def close_dialog(self, dialog):
        buttons = [b for b in find_nodes(dialog, 'button') if (b.get_name() or '').strip().lower() in CLOSE_NAMES and visible(b)]
        if buttons:
            do_action(buttons[0], 'Press')
        else:
            key('', CODE_ESCAPE)
        time.sleep(0.4)

    def forward_dialog(self):
        for dialog in self.dialogs():
            if find_nodes(dialog, 'button', name='Forward'):
                return dialog
        return None

    def blocking_dialog(self):
        """Будь-який видимий діалог, що не є вікном «Forward»; повертає (причина, заголовок, вузол)."""
        for dialog in self.dialogs():
            if find_nodes(dialog, 'button', name='Forward'):
                continue
            reason, title = self.classify_dialog(dialog)
            return reason, title, dialog
        return None

    def raise_if_blocked(self):
        blocked = self.blocking_dialog()
        if blocked:
            reason, title, dialog = blocked
            self.close_dialog(dialog)
            raise Stop('skipped', reason, 'job', title)

    # --- частини чату
    def chat_panel(self):
        ox, oy = self.origin()
        panels = [p for p in find_nodes(self.app, 'panel') if extents(p)[2] > 500 and extents(p)[0] >= ox + 290 and extents(p)[3] > 900]
        if not panels:
            raise Stop('skipped', 'viber_window_unavailable', 'env', 'панель чату не знайдено')
        return panels[0]

    def composer(self):
        panel = self.chat_panel()
        px, py, pw, ph = extents(panel)
        found = [t for t in find_nodes(panel, 'text') if visible(t) and extents(t)[1] > py + ph - 110 and extents(t)[3] < 80]
        return found[0] if found else None

    def messages(self):
        """Видимі тексти повідомлень зверху вниз: [(y, x, w, h, text, node)]."""
        panel = self.chat_panel()
        px, py, pw, ph = extents(panel)
        top, bottom = py + 100, py + ph - 100
        items = []
        for node in find_nodes(panel, 'text'):
            e = extents(node)
            text = read_text(node)
            if text and e[3] > 0 and top <= e[1] <= bottom:
                items.append((e[1], e[0], e[2], e[3], text, node))
        items.sort(key=lambda item: item[0])
        return items

    def fingerprint(self):
        return '\n---\n'.join(normalize_text(item[4]) for item in self.messages()[-6:])

    def join_prompt(self):
        for button in find_nodes(self.app, 'button'):
            if visible(button) and (button.get_name() or '').strip().lower() in JOIN_NAMES:
                return button
        return None

    def header_avatar(self):
        ox, oy = self.origin()
        x, y, s = HEADER_AVATAR
        return grab(ox + x, oy + y, s, s)

    # --- навігація
    def open_my_notes(self):
        self.activate()
        ox, oy = self.origin()
        self.pointer.click(ox + MY_NOTES_TILE[0], oy + MY_NOTES_TILE[1])
        deadline = time.time() + 6
        while time.time() < deadline:
            time.sleep(0.4)
            if is_purple(self.header_avatar()) and self.composer() is not None:
                self.scroll_bottom()
                return
        raise Stop('skipped', 'my_notes_unavailable', 'env', 'плитка My Notes не відкрила нотатки')

    def scroll_bottom(self):
        ox, oy = self.origin()
        self.pointer.wheel(ox + 520, oy + 600, 40)

    def scroll_up(self, notches=5):
        ox, oy = self.origin()
        self.pointer.wheel(ox + 520, oy + 600, -notches)

    def locate_source(self, want):
        """Нотатка з точним підписом: від найновішої до старішої; повертає вузол тексту нижчого збігу."""
        for _ in range(16):
            hits = [item for item in self.messages() if normalize_text(item[4]) == want]
            if hits:
                return hits[-1]
            before = self.fingerprint()
            self.scroll_up(5)
            if self.fingerprint() == before:
                break
        raise Stop('skipped', 'source_missing', 'job')

    def open_forward_dialog(self, text_node):
        """Кнопка пересилання біля повідомлення не має розмірів (як і її сусідка — реакція «серце», яка з'являється лише
        при наведенні). Натискати наосліп не можна: можна поставити реакцію в чужому чаті. Тому курсор наводиться на
        повідомлення, і кандидатом є лише єдина кнопка без розмірів, коли «серце» поруч стало видимим."""
        panel_x, panel_y, panel_w, panel_h = extents(self.chat_panel())
        ex, ey, ew, eh = extents(text_node)
        point_y = min(max(ey + 24, panel_y + 130), panel_y + panel_h - 150)
        if not (ey <= point_y <= ey + eh):
            raise Stop('skipped', 'forward_unavailable', 'job', 'повідомлення не повністю в зоні чату')
        self.pointer.hover(ex + min(ew, 160) // 2 + 20, point_y)
        container = text_node.get_parent()
        siblings = children(container)
        index = text_node.get_index_in_parent()
        # Порядок у дереві стабільний: текст, потім видима при наведенні кнопка реакції (≈16-24 px), потім кнопка
        # пересилання без розмірів. Інакше не натискаємо нічого.
        heart = siblings[index + 1] if index + 1 < len(siblings) else None
        forward = siblings[index + 2] if index + 2 < len(siblings) else None
        ok = (heart is not None and forward is not None and heart.get_role_name() == 'button' and forward.get_role_name() == 'button'
              and visible(heart) and 10 <= extents(heart)[2] <= 32 and not visible(forward))
        if not ok:
            raise Stop('skipped', 'forward_unavailable', 'job', 'не вдалося однозначно знайти кнопку пересилання')
        hidden = [forward]
        do_action(hidden[0], 'Press')
        deadline = time.time() + 4
        while time.time() < deadline:
            time.sleep(0.3)
            dialog = self.forward_dialog()
            if dialog is not None:
                return dialog
            blocked = self.blocking_dialog()
            if blocked:
                self.close_dialog(blocked[2])
                raise Stop('skipped', blocked[0], 'job', blocked[1])
        # Англійська мова: кнопка діалогу називається «Forward». Діалог без такої кнопки означає іншу мову інтерфейсу.
        if self.dialogs():
            for dialog in self.dialogs():
                self.close_dialog(dialog)
            raise Stop('skipped', 'viber_language', 'env', 'у вікні пересилання немає кнопки «Forward»')
        raise Stop('skipped', 'forward_unavailable', 'job', 'вікно пересилання не відкрилося')

    def close_forward_dialog(self):
        dialog = self.forward_dialog()
        if dialog is not None:
            buttons = [b for b in find_nodes(dialog, 'button') if visible(b) and not (b.get_name() or '')]
            if buttons:
                do_action(sorted(buttons, key=lambda b: extents(b)[1])[0], 'Press')
            else:
                key('', CODE_ESCAPE)
            time.sleep(0.5)

    def dialog_search(self, dialog):
        dx, dy, dw, dh = extents(dialog)
        fields = [t for t in find_nodes(dialog, 'text') if visible(t)]
        if not fields:
            raise Stop('skipped', 'forward_unavailable', 'job', 'у вікні пересилання немає поля пошуку')
        return fields[0]

    def paste_into(self, field, text):
        self.activate()
        do_action(field, 'SetFocus')
        time.sleep(0.3)
        clipboard_write(text)
        time.sleep(0.35)
        key('CTRL', CODE_V)
        deadline = time.time() + 3
        while time.time() < deadline:
            time.sleep(0.25)
            if normalize_text(read_text(field)) == normalize_text(text):
                return
        raise Stop('skipped', 'input_not_set', 'env', 'пошук у вікні пересилання не прийняв текст')

    def result_rows(self, dialog):
        """Кружки вибору праворуч у рядках результатів: [(центр y)], за пікселями (рядки не є вузлами AT-SPI)."""
        import numpy as np
        dx, dy, dw, dh = extents(dialog)
        x0, x1 = dx + dw - 60, dx + dw - 28
        y0, y1 = dy + 105, dy + dh - 85
        arr = np.asarray(grab(x0, y0, x1 - x0, y1 - y0)).astype(int)
        luminance = arr.mean(axis=2)
        background = np.median(luminance)
        ink = (np.abs(luminance - background) > 25).any(axis=1)
        groups, start = [], None
        for index, flag in enumerate(ink):
            if flag and start is None:
                start = index
            if not flag and start is not None:
                groups.append((start, index - 1))
                start = None
        if start is not None:
            groups.append((start, len(ink) - 1))
        return [y0 + (a + b) // 2 for a, b in groups if 14 <= b - a + 1 <= 26]

    def row_avatar(self, dialog, center_y):
        dx, dy, dw, dh = extents(dialog)
        half = DIALOG_AVATAR_SIZE // 2
        return grab(dx + DIALOG_AVATAR_DX - half, center_y - half, DIALOG_AVATAR_SIZE, DIALOG_AVATAR_SIZE)

    def forward_enabled(self, dialog):
        buttons = find_nodes(dialog, 'button', name='Forward')
        return bool(buttons) and has_state(buttons[0], Atspi.StateType.ENABLED)


# ---------------------------------------------------------------- піксельні перевірки

def is_purple(image):
    import numpy as np
    mean = np.asarray(image).reshape(-1, 3).mean(axis=0)
    return mean[2] > 190 and mean[0] < 190 and mean[1] < 180 and mean[2] - mean[1] > 50


def avatar_vector(image, size=20):
    """Круглий аватар → вектор size×size×3 (поза колом нулі) і маска."""
    import numpy as np
    from PIL import Image
    side = min(image.size)
    left = (image.size[0] - side) // 2
    top = (image.size[1] - side) // 2
    square = image.crop((left, top, left + side, top + side))
    # знімаємо краї: у списку аватар має 1-2 px обводки/тіні
    margin = max(1, side // 12)
    square = square.crop((margin, margin, side - margin, side - margin)).resize((size, size), Image.LANCZOS)
    arr = np.asarray(square).astype(float)
    yy, xx = np.mgrid[0:size, 0:size]
    radius = size / 2 - 0.5
    mask = ((yy - (size - 1) / 2) ** 2 + (xx - (size - 1) / 2) ** 2) <= (radius * 0.92) ** 2
    return arr, mask


def avatar_similarity(a, b):
    """0..1: 1 мінус нормована різниця за кольором і яскравістю в колі, поправлена кореляцією яскравості."""
    import numpy as np
    va, mask = avatar_vector(a)
    vb, _ = avatar_vector(b)
    diff = np.abs(va - vb)[mask].mean() / 255.0
    la, lb = va.mean(axis=2)[mask], vb.mean(axis=2)[mask]
    if la.std() < 1e-6 or lb.std() < 1e-6:
        corr = 1.0 if abs(la.mean() - lb.mean()) < 18 else 0.0
    else:
        corr = float(np.corrcoef(la, lb)[0, 1])
    return max(0.0, min(1.0, (1.0 - diff * 1.6) * 0.6 + max(0.0, corr) * 0.4))


def region_changed(a, b, threshold=7.0):
    import numpy as np
    if a.size != b.size:
        return True
    return float(np.abs(np.asarray(a).astype(int) - np.asarray(b).astype(int)).mean()) > threshold


def region_differs(a, b, fraction=0.004):
    """Чи змінилась помітна частка пікселів (час і галочки бульбашки): надійніше за середню різницю на малій області.
    Приймає пару зображень (над підписом і під ним); достатньо зміни в одному з них."""
    import numpy as np
    if a is None or b is None:
        return True
    for first, second in zip(a, b):
        if first.size != second.size:
            return True
        diff = np.abs(np.asarray(first).astype(int) - np.asarray(second).astype(int)).max(axis=2)
        if float((diff > 60).mean()) > fraction:
            return True
    return False


# ---------------------------------------------------------------- вхідні дані

def deep_link(url):
    match = re.match(r'^https?://invite\.viber\.com(?:/|\?|$)', url or '', re.I)
    if not match:
        return ''
    token = re.search(r'[?&]g2=([^&#]+)', url, re.I)
    if not token:
        return ''
    from urllib.parse import quote, unquote
    value = unquote(token.group(1)).strip()
    return 'viber://community_invite?data=' + quote(value, safe='') if value else ''


def validate_payload(payload):
    text = normalize_text(str(payload.get('message') or ''))
    name = str(payload.get('expectedName') or '').strip()
    test_target = payload.get('testTarget')
    if not text or len(text) > 5000:
        raise Stop('failed', 'invalid_request', 'job')
    if test_target == 'my_notes':
        return text, name or 'My Notes', ''
    link = deep_link(str(payload.get('url') or ''))
    if not link:
        raise Stop('skipped', 'invalid_viber_link', 'job')
    if not name:
        raise Stop('skipped', 'target_name_missing', 'job')
    return text, name, link


# ---------------------------------------------------------------- навігація до цільового чату

def navigate_target(session, link, test_mode):
    """Відкриває цільовий чат: повертає (відбиток, аватар шапки)."""
    if test_mode:
        session.open_my_notes()
        return session.fingerprint(), session.header_avatar()
    before_avatar = session.header_avatar()
    before = session.fingerprint()
    subprocess.Popen(['xdg-open', link], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    started = time.time()
    stable_since = None
    no_composer_since = None
    while time.time() - started < STEP_TIMEOUT:
        time.sleep(0.4)
        session.raise_if_blocked()
        composer = session.composer()
        if session.join_prompt() is not None and composer is None:
            raise Stop('skipped', 'viber_not_joined', 'job', 'чат ще не приєднано')
        fingerprint = session.fingerprint()
        avatar = session.header_avatar()
        changed = bool(fingerprint and fingerprint != before) or region_changed(avatar, before_avatar, 12.0)
        if not changed:
            stable_since = None
            continue
        if composer is not None:
            no_composer_since = None
            stable_since = stable_since or time.time()
            if time.time() - stable_since >= 1.5:
                return fingerprint, avatar
        else:
            stable_since = None
            no_composer_since = no_composer_since or time.time()
            if time.time() - no_composer_since >= 6:
                raise Stop('skipped', 'viber_read_only', 'job', 'у чаті немає поля повідомлення')
    raise Stop('skipped', 'target_unconfirmed', 'job', 'чат за посиланням не відкрився або не змінився')


# ---------------------------------------------------------------- дії

def action_status(payload):
    if not viber_process_running():
        return {'ok': True, 'status': 'skipped', 'reason': 'viber_not_running', 'severity': 'env'}
    if atspi_app() is None:
        return {'ok': True, 'status': 'skipped', 'reason': 'accessibility_off', 'severity': 'env'}
    if viber_client() is None:
        return {'ok': True, 'status': 'skipped', 'reason': 'viber_window_unavailable', 'severity': 'env'}
    return {'ok': True, 'status': 'ready'}


def action_post(session, payload):
    text, name, link = validate_payload(payload)
    test_mode = payload.get('testTarget') == 'my_notes'
    dry_run = payload.get('dryRun') is True

    session.preflight()
    session.activate()
    session.raise_if_blocked()
    session.open_my_notes()
    source = session.locate_source(text)
    session.mark('нотатку знайдено')
    if dry_run:
        return {'ok': True, 'status': 'dry_run', 'reason': None, 'sourceFound': True, 'deepLinkOk': bool(link) or test_mode, 'steps': session.steps}

    # 1) цільовий чат: відкриття, відбиток, аватар
    target_fingerprint, target_avatar = navigate_target(session, link, test_mode)
    session.mark('цільовий чат відкрито')
    session.scroll_bottom()
    time.sleep(0.8)
    baseline_messages = session.messages()
    baseline_last = baseline_messages[-1] if baseline_messages else None
    baseline_region = region_below(session, baseline_last)

    # 2) джерело знову (після переходу прокрутка могла змінитись) і вікно «Forward»
    session.open_my_notes()
    source = session.locate_source(text)
    dialog = session.open_forward_dialog(source[5])
    session.mark('вікно пересилання відкрито')
    try:
        selected = choose_target(session, dialog, name, target_avatar)
        session.mark('чат вибрано, збіг однозначний')
        press_forward(session, dialog)
    except Stop:
        session.close_forward_dialog()
        raise
    session.mark('Forward натиснуто')

    # 3) підтвердження: чат знову відкрито, останнє повідомлення з нашим підписом
    confirmed = confirm_arrival(session, link, test_mode, text, baseline_last, baseline_region)
    if not confirmed:
        raise Stop('failed', 'send_not_confirmed', 'after', 'після Forward повідомлення в чаті не з’явилось')
    session.mark('повідомлення підтверджено')
    return {'ok': True, 'status': 'sent', 'reason': None, 'observedTarget': name, 'targetVerified': True, 'sendConfirmed': True, 'steps': session.steps}


def region_below(session, last):
    """Область часу й галочок останнього повідомлення для порівняння «до/після»: у «фото + підпис» час лежить на фото
    над підписом, у текстових повідомленнях — під текстом; беремо обидві смуги."""
    if last is None:
        return None
    y, x, w, h = last[0], last[1], last[2], last[3]
    left = max(0, x + w - 100)
    return (grab(left, max(0, y - 44), 110, 36), grab(left, y + h, 110, 30))


def choose_target(session, dialog, name, target_avatar):
    queries = [name]
    simple = plain_name(name)
    if simple and normalize_name(simple) != normalize_name(name):
        queries.append(simple)
    field = session.dialog_search(dialog)
    rows = []
    used = ''
    for query in queries:
        if used:
            # очистити поле перед запасним запитом
            do_action(field, 'SetFocus')
            time.sleep(0.2)
            key('CTRL', CODE_A)
            time.sleep(0.2)
        session.paste_into(field, query)
        time.sleep(1.1)
        rows = session.result_rows(dialog)
        used = query
        if rows:
            break
    if not rows:
        raise Stop('skipped', 'target_not_found', 'job', 'жоден чат у вікні пересилання не збігається з назвою')
    if len(rows) > 1:
        raise Stop('skipped', 'target_ambiguous', 'job', 'знайдено чатів: %d' % len(rows))
    similarity = avatar_similarity(target_avatar, session.row_avatar(dialog, rows[0]))
    log('подібність аватара: %.3f' % similarity)
    if similarity < AVATAR_MATCH_MIN:
        raise Stop('skipped', 'avatar_mismatch', 'job', 'подібність аватара %.2f' % similarity)
    key('', CODE_RETURN)
    deadline = time.time() + 3
    while time.time() < deadline:
        time.sleep(0.3)
        if session.forward_enabled(dialog):
            return rows[0]
    raise Stop('skipped', 'target_unconfirmed', 'job', 'вибір чату не підтверджено')


def press_forward(session, dialog):
    button = find_nodes(dialog, 'button', name='Forward')[0]
    if not has_state(button, Atspi.StateType.ENABLED):
        raise Stop('skipped', 'target_unconfirmed', 'job', 'кнопка Forward неактивна')
    do_action(button, 'Press')
    deadline = time.time() + 25
    while time.time() < deadline:
        time.sleep(0.4)
        if session.forward_dialog() is None:
            return
    raise Stop('failed', 'send_not_confirmed', 'after', 'вікно пересилання не закрилося')


def confirm_arrival(session, link, test_mode, text, baseline_last, baseline_region):
    if test_mode:
        session.open_my_notes()
    else:
        subprocess.Popen(['xdg-open', link], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.2)
    deadline = time.time() + 30
    while time.time() < deadline:
        time.sleep(0.8)
        try:
            session.raise_if_blocked()
        except Stop:
            return False
        session.scroll_bottom()
        messages = session.messages()
        if not messages:
            continue
        last = messages[-1]
        if normalize_text(last[4]) != text:
            continue
        if not outgoing_bubble(session, last):
            continue
        baseline_same_text = baseline_last is not None and normalize_text(baseline_last[4]) == text
        if not baseline_same_text:
            return True
        # Попереднє останнє повідомлення вже було таким самим (наш учорашній пост): доказом служить зміна часу/галочок.
        if region_differs(region_below(session, last), baseline_region):
            return True
    return False


def outgoing_bubble(session, message):
    """Вихідні повідомлення — фіолетові бульбашки, вхідні — білі: медіана кольору області тексту (вузол займає всю бульбашку)."""
    import numpy as np
    y, x, w, h = message[0], message[1], message[2], message[3]
    area = np.asarray(grab(max(0, x), max(0, y), max(8, w), max(8, min(h, 600)))).reshape(-1, 3)
    median = np.median(area, axis=0)
    return median[2] > 190 and median[0] < 190 and median[2] - median[1] > 50


def action_avatar(session, payload):
    """Діагностика: порівнює аватар відкритого чату з рядком, який дає пошук name у вікні «Forward»."""
    name = str(payload.get('expectedName') or '').strip()
    session.preflight()
    session.activate()
    header = session.header_avatar()
    messages = session.messages()
    if not messages:
        raise Stop('skipped', 'source_missing', 'job', 'у відкритому чаті немає видимих текстових повідомлень')
    dialog = session.open_forward_dialog(messages[-1][5])
    try:
        field = session.dialog_search(dialog)
        session.paste_into(field, name)
        time.sleep(1.1)
        rows = session.result_rows(dialog)
        scores = [round(avatar_similarity(header, session.row_avatar(dialog, y)), 3) for y in rows]
    finally:
        session.close_forward_dialog()
    return {'ok': True, 'status': 'ready', 'rows': len(rows), 'scores': scores}


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'status'
    try:
        raw = sys.stdin.read() if not sys.stdin.isatty() else ''
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError:
        print(json.dumps({'ok': False, 'status': 'failed', 'reason': 'invalid_request', 'severity': 'job'}))
        return
    if action == 'status':
        print(json.dumps(action_status(payload), ensure_ascii=False))
        return
    session = Session(payload)
    try:
        if action == 'post':
            result = action_post(session, payload)
        elif action == 'avatar':
            result = action_avatar(session, payload)
        else:
            result = {'ok': False, 'status': 'failed', 'reason': 'unknown_action', 'severity': 'job'}
    except Stop as stop:
        result = {'ok': True, 'status': stop.status, 'reason': stop.reason, 'severity': stop.severity, 'detail': stop.detail, 'steps': session.steps}
    except Exception as error:  # noqa: BLE001
        log('помилка помічника: %r' % (error,))
        result = {'ok': False, 'status': 'failed', 'reason': 'helper_error', 'severity': 'after' if any(s[0] == 'Forward натиснуто' for s in session.steps) else 'job', 'detail': str(error)[:160], 'steps': session.steps}
    finally:
        session.finish()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
