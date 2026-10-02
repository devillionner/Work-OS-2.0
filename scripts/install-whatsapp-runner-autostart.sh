#!/usr/bin/env bash
# Вмикає автозапуск runner перевірки WhatsApp при вході в систему (Linux, XDG autostart).
# Запускається іконка в треї (scripts/work-os-runner-tray.py): вона стартує runner, показує його стан
# і дає зупинити/перезапустити його або вийти.
# Вимкнути: scripts/install-whatsapp-runner-autostart.sh --remove
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTOSTART="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/work-os-whatsapp-runner.desktop"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/work-os"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$AUTOSTART"
  echo "Автозапуск вимкнено. Запущений зараз runner зупиниться після виходу з системи."
  exit 0
fi

mkdir -p "$(dirname "$AUTOSTART")" "$LOG_DIR"
cat > "$AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=Work OS runner
Comment=Іконка в треї для локального runner Work OS
Exec=/usr/bin/env python3 "$ROOT/scripts/work-os-runner-tray.py"
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

echo "Автозапуск увімкнено: $AUTOSTART"
echo "Журнал runner: $LOG_DIR/whatsapp-runner.log"
echo "Запускаю іконку в треї зараз, щоб не чекати перезаходу…"
setsid /usr/bin/env python3 "$ROOT/scripts/work-os-runner-tray.py" >>"$LOG_DIR/whatsapp-runner.log" 2>&1 < /dev/null &
echo "Готово. Runner працює з іконки в треї: клацніть по ній, щоб побачити стан або зупинити його."
