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
WAYDROID_HANDLER="$APPS/work-os-waydroid.desktop"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/work-os"
BIN_DIR="$HOME/.local/bin"
HIDE_BIN="$BIN_DIR/work-os-hide-waydroid-icons"
HIDE_PATH_UNIT="$UNIT_DIR/work-os-hide-waydroid-icons.path"
HIDE_SERVICE_UNIT="$UNIT_DIR/work-os-hide-waydroid-icons.service"

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now work-os-runner-tray.service 2>/dev/null || true
  systemctl --user disable --now work-os-hide-waydroid-icons.path 2>/dev/null || true
  rm -f "$UNIT" "$HANDLER" "$WAYDROID_HANDLER" "$OLD_AUTOSTART" "$HIDE_BIN" "$HIDE_PATH_UNIT" "$HIDE_SERVICE_UNIT"
  # Копії системних ярликів Waydroid, які ми ховали (NoDisplay), прибираємо: меню програм знову бачить системні.
  for name in Waydroid.desktop waydroid.market.desktop waydroid.app.install.desktop; do
    [ -f "$APPS/$name" ] && [ -f "/usr/share/applications/$name" ] && rm -f "$APPS/$name"
  done
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
# Node, поставлений інсталятором без root, лежить у ~/.local/bin; systemd user не завжди має його в PATH.
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
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

# Вікно Waydroid відкривається лише за дією власника (кнопка «Відкрити вікно» в картці Viber): обробник workos-waydroid:// без параметрів.
cat > "$WAYDROID_HANDLER" <<WAYDROID_EOF
[Desktop Entry]
Type=Application
Name=Work OS: вікно Android
Comment=Показує вікно Waydroid, коли Android просить дозвіл
Exec="$ROOT/scripts/work-os-waydroid-show.sh"
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/workos-waydroid;
WAYDROID_EOF

# Ярлики Android-застосунків Waydroid (Viber, Gmail, Play тощо) не мають засмічувати меню програм: Android працює в фоні. Скрипт ховає їх
# (NoDisplay=true), а user-сервіс .path запускає його щоразу, як у теці ярликів щось змінюється (Waydroid створює нові при встановленні
# застосунків). Лише коли Waydroid встановлений.
if command -v waydroid >/dev/null 2>&1; then
  mkdir -p "$BIN_DIR"
  install -m 755 "$ROOT/scripts/work-os-hide-waydroid-icons.sh" "$HIDE_BIN"
  cat > "$HIDE_SERVICE_UNIT" <<HIDE_SERVICE_EOF
[Unit]
Description=Work OS: ховати ярлики Android (Waydroid) з меню програм

[Service]
Type=oneshot
ExecStart=%h/.local/bin/work-os-hide-waydroid-icons
HIDE_SERVICE_EOF
  cat > "$HIDE_PATH_UNIT" <<HIDE_PATH_EOF
[Unit]
Description=Work OS: стежити за новими ярликами Waydroid

[Path]
PathChanged=%h/.local/share/applications

[Install]
WantedBy=default.target
HIDE_PATH_EOF
fi

rm -f "$OLD_AUTOSTART"
update-desktop-database "$APPS" 2>/dev/null || true
xdg-mime default work-os-runner.desktop x-scheme-handler/workos-runner
xdg-mime default work-os-waydroid.desktop x-scheme-handler/workos-waydroid
systemctl --user daemon-reload
systemctl --user enable work-os-runner-tray.service
if [ -f "$HIDE_PATH_UNIT" ]; then
  systemctl --user enable --now work-os-hide-waydroid-icons.path 2>/dev/null || true
  "$HIDE_BIN" 2>/dev/null || true
fi

echo "Готово. Сервіс: $UNIT"
echo "Обробник workos-runner:// встановлено. Журнал runner: $LOG_DIR/whatsapp-runner.log"
echo "Запустити зараз (старий трей треба закрити): systemctl --user restart work-os-runner-tray.service"
