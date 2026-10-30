#!/usr/bin/env bash
# Обробник workos-runner://start. Параметрів із посилання не читає: лише стартує сервіс трея (після «Вимкнути повністю» він знову
# стає під systemd) і будить трей сигналом, щоб він забув паузу між спробами й підняв runner.
systemctl --user start work-os-runner-tray.service
sleep 1
pid="$(cat "${XDG_RUNTIME_DIR:-/tmp}/work-os-runner-tray.lock" 2>/dev/null || true)"
[ -n "$pid" ] && kill -USR1 "$pid" 2>/dev/null || true
exit 0
