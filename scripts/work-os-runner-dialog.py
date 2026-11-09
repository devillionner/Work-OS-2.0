#!/usr/bin/env python3
"""Вікно пароля для «Зберегти для перенесення»: пароль архіву (двічі) і, коли треба, пароль користувача для даних Android.

Пароль друкується лише в stdout цього процесу, який читає runner на тому самому ПК; у Work OS, хмару чи live-канал він не йде.
Виклик: work-os-runner-dialog.py --size "1,6 ГБ" [--sudo] [--daily "Opera"]
Вихід: {"ok": true, "password": "...", "sudo": "..."} або {"ok": false}.
"""
import argparse
import json
import sys

import gi

gi.require_version('Gtk', '3.0')
from gi.repository import Gtk  # noqa: E402

MIN_LENGTH = 8


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--size', default='')
    parser.add_argument('--sudo', action='store_true')
    parser.add_argument('--daily', default='')
    args = parser.parse_args()

    result = {'ok': False}
    window = Gtk.Window(title='Work OS: зберегти для перенесення')
    window.set_default_size(460, -1)
    window.set_position(Gtk.WindowPosition.CENTER)
    window.set_keep_above(True)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
    box.set_border_width(18)
    window.add(box)

    def label(text, bold=False):
        item = Gtk.Label(label=text, xalign=0)
        item.set_line_wrap(True)
        item.set_max_width_chars(60)
        if bold:
            item.set_markup(f'<b>{GLib_escape(text)}</b>')
        box.pack_start(item, False, False, 0)
        return item

    def GLib_escape(text):
        return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    label('Архів входів зашифрується цим паролем на цьому ПК. Пароль не передається в Work OS, його не можна відновити: без нього архів не відкрити.', False)
    if args.size:
        label(f'Орієнтовний розмір (без кешів): {args.size}. Архів буде меншим.')
    steps = 'Runner закриє свій браузер і зупинить Android (Waydroid), запакує дані, вивантажить у хмару й усе підніме назад.'
    if args.daily:
        steps = f'Runner працює у вашому щоденному браузері ({args.daily}): його буде закрито на час копіювання, вкладки повернуться після відкриття. ' + steps
    label(steps)

    password = Gtk.Entry(visibility=False, placeholder_text='Пароль архіву (від 8 символів)')
    repeat = Gtk.Entry(visibility=False, placeholder_text='Пароль ще раз')
    box.pack_start(password, False, False, 0)
    box.pack_start(repeat, False, False, 0)
    sudo = None
    if args.sudo:
        label('Дані Android у Waydroid належать системним користувачам Android, тож для їх копіювання потрібні права root. Введіть пароль вашого облікового запису (sudo); він використовується лише для однієї команди tar і ніде не зберігається.')
        sudo = Gtk.Entry(visibility=False, placeholder_text='Пароль користувача (sudo)')
        box.pack_start(sudo, False, False, 0)
    error = Gtk.Label(label='', xalign=0)
    box.pack_start(error, False, False, 0)
    buttons = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
    cancel = Gtk.Button(label='Скасувати')
    go = Gtk.Button(label='Зберегти')
    buttons.pack_end(go, False, False, 0)
    buttons.pack_end(cancel, False, False, 0)
    box.pack_start(buttons, False, False, 0)

    def submit(*_):
        if len(password.get_text()) < MIN_LENGTH:
            error.set_text(f'Пароль архіву — від {MIN_LENGTH} символів.')
            return
        if password.get_text() != repeat.get_text():
            error.set_text('Паролі не збігаються.')
            return
        if sudo is not None and not sudo.get_text():
            error.set_text('Потрібен пароль користувача для даних Android.')
            return
        result['ok'] = True
        result['password'] = password.get_text()
        if sudo is not None:
            result['sudo'] = sudo.get_text()
        Gtk.main_quit()

    go.connect('clicked', submit)
    repeat.connect('activate', submit)
    cancel.connect('clicked', lambda *_: Gtk.main_quit())
    window.connect('destroy', lambda *_: Gtk.main_quit())
    window.show_all()
    Gtk.main()
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == '__main__':
    main()
