#!/usr/bin/env bash
# Один запуск для перевірки WhatsApp «Очікування» на Linux:
# відкриває браузер з окремим профілем і портом CDP, потім запускає локальний runner.
# Налаштування (необов'язково): WORK_OS_URL, WORK_OS_BROWSER, WORK_OS_CDP_PORT.
set -euo pipefail

# Налаштування, які записав scripts/install-runner.sh (браузер, профіль, адреса Work OS); змінні середовища сильніші.
RUNNER_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/work-os/runner.env"
if [ -f "$RUNNER_CONF" ]; then
  while IFS='=' read -r key value; do
    case "$key" in WORK_OS_BROWSER|WORK_OS_BROWSER_PROFILE|WORK_OS_URL|WORK_OS_EXECUTOR_TOKEN|WORK_OS_RUNNER_HEADLESS) [ -z "${!key:-}" ] && export "$key=$(eval "printf '%s' $value")";; esac
  done < "$RUNNER_CONF"
fi
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

# Браузер runner без вікна (3.17.4): `--headless=new` з тим самим профілем і портом, тож сесії WhatsApp і Telegram ті самі, а вікно
# нічого не відкриває на робочому столі й не забирає фокус. Режим: WORK_OS_RUNNER_HEADLESS=1|0 (сильніше за все), потім файл
# `runner-browser-mode` («headless» чи «window»; його пише трей кнопкою «Показати браузер runner» / «Сховати»), інакше на GNOME без
# вікна, на решті середовищ як раніше. Профіль без входів (немає теки Default) і Opera відкриваються з вікном: у першому QR-код,
# а Opera не підтримує режим без вікна.
MODE_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/work-os/runner-browser-mode"
want_headless() {
  case "${WORK_OS_RUNNER_HEADLESS:-}" in 1|true|yes) return 0;; 0|false|no) return 1;; esac
  case "$(basename "$1")" in opera*) return 1;; esac
  [ -d "$PROFILE/Default" ] || return 1
  if [ -f "$MODE_FILE" ]; then
    case "$(cat "$MODE_FILE" 2>/dev/null)" in window) return 1;; headless) return 0;; esac
  fi
  case "${XDG_CURRENT_DESKTOP:-}:${DESKTOP_SESSION:-}" in *GNOME*|*gnome*) return 0;; esac
  return 1
}
# Звичайний User-Agent без «Headless»: WhatsApp Web і Telegram Web відмовляють браузерам, що себе так називають.
headless_user_agent() {
  local version major
  version="$("$1" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  major="${version%%.*}"
  [ -n "$major" ] || major=130
  printf 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s.0.0.0 Safari/537.36' "$major"
}

cdp_ready() { curl -fsS --max-time 2 "${CDP}/json/version" >/dev/null 2>&1; }

STATUS_FILE="${WORK_OS_RUNNER_STATUS_FILE:-${XDG_STATE_HOME:-$HOME/.local/state}/work-os/runner-status.json}"
write_status() {
  mkdir -p "$(dirname "$STATUS_FILE")"
  printf '{"state":"%s","detail":"%s","pid":%s,"updatedAt":%s000}\n' "$1" "$2" "$$" "$(date +%s)" > "$STATUS_FILE"
}

# The everyday browser already opens with the CDP port (its desktop entry carries the flag): then wait for
# it instead of starting a second profile that grabs the port first and has no Work OS executor.
main_browser_has_cdp() {
  local f
  for f in "${XDG_DATA_HOME:-$HOME/.local/share}"/applications/*.desktop; do
    # Власний запис runner (work-os-runner-browser.desktop) — не «ваш щоденний браузер»: на нього не чекаємо.
    case "$f" in */work-os-runner-browser.desktop) continue;; esac
    grep -qs -- "--remote-debugging-port=${PORT}" "$f" && return 0
  done
  return 1
}

if ! cdp_ready && [ -z "${WORK_OS_BROWSER:-}" ] && main_browser_has_cdp; then
  echo "Чекаю, поки відкриється ваш браузер з портом ${PORT}…"
  write_status no_browser "Відкрийте Opera — runner чекає на неї"
  until cdp_ready; do sleep 10; done
fi

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
  MODE_FLAGS=()
  if want_headless "$BROWSER"; then
    MODE_FLAGS=(--headless=new "--user-agent=$(headless_user_agent "$BROWSER")" --window-size=1400,900)
    echo "Відкриваю $BROWSER без вікна (окремий профіль: $PROFILE)…"
  else
    echo "Відкриваю $BROWSER (окремий профіль: $PROFILE)…"
  fi
  # Прапорці проти гальмування прихованих вікон: автопост працює, поки власник дивиться відео на весь екран в іншому вікні.
  # Без вікна браузер приймає лише одну адресу в аргументах («Multiple targets are not supported in headless mode»): решта вкладок
  # відкривається через CDP, коли порт готовий.
  if [ "${#MODE_FLAGS[@]}" -gt 0 ]; then START_URLS=("$WORK_OS_URL"); else START_URLS=("$WORK_OS_URL" "https://web.whatsapp.com/" "https://web.telegram.org/a/"); fi
  setsid "$BROWSER" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
    --no-first-run --no-default-browser-check "${MODE_FLAGS[@]}" \
    "${START_URLS[@]}" >/dev/null 2>&1 < /dev/null 9>&- &
  for _ in $(seq 1 30); do cdp_ready && break; sleep 1; done
  if [ "${#MODE_FLAGS[@]}" -gt 0 ] && cdp_ready; then
    for extra in "https://web.whatsapp.com/" "https://web.telegram.org/a/"; do
      curl -fsS --max-time 5 -X PUT "${CDP}/json/new?${extra}" >/dev/null 2>&1 || true
    done
  fi
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
