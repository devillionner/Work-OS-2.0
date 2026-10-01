#!/usr/bin/env bash
# Один запуск для перевірки WhatsApp «Очікування» на Linux:
# відкриває браузер з окремим профілем і портом CDP, потім запускає локальний runner.
# Налаштування (необов'язково): WORK_OS_URL, WORK_OS_BROWSER, WORK_OS_CDP_PORT.
set -euo pipefail

WORK_OS_URL="${WORK_OS_URL:-https://work-os-2-staging.devillionner.workers.dev}"
PORT="${WORK_OS_CDP_PORT:-9222}"
PROFILE="${WORK_OS_BROWSER_PROFILE:-$HOME/.local/share/work-os-runner-browser}"
CDP="http://127.0.0.1:${PORT}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Лише один runner одночасно (автозапуск + ручний запуск не дублюються).
# Браузер запускається з закритим дескриптором 9, щоб не тримати lock після зупинки runner.
if command -v flock >/dev/null 2>&1; then
  exec 9>"${XDG_RUNTIME_DIR:-/tmp}/work-os-whatsapp-runner.lock"
  if ! flock -n 9; then echo "Runner уже запущений — другий не потрібен."; exit 0; fi
fi

cdp_ready() { curl -fsS --max-time 2 "${CDP}/json/version" >/dev/null 2>&1; }

if ! cdp_ready; then
  BROWSER="${WORK_OS_BROWSER:-}"
  if [ -z "$BROWSER" ]; then
    for candidate in opera google-chrome google-chrome-stable chromium chromium-browser brave-browser; do
      if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$candidate"; break; fi
    done
  fi
  if [ -z "$BROWSER" ]; then
    echo "Не знайдено Opera/Chrome/Chromium. Вкажіть: WORK_OS_BROWSER=/шлях/до/браузера $0" >&2
    exit 1
  fi
  # Після входу в систему мережа з'являється не одразу; інакше вкладка Work OS лишиться зі сторінкою помилки.
  for _ in $(seq 1 60); do curl -fsS --max-time 3 -o /dev/null "$WORK_OS_URL" && break; sleep 1; done
  mkdir -p "$PROFILE"
  echo "Відкриваю $BROWSER (окремий профіль: $PROFILE)…"
  setsid "$BROWSER" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check \
    "$WORK_OS_URL" "https://web.whatsapp.com/" >/dev/null 2>&1 < /dev/null 9>&- &
  for _ in $(seq 1 30); do cdp_ready && break; sleep 1; done
  if ! cdp_ready; then
    echo "Браузер не відкрив порт ${PORT}. Якщо він уже був запущений без нього — закрийте його й повторіть." >&2
    exit 1
  fi
fi

cat <<EOF

Браузер готовий. Якщо це перший запуск цього профілю:
  1. увійдіть у Work OS і в WhatsApp Web (QR-код);
  2. у Work OS: «Знайти чати» → «Executor пошуку чатів» → створіть executor.
Runner сам підхопить його протягом хвилини. Потім натисніть «Перевірити зараз».
Зупинити runner: Ctrl+C.

EOF

cd "$ROOT"
export WORK_OS_URL WORK_OS_WHATSAPP_CDP="$CDP"
exec node scripts/chat-discovery-runner.mjs --token-from-work-os-page
