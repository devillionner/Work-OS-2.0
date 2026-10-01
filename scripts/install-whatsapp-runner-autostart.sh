#!/usr/bin/env bash
# Вмикає автозапуск runner перевірки WhatsApp при вході в систему (Linux, XDG autostart).
# Після цього достатньо натиснути «Перевірити зараз» у Work OS.
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
Name=Work OS WhatsApp runner
Comment=Перевірка чатів WhatsApp «Очікування» для Work OS
Exec=/usr/bin/env bash -c 'exec "$ROOT/scripts/whatsapp-runner.sh" >>"$LOG_DIR/whatsapp-runner.log" 2>&1'
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

echo "Автозапуск увімкнено: $AUTOSTART"
echo "Журнал runner: $LOG_DIR/whatsapp-runner.log"
echo "Запускаю runner зараз, щоб не чекати перезаходу…"
setsid /usr/bin/env bash -c "exec \"$ROOT/scripts/whatsapp-runner.sh\" >>\"$LOG_DIR/whatsapp-runner.log\" 2>&1" < /dev/null &
echo "Готово. Відкриється окреме вікно браузера з Work OS і WhatsApp Web — залиште його відкритим."
