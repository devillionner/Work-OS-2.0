#!/usr/bin/env bash
# Перенесення runner Work OS без повторної прив'язки: один зашифрований архів з усім, що тримає входи й стан.
#   scripts/runner-backup.sh backup [файл.wosrunner] [--browser-profile ТЕКА]   — зібрати архів (спитає пароль)
#   scripts/runner-backup.sh restore файл.wosrunner                             — розгорнути на новій системі
# У архіві (шляхи відносно домашньої теки):
#   - профіль браузера runner (сесії WhatsApp Web і Telegram Web): окремий профіль runner або профіль вашого браузера з портом CDP;
#   - дані Waydroid (~/.local/share/waydroid: Android із уже активованим Viber), потрібен sudo, бо файли мають uid Android;
#   - ключ adb (~/.android/adbkey*), налаштування runner (~/.config/work-os) і два невеликі файли пам'яті Telegram.
# УВАГА: архів містить ВХОДИ в WhatsApp, Telegram і Viber. Шифрується паролем (AES-256, PBKDF2), але тримайте його в безпечному
# місці й не віддавайте нікому. Пароль не відновлюється.
# Пароль можна передати змінною WORK_OS_BACKUP_PASSWORD (для автоматизації); інакше його питає openssl.
set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/work-os"
CONF_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/work-os/runner.env"
ITER=200000

say() { printf '%s\n' "$*"; }
die() { printf 'Помилка: %s\n' "$*" >&2; exit 1; }
rel() { local p="$1"; case "$p" in "$HOME"/*) printf '%s' "${p#"$HOME"/}";; *) die "шлях поза домашньою текою не переносимо: $p";; esac; }
# WORK_OS_BACKUP_NO_SUDO=1 — без sudo, WORK_OS_BACKUP_NO_STOP=1 — не зупиняти runner і Waydroid (обидва лише для перевірки на тестовій теці).
as_root() { if [ "$(id -u)" = 0 ] || [ "${WORK_OS_BACKUP_NO_SUDO:-}" = 1 ]; then "$@"; else command -v sudo >/dev/null 2>&1 || die "потрібен sudo (файли Waydroid мають uid Android)"; sudo "$@"; fi; }

# Профіль браузера, у якому залогінені WhatsApp/Telegram Web: заданий явно, з налаштувань runner, з .desktop із портом CDP або типовий.
detect_browser_profile() {
  if [ -n "${BROWSER_PROFILE:-}" ]; then printf '%s' "$BROWSER_PROFILE"; return; fi
  if [ -f "$CONF_FILE" ]; then
    local from_conf
    from_conf="$(. "$CONF_FILE" >/dev/null 2>&1; printf '%s' "${WORK_OS_BROWSER_PROFILE:-}")"
    if [ -n "$from_conf" ] && [ -d "$from_conf" ]; then printf '%s' "$from_conf"; return; fi
  fi
  local apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications" f dir
  for f in "$apps"/*.desktop; do
    [ -f "$f" ] || continue
    grep -qs -- '--remote-debugging-port=' "$f" || continue
    dir="$(grep -m1 -o -- '--user-data-dir=[^ ]*' "$f" | head -1 | cut -d= -f2- || true)"
    if [ -n "$dir" ] && [ -d "$dir" ]; then printf '%s' "$dir"; return; fi
    case "$(grep -m1 '^Exec=' "$f")" in
      *opera*) [ -d "$HOME/.config/opera" ] && { printf '%s' "$HOME/.config/opera"; return; } ;;
      *google-chrome*) [ -d "$HOME/.config/google-chrome" ] && { printf '%s' "$HOME/.config/google-chrome"; return; } ;;
      *chromium*) [ -d "$HOME/.config/chromium" ] && { printf '%s' "$HOME/.config/chromium"; return; } ;;
      *brave*) [ -d "$HOME/.config/BraveSoftware/Brave-Browser" ] && { printf '%s' "$HOME/.config/BraveSoftware/Brave-Browser"; return; } ;;
    esac
  done
  [ -d "$HOME/.local/share/work-os-runner-browser" ] && printf '%s' "$HOME/.local/share/work-os-runner-browser"
  return 0
}

stop_runner() {
  [ "${WORK_OS_BACKUP_NO_STOP:-}" = 1 ] && return 0
  # Узгоджена копія: runner і сесія Waydroid зупинені, браузер власник закриває сам (профіль заблоковано, поки він відкритий).
  systemctl --user stop work-os-runner-tray.service 2>/dev/null || true
  pkill -f 'scripts/chat-discovery-runner.mjs' 2>/dev/null || true
  command -v waydroid >/dev/null 2>&1 && waydroid session stop >/dev/null 2>&1 || true
}

cmd_backup() {
  local out="" ; BROWSER_PROFILE=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --browser-profile) BROWSER_PROFILE="${2:?потрібна тека профілю}"; shift 2;;
      *) out="$1"; shift;;
    esac
  done
  out="${out:-$HOME/work-os-runner-$(date +%Y%m%d-%H%M).wosrunner}"
  command -v openssl >/dev/null 2>&1 || die "потрібен openssl"
  local paths=() profile
  profile="$(detect_browser_profile)"
  if [ -n "$profile" ]; then paths+=("$(rel "$profile")"); say "Профіль браузера: $profile"; else say "Профіль браузера не знайдено: сесії месенджерів у архів не потраплять (вкажіть --browser-profile)."; fi
  [ -d "$HOME/.local/share/waydroid" ] && paths+=(".local/share/waydroid") && say "Дані Waydroid: ~/.local/share/waydroid ($(du -sh "$HOME/.local/share/waydroid" 2>/dev/null | cut -f1))"
  local f
  for f in .android/adbkey .android/adbkey.pub .config/work-os .local/state/work-os/telegram-scanned-groups.json .local/state/work-os/telegram-revisit-plan.json; do
    [ -e "$HOME/$f" ] && paths+=("$f")
  done
  [ "${#paths[@]}" -gt 0 ] || die "нічого переносити"
  say "Закрийте браузер runner, якщо він відкритий. Зупиняю runner і сесію Waydroid…"
  stop_runner
  local manifest; manifest="$(mktemp)"
  { echo "work-os runner backup"; echo "created=$(date -Is)"; echo "host=$(hostname)"; printf 'path=%s\n' "${paths[@]}"; } > "$manifest"
  # Манифест лежить у домашній теці під тимчасовою назвою, щоб потрапити в архів відносним шляхом.
  local mf_rel=".work-os-runner-manifest.txt"
  cp "$manifest" "$HOME/$mf_rel"; rm -f "$manifest"
  paths+=("$mf_rel")
  say "Пакую й шифрую (потрібен sudo для файлів Waydroid)…"
  local tmp="${out}.part"
  local pass_args=()
  [ -n "${WORK_OS_BACKUP_PASSWORD:-}" ] && pass_args=(-pass env:WORK_OS_BACKUP_PASSWORD)
  if as_root tar -C "$HOME" --numeric-owner -cf - "${paths[@]}" | openssl enc -aes-256-cbc -pbkdf2 -iter "$ITER" -salt "${pass_args[@]}" -out "$tmp"; then
    mv "$tmp" "$out"; chmod 600 "$out"
    rm -f "$HOME/$mf_rel"
    say "Готово: $out ($(du -h "$out" | cut -f1))"
    say "Архів містить входи в месенджери. Тримайте його й пароль у безпечному місці."
  else
    rm -f "$tmp" "$HOME/$mf_rel"; die "не вдалося створити архів"
  fi
}

cmd_restore() {
  local file="${1:?вкажіть файл архіву}"
  [ -f "$file" ] || die "файл не знайдено: $file"
  command -v openssl >/dev/null 2>&1 || die "потрібен openssl"
  local pass_args=()
  [ -n "${WORK_OS_BACKUP_PASSWORD:-}" ] && pass_args=(-pass env:WORK_OS_BACKUP_PASSWORD)
  say "Перевіряю пароль і вміст архіву…"
  local listing
  listing="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter "$ITER" "${pass_args[@]}" -in "$file" 2>/dev/null | tar -tf - 2>/dev/null | head -2000)" || true
  [ -n "$listing" ] || die "не вдалося розшифрувати архів (хибний пароль чи пошкоджений файл)"
  # Лише відносні шляхи без «..»: архів нічого не пише поза домашньою текою.
  if printf '%s\n' "$listing" | grep -qE '(^/|(^|/)\.\.(/|$))'; then die "в архіві є небезпечні шляхи, відновлення скасовано"; fi
  stop_runner
  # Наявне не затираємо: профіль браузера й дані Waydroid, що вже лежать на місці, відкладаються під іншою назвою.
  local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
  local dest
  while IFS= read -r dest; do
    [ -n "$dest" ] || continue
    if [ -e "$HOME/$dest" ] && [ -z "$(printf '%s' "$dest" | grep -E '^\.config/work-os$')" ]; then
      say "Відкладаю наявне: ~/$dest → ~/$dest.bak-$stamp"
      as_root mv "$HOME/$dest" "$HOME/$dest.bak-$stamp"
    fi
  done < <(printf '%s\n' "$listing" | grep -E '^(\.local/share/waydroid/?$|\.local/share/work-os-runner-browser/?$|\.config/(opera|google-chrome|chromium)/?$|\.config/BraveSoftware/Brave-Browser/?$)' | sed 's#/$##' | sort -u)
  say "Розгортаю (sudo потрібен, щоб зберегти uid Android)…"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter "$ITER" "${pass_args[@]}" -in "$file" | as_root tar -C "$HOME" --numeric-owner -xpf -
  # Файли користувача (не Android) мають належати користувачеві.
  local item
  for item in .android .config/work-os .local/state/work-os .local/share/work-os-runner-browser; do
    [ -e "$HOME/$item" ] && as_root chown -R "$(id -u):$(id -g)" "$HOME/$item" || true
  done
  rm -f "$HOME/.work-os-runner-manifest.txt"
  say "Відновлено. Запустіть scripts/install-runner.sh --check, щоб переконатись, що все готове."
}

case "${1:-}" in
  backup) shift; cmd_backup "$@";;
  restore) shift; cmd_restore "$@";;
  ""|-h|--help) sed -n 2,14p "$0";;
  *) die "невідома команда: $1 (backup | restore)";;
esac
