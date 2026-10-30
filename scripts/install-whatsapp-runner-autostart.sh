#!/usr/bin/env bash
# Ставить runner Work OS «без рук» на Linux (усе на рівні користувача, root не потрібен):
#   1. systemd user-сервіс work-os-runner-tray.service (Restart=on-failure): піднімає іконку в треї при вході й після збою;
#      іконка сама стартує runner, перезапускає його після зміни файлів і піднімає, якщо він упав;
#   2. обробник посилання workos-runner:// (кнопка «Запустити runner» у Work OS): лише будить трей, параметрів із посилання не читає.
# Старий XDG-автозапуск прибирається, щоб трей не стартував двічі.
# Обробник стартує сервіс (після «Вимкнути повністю» він знову стає під systemd) і будить трей сигналом, щоб скинути паузу.
# Вимкнути: scripts/install-whatsapp-runner-autostart.sh --remove
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/work-os-runner-tray.service"
OLD_AUTOSTART="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/work-os-whatsapp-runner.desktop"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
HANDLER="$APPS/work-os-runner.desktop"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/work-os"

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now work-os-runner-tray.service 2>/dev/null || true
  rm -f "$UNIT" "$HANDLER" "$OLD_AUTOSTART"
  systemctl --user daemon-reload || true
  update-desktop-database "$APPS" 2>/dev/null || true
  echo "Автозапуск і обробник посилання вимкнено."
  exit 0
fi

mkdir -p "$UNIT_DIR" "$APPS" "$LOG_DIR"
# KillMode=process: після збою трея systemd вбиває лише його, а runner (власна сесія) переживає й підхоплюється новим треєм.
cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=Work OS runner (іконка в треї)
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/env python3 "$ROOT/scripts/work-os-runner-tray.py"
Restart=on-failure
RestartSec=3
KillMode=process

[Install]
WantedBy=graphical-session.target
UNIT_EOF

cat > "$HANDLER" <<HANDLER_EOF
[Desktop Entry]
Type=Application
Name=Work OS runner
Comment=Запускає іконку runner Work OS у треї
Exec="$ROOT/scripts/work-os-runner-launch.sh"
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/workos-runner;
HANDLER_EOF

rm -f "$OLD_AUTOSTART"
update-desktop-database "$APPS" 2>/dev/null || true
xdg-mime default work-os-runner.desktop x-scheme-handler/workos-runner
systemctl --user daemon-reload
systemctl --user enable work-os-runner-tray.service

echo "Готово. Сервіс: $UNIT"
echo "Обробник workos-runner:// встановлено. Журнал runner: $LOG_DIR/whatsapp-runner.log"
echo "Запустити зараз (старий трей треба закрити): systemctl --user restart work-os-runner-tray.service"
