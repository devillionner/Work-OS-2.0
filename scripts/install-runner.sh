#!/usr/bin/env bash
# Встановлення runner Work OS на сучасний Linux однією командою: scripts/install-runner.sh
# Підтримано: Arch/CachyOS/Manjaro/EndeavourOS (pacman), Fedora (dnf), Ubuntu/Debian/Mint (apt). Архітектура x86_64.
# Кожен крок ідемпотентний: повторний запуск нічого не ламає й нічого не перевстановлює. root потрібен лише для пакетів, Waydroid і
# фаєрвола: sudo питається один раз, перед кожною групою команд пояснюється навіщо.
#
# Параметри:
#   --check                      лише перевірка готовності (нічого не змінює)
#   --dry-run                    показати, що було б зроблено
#   --yes                        без питань (типові відповіді)
#   --site АДРЕСА                адреса сайту Work OS (звідси ж береться пакет runner і архів входів)
#   --code КОД                   одноразовий код із «Налаштування → Сервіс → Runner на цьому ПК» (прив'язка без входу вручну)
#   --restore                    запропонувати відновити входи з архіву в хмарі (з --code пропонується саме)
#   --remove                     прибрати runner, сервіс і обробники посилань (входи й Waydroid-дані лишаються)
#   --purge                      з --remove: прибрати ще профіль браузера runner, налаштування й стан (Waydroid-дані лишаються)
#   --browser opera|chrome|chromium|brave|install   який браузер використати (install — поставити Chromium/Chrome)
#   --arm auto|houdini|ndk|skip  перекладач ARM для Waydroid (auto: Intel — houdini, AMD — ndk)
#   --android-windows auto|hide|off|keep   що робити з вікнами Android (auto: Hyprland і KDE — ховати правилом, решта — вимкнути multi_windows)
#   --skip-waydroid              не чіпати Waydroid і Viber (лише WhatsApp і Telegram)
#   --url АДРЕСА                 те саме, що --site
# Змінні для перевірок: OS_RELEASE_FILE (інший файл замість /etc/os-release), ADBKEYBOARD_SHA256 (інша контрольна сума APK).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/work-os"
CONF_FILE="$CONF_DIR/runner.env"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/work-os"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/work-os"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=13
CDP_PORT=9222
WAYDROID_SCRIPT_URL="https://github.com/casualsnek/waydroid_script"
WAYDROID_SCRIPT_COMMIT="48dbfaf34a6ddbe78688c530f9ba1c26522aafb2"
ADBKEYBOARD_URL="https://github.com/senzhk/ADBKeyBoard/raw/master/ADBKeyboard.apk"
ADBKEYBOARD_SHA256="${ADBKEYBOARD_SHA256:-e698adea5633135a067b038f9a0cf41baa4de09888713a81593fb2b9682cdc59}"
ADBKEYBOARD_PACKAGE="com.android.adbkeyboard"

MODE=install DRY=0 YES=0 RESTORE=0 CODE="" PURGE=0 RUNNER_TOKEN="" BROWSER_CHOICE="" ARM=auto ANDROID_WINDOWS=auto SKIP_WAYDROID=0
WORK_OS_URL="${WORK_OS_URL:-https://work-os-2-staging.devillionner.workers.dev}"
FAMILY="" SUDO_READY=0 PROBLEMS=0

if [ -t 1 ]; then G=$'\033[32m' R=$'\033[31m' Y=$'\033[33m' B=$'\033[1m' N=$'\033[0m'; else G="" R="" Y="" B="" N=""; fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
bad()  { printf '  %s✘%s %s\n' "$R" "$N" "$*"; PROBLEMS=$((PROBLEMS + 1)); }
die()  { printf '%sПомилка:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() { sed -n 2,24p "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check;;
    --dry-run) DRY=1;;
    --yes|-y) YES=1;;
    --restore) RESTORE=1;;
    --code) CODE="${2:?потрібен код}"; shift;;
    --remove) MODE=remove;;
    --purge) PURGE=1;;
    --site) WORK_OS_URL="${2:?}"; shift;;
    --browser) BROWSER_CHOICE="${2:?}"; shift;;
    --arm) ARM="${2:?}"; shift;;
    --android-windows) ANDROID_WINDOWS="${2:?}"; shift;;
    --skip-waydroid) SKIP_WAYDROID=1;;
    --url) WORK_OS_URL="${2:?}"; shift;;
    -h|--help) usage; exit 0;;
    *) die "невідомий параметр: $1 (див. --help)";;
  esac
  shift
done

run() { if [ "$DRY" = 1 ]; then printf '    [dry-run] %s\n' "$*"; else "$@"; fi; }

ask() { # ask "питання" типова_відповідь → друкує відповідь
  local answer
  if [ "$YES" = 1 ]; then printf '%s' "$2"; return; fi
  # Інсталятор запускають як `curl … | bash`: stdin зайнятий скриптом, тож питання йдуть із термінала.
  if [ -t 0 ]; then read -r -p "  $1 [$2] " answer || answer=""
  elif { : </dev/tty; } 2>/dev/null; then printf '  %s [%s] ' "$1" "$2" >/dev/tty; read -r answer </dev/tty || answer=""
  else printf '%s' "$2"; return; fi
  printf '%s' "${answer:-$2}"
}

why_root() { say "  Потрібен root: $*"; }
ensure_sudo() {
  [ "$(id -u)" = 0 ] && return 0
  [ "$SUDO_READY" = 1 ] && return 0
  have sudo || die "потрібен sudo (або запустіть від root)"
  [ "$DRY" = 1 ] || sudo -v
  SUDO_READY=1
}
as_root() { ensure_sudo; if [ "$(id -u)" = 0 ]; then run "$@"; else run sudo "$@"; fi; }

# --- Дистрибутив -----------------------------------------------------------------------------------------------------------
detect_distro() {
  local file="${OS_RELEASE_FILE:-/etc/os-release}" ids id variant name
  [ -r "$file" ] || die "не знайдено $file: не можу визначити дистрибутив. Підтримано: Arch-, Fedora- та Debian/Ubuntu-подібні. Нічого не встановлено."
  # shellcheck disable=SC1090
  ids="$(. "$file"; printf '%s %s' "${ID:-}" "${ID_LIKE:-}")"
  id="$(. "$file"; printf '%s' "${ID:-}")"; variant="$(. "$file"; printf '%s' "${VARIANT_ID:-}")"; name="$(. "$file"; printf '%s' "${PRETTY_NAME:-${NAME:-$id}}")"
  unsupported() { printf '%sНе підтримується:%s %s\n  %s\nПідтримано: Arch/CachyOS/Manjaro/EndeavourOS, Fedora (звичайна), Ubuntu/Debian/Mint, архітектура x86_64. Нічого не встановлено.\n' "$R" "$N" "$name" "$*" >&2; exit 1; }
  # Незмінні системи: корінь лише для читання, пакети й модулі ядра не поставити так, як це робить інсталятор.
  if [ -e "${OSTREE_BOOTED_FILE:-/run/ostree-booted}" ] || printf ' %s ' "$variant" | grep -qiE ' (silverblue|kinoite|sericea|onyx|iot|coreos|cosmic-atomic|bazzite|bluefin|aurora) ' || printf ' %s ' "$id" | grep -qiE ' (bazzite|bluefin|aurora|steamos|vanilla) '; then
    unsupported "незмінна система (rpm-ostree/atomic): пакети й Waydroid ставляться інакше, інсталятор їх не чіпає."
  fi
  case " $ids " in *" nixos "*) unsupported "NixOS: пакети описуються конфігурацією системи, імперативне встановлення не підходить.";; esac
  case " $ids " in *" opensuse "*|*" opensuse-leap "*|*" opensuse-tumbleweed "*|*" suse "*|*" sles "*|*" sled "*) unsupported "openSUSE/SUSE: пакетного кроку для zypper немає.";; esac
  case " $ids " in
    *" arch "*|*" cachyos "*|*" manjaro "*|*" endeavouros "*|*" garuda "*) FAMILY=arch;;
    *" fedora "*|*" nobara "*|*" rhel "*) FAMILY=fedora;;
    *" ubuntu "*|*" debian "*|*" linuxmint "*|*" pop "*) FAMILY=debian;;
    *) unsupported "невідомий дистрибутив ($ids).";;
  esac
  ok "Дистрибутив: сімейство ${FAMILY} (${ids})"
}

pkg_present() {
  case "$FAMILY" in
    arch) pacman -Q "$1" >/dev/null 2>&1;;
    fedora) rpm -q "$1" >/dev/null 2>&1;;
    debian) dpkg -s "$1" >/dev/null 2>&1;;
  esac
}
pkg_install() { # лише відсутні пакети
  local missing=() p
  for p in "$@"; do pkg_present "$p" || missing+=("$p"); done
  [ "${#missing[@]}" -eq 0 ] && return 0
  say "  Ставлю пакети: ${missing[*]}"
  case "$FAMILY" in
    arch) as_root pacman -S --needed --noconfirm "${missing[@]}";;
    fedora) as_root dnf install -y "${missing[@]}";;
    debian) as_root apt-get update -qq; as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}";;
  esac
}

pkgs_base()  { case "$FAMILY" in arch|fedora) echo "curl xdg-utils util-linux tar";; debian) echo "curl xdg-utils util-linux tar ca-certificates";; esac; }
pkgs_tray()  { case "$FAMILY" in arch) echo "python-gobject gtk3 libayatana-appindicator";; fedora) echo "python3-gobject gtk3 libayatana-appindicator-gtk3";; debian) echo "python3-gi gir1.2-gtk-3.0 gir1.2-ayatanaappindicator3-0.1";; esac; }
pkgs_python() { case "$FAMILY" in arch) echo "python python-pip";; fedora) echo "python3 python3-pip";; debian) echo "python3 python3-venv python3-pip";; esac; }
pkgs_waydroid() { case "$FAMILY" in arch|fedora) echo "waydroid android-tools";; debian) echo "waydroid adb";; esac; }

# --- Node ------------------------------------------------------------------------------------------------------------------
node_ok() {
  have node || return 1
  local v major minor
  v="$(node --version 2>/dev/null | sed 's/^v//')"; major="${v%%.*}"; minor="$(printf '%s' "$v" | cut -d. -f2)"
  [ "${major:-0}" -gt "$NODE_MIN_MAJOR" ] || { [ "${major:-0}" -eq "$NODE_MIN_MAJOR" ] && [ "${minor:-0}" -ge "$NODE_MIN_MINOR" ]; }
}
install_node_tarball() { # офіційний tarball nodejs.org із перевіркою SHA-256 із SHASUMS256.txt того ж каталогу
  local base="https://nodejs.org/dist/latest-v${NODE_MIN_MAJOR}.x" tmp name sum
  [ "$(uname -m)" = x86_64 ] || die "автоматичне встановлення Node підтримує лише x86_64: поставте Node ≥ ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} вручну"
  tmp="$(mktemp -d)"
  run curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  [ "$DRY" = 1 ] && { say "    [dry-run] завантажити node-v${NODE_MIN_MAJOR}.x linux-x64, перевірити SHA-256, розпакувати в $DATA_DIR/node"; rm -rf "$tmp"; return; }
  name="$(grep -o "node-v[0-9.]*-linux-x64.tar.xz" "$tmp/SHASUMS256.txt" | head -1)"
  [ -n "$name" ] || die "не знайшов tarball Node у $base"
  sum="$(grep " $name\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
  curl -fsSL "$base/$name" -o "$tmp/$name"
  [ "$(sha256sum "$tmp/$name" | cut -d' ' -f1)" = "$sum" ] || die "контрольна сума $name не збігається"
  mkdir -p "$DATA_DIR" "$HOME/.local/bin"
  rm -rf "$DATA_DIR/node"; mkdir -p "$DATA_DIR/node"
  tar -xJf "$tmp/$name" -C "$DATA_DIR/node" --strip-components=1
  for bin in node npm npx; do ln -sf "$DATA_DIR/node/bin/$bin" "$HOME/.local/bin/$bin"; done
  rm -rf "$tmp"
  export PATH="$HOME/.local/bin:$PATH"
}

# --- Кроки -----------------------------------------------------------------------------------------------------------------
step_base() {
  step "1. Node.js і системні пакети"
  why_root "системні пакети (curl, трей-залежності)"
  # shellcheck disable=SC2046
  pkg_install $(pkgs_base) $(pkgs_tray) $(pkgs_python)
  if node_ok; then ok "Node $(node --version)"; else say "  Node ≥ ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} не знайдено: ставлю офіційний пакет без root"; install_node_tarball; [ "$DRY" = 1 ] || node_ok || die "Node не встановився"; ok "Node встановлено"; fi
  [ -f "$ROOT/RUNNER-PACKAGE.json" ] && ok "пакет runner $(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$ROOT/RUNNER-PACKAGE.json','utf8')).version)" 2>/dev/null || echo '?') у $ROOT (залежностей npm runner не має)"
}

# Рядок KEY=значення в runner.env: оновлює наявний і не чіпає решту (токен, браузер, адреса живуть разом).
conf_set() {
  [ "$DRY" = 1 ] && return 0
  mkdir -p "$CONF_DIR"; touch "$CONF_FILE"; chmod 600 "$CONF_FILE"
  local tmp; tmp="$(mktemp)"
  grep -v "^$1=" "$CONF_FILE" > "$tmp" || true
  printf '%s=%q\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$CONF_FILE"; rm -f "$tmp"
}

desktop_with_cdp() { # існуючий .desktop користувача, який уже відкриває браузер із портом CDP
  local f
  for f in "$APPS"/*.desktop; do
    [ -f "$f" ] || continue
    case "$f" in */work-os-runner-browser.desktop) continue;; esac
    grep -qs -- "--remote-debugging-port=${CDP_PORT}" "$f" && { printf '%s' "$f"; return 0; }
  done
  return 1
}

browser_binary() {
  case "$1" in
    opera) for c in opera; do have $c && { echo $c; return; }; done;;
    chrome) for c in google-chrome-stable google-chrome; do have $c && { echo $c; return; }; done;;
    chromium) for c in chromium chromium-browser; do have $c && { echo $c; return; }; done;;
    brave) for c in brave-browser brave; do have $c && { echo $c; return; }; done;;
  esac
  return 1
}

install_browser() {
  case "$FAMILY" in
    arch|fedora) why_root "встановити Chromium"; pkg_install chromium;;
    debian)
      why_root "встановити Google Chrome (пакет .deb; apt додасть репозиторій Google для оновлень). Snap-Chromium не підходить: він ізольований від теки профілю runner"
      local deb; deb="$(mktemp --suffix=.deb)"
      run curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o "$deb"
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$deb"; rm -f "$deb";;
  esac
}

step_browser() {
  step "2. Браузер для WhatsApp Web і Telegram Web"
  local existing; existing="$(desktop_with_cdp || true)"
  if [ -n "$existing" ] && [ -z "$BROWSER_CHOICE" ]; then
    ok "Ваш браузер уже відкривається з портом ${CDP_PORT} (${existing##*/}); runner використає його, окремий профіль не створюю"
    return
  fi
  local choice="$BROWSER_CHOICE" found="" b
  if [ -z "$choice" ]; then
    for b in opera chrome chromium brave; do browser_binary "$b" >/dev/null 2>&1 && found="$found $b"; done
    if [ -n "$found" ]; then choice="$(ask "Який браузер використати для runner (знайдено:${found})?" "${found# }" | awk '{print $1}')"; else choice=install; fi
  fi
  if [ "$choice" = install ] || ! browser_binary "$choice" >/dev/null 2>&1; then
    [ "$choice" = install ] || warn "браузер ${choice} не знайдено, ставлю типовий"
    install_browser
    choice="$(case "$FAMILY" in debian) echo chrome;; *) echo chromium;; esac)"
  fi
  local bin; bin="$(browser_binary "$choice" || true)"
  [ -n "$bin" ] || { [ "$DRY" = 1 ] && bin="$choice" || die "браузер ${choice} не знайдено після встановлення"; }
  case "$(readlink -f "$(command -v "$bin" 2>/dev/null || echo /)" 2>/dev/null)" in /snap/*|*/snap/*) warn "$bin — snap-пакет: профіль поза ~/snap може не відкритись. Краще Chrome .deb або Chromium з пакетного менеджера.";; esac
  local profile="$HOME/.local/share/work-os-runner-browser"
  run mkdir -p "$CONF_DIR" "$APPS" "$profile"
  if [ "$DRY" != 1 ]; then
    conf_set WORK_OS_BROWSER "$bin"; conf_set WORK_OS_BROWSER_PROFILE "$profile"
    cat > "$APPS/work-os-runner-browser.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Work OS: браузер runner
Comment=Окремий профіль для автопосту WhatsApp і Telegram
Exec=$bin --remote-debugging-address=127.0.0.1 --remote-debugging-port=${CDP_PORT} --user-data-dir=$profile --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --no-first-run --no-default-browser-check %U
Terminal=false
Categories=Network;WebBrowser;
DESK
  fi
  ok "Браузер: $bin, окремий профіль $profile (налаштування: $CONF_FILE)"
}

# --- Waydroid --------------------------------------------------------------------------------------------------------------
waydroid_running() { have waydroid && waydroid status 2>/dev/null | grep -qi 'Session:.*RUNNING'; }
wait_session() { local i; for i in $(seq 1 90); do waydroid_running && return 0; sleep 1; done; return 1; }
start_session() {
  waydroid_running && return 0
  [ "$DRY" = 1 ] && { say "    [dry-run] waydroid session start"; return 0; }
  (nohup waydroid session start >/dev/null 2>&1 &)
  wait_session || { bad "сесія Waydroid не запустилась за 90 с (потрібен графічний вхід у систему: Wayland або X11)"; return 1; }
}

detect_android_policy() {
  [ "$ANDROID_WINDOWS" != auto ] && { echo "$ANDROID_WINDOWS"; return; }
  local desk="${XDG_CURRENT_DESKTOP:-}${DESKTOP_SESSION:-}"
  if [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] || printf '%s' "$desk" | grep -qi hyprland; then echo hide-hyprland
  elif printf '%s' "$desk" | grep -qi 'kde\|plasma'; then echo hide-kde
  else echo off; fi
}

install_kwin_rule() {
  local kw kr
  kw="$(command -v kwriteconfig6 || command -v kwriteconfig5 || true)"; kr="$(command -v kreadconfig6 || command -v kreadconfig5 || true)"
  [ -n "$kw" ] || { warn "kwriteconfig не знайдено: правило KWin не створено, вимикаю multi_windows"; return 1; }
  if grep -qs 'Work OS: вікна Android' "${XDG_CONFIG_HOME:-$HOME/.config}/kwinrulesrc"; then ok "правило KWin для вікон Android уже є"; return 0; fi
  [ "$DRY" = 1 ] && { say "    [dry-run] додати правило KWin: вікна waydroid.* без фокусу, не в панелі завдань"; return 0; }
  local count rules id=work-os-android
  count="$("$kr" --file kwinrulesrc --group General --key count 2>/dev/null || echo 0)"; count="${count:-0}"
  rules="$("$kr" --file kwinrulesrc --group General --key rules 2>/dev/null || true)"
  "$kw" --file kwinrulesrc --group General --key count "$((count + 1))"
  "$kw" --file kwinrulesrc --group General --key rules "${rules:+$rules,}$id"
  local kv
  for kv in "Description=Work OS: вікна Android" "wmclass=^waydroid\\..*" "wmclasscomplete=false" "wmclassmatch=3" \
            "skiptaskbar=true" "skiptaskbarrule=2" "skippager=true" "skippagerrule=2" "skipswitcher=true" "skipswitcherrule=2" \
            "acceptfocus=false" "acceptfocusrule=2" "minimize=true" "minimizerule=2"; do
    "$kw" --file kwinrulesrc --group "$id" --key "${kv%%=*}" "${kv#*=}"
  done
  (have qdbus6 && qdbus6 org.kde.KWin /KWin reconfigure || have qdbus && qdbus org.kde.KWin /KWin reconfigure) >/dev/null 2>&1 || warn "перезапустіть KWin (kwin --replace) або вийдіть і увійдіть, щоб правило почало діяти"
  ok "правило KWin додано (вікна Android не беруть фокус і не потрапляють у панель завдань)"
}

firewall_rules() {
  if have ufw && systemctl is-active --quiet ufw 2>/dev/null; then
    why_root "дозволити мережу Android (інтерфейс waydroid0) у ufw: без цього Viber не має інтернету"
    as_root ufw allow in on waydroid0; as_root ufw route allow in on waydroid0; as_root ufw route allow out on waydroid0
    ok "ufw: waydroid0 дозволено"
  elif have firewall-cmd && systemctl is-active --quiet firewalld 2>/dev/null; then
    why_root "додати waydroid0 до довіреної зони firewalld"
    as_root firewall-cmd --permanent --zone=trusted --add-interface=waydroid0; as_root firewall-cmd --reload
    ok "firewalld: waydroid0 у довіреній зоні"
  else ok "фаєрвол не активний: окремих правил не потрібно"; fi
}

# adb до Android у Waydroid: адреса береться зі стану сесії, ключ хоста дописується в adb_keys без root (тека належить користувачеві).
android_adb() {
  local ip serial
  ip="$(waydroid status 2>/dev/null | awk '/IP address/{print $NF}' | head -1)"
  [ -n "$ip" ] || return 1
  serial="$ip:5555"
  local keys="$HOME/.local/share/waydroid/data/misc/adb/adb_keys"
  if [ -f "$HOME/.android/adbkey.pub" ] && [ -d "$(dirname "$keys")" ] && ! grep -qF "$(cut -d' ' -f1 "$HOME/.android/adbkey.pub")" "$keys" 2>/dev/null; then cat "$HOME/.android/adbkey.pub" >> "$keys"; fi
  adb connect "$serial" >/dev/null 2>&1 || true
  adb -s "$serial" "$@"
}

install_adbkeyboard() {
  android_adb shell pm list packages 2>/dev/null | grep -q "package:${ADBKEYBOARD_PACKAGE}" && { ok "ADBKeyBoard уже встановлено"; return 0; }
  local tmp apk; tmp="$(mktemp -d)"; apk="$tmp/ADBKeyboard.apk"
  [ "$DRY" = 1 ] && { say "    [dry-run] завантажити ADBKeyboard.apk, перевірити SHA-256 ${ADBKEYBOARD_SHA256:0:12}…, waydroid app install"; rm -rf "$tmp"; return 0; }
  curl -fsSL "$ADBKEYBOARD_URL" -o "$apk" || { bad "не вдалося завантажити ADBKeyBoard з $ADBKEYBOARD_URL"; rm -rf "$tmp"; return 1; }
  local actual; actual="$(sha256sum "$apk" | cut -d' ' -f1)"
  if [ "$actual" != "$ADBKEYBOARD_SHA256" ]; then
    bad "контрольна сума ADBKeyboard.apk не збігається (очікувалась ${ADBKEYBOARD_SHA256:0:16}…, отримано ${actual:0:16}…). Не встановлюю. Якщо ви перевірили файл вручну: ADBKEYBOARD_SHA256=$actual $0"
    rm -rf "$tmp"; return 1
  fi
  android_adb install -r "$apk" >/dev/null 2>&1 && ok "ADBKeyBoard встановлено (контрольну суму перевірено)" || bad "не вдалося встановити ADBKeyBoard через adb (перевірте, що Android запущено й adb авторизований)"
  rm -rf "$tmp"
}

step_waydroid() {
  step "3. Waydroid (Android для Viber)"
  if [ "$SKIP_WAYDROID" = 1 ]; then warn "пропущено (--skip-waydroid): Viber працювати не буде"; do_restore; return; fi
  [ "$(uname -m)" = x86_64 ] || { warn "Waydroid автоматично налаштовується лише на x86_64"; do_restore; return; }
  if ! grep -qw binder /proc/filesystems 2>/dev/null && [ ! -e /dev/binderfs ] && ! lsmod 2>/dev/null | grep -q binder; then
    warn "у ядрі не видно binder: Waydroid його потребує."
    case "$FAMILY" in
      debian) say "    Спробую: sudo apt install linux-modules-extra-$(uname -r)"; why_root "модуль binder для ядра"; as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "linux-modules-extra-$(uname -r)" || true;;
      arch) say "    Arch: використайте ядро з binder (linux-zen, linux-cachyos) або пакет binder_linux-dkms.";;
      fedora) say "    Fedora: потрібне ядро з CONFIG_ANDROID_BINDERFS (стандартне має); перезавантажте систему після встановлення Waydroid.";;
    esac
  fi
  if [ "$FAMILY" = debian ] && ! pkg_present waydroid; then
    why_root "підключити офіційний репозиторій Waydroid (repo.waydro.id), у стандартних репозиторіях Ubuntu/Debian його немає"
    ensure_sudo; [ "$DRY" = 1 ] && say "    [dry-run] curl -s https://repo.waydro.id | sudo bash" || curl -fsSL https://repo.waydro.id | sudo bash
  fi
  why_root "встановити Waydroid і adb"
  # shellcheck disable=SC2046
  pkg_install $(pkgs_waydroid)
  if [ -f /var/lib/waydroid/waydroid.cfg ]; then ok "образ Waydroid уже ініціалізовано"; else
    why_root "завантажити й розгорнути образ Android (GAPPS: з Google Play, звідти ставиться Viber), кілька гігабайт"
    as_root waydroid init -s GAPPS -f
  fi
  why_root "запустити службу контейнера Waydroid"
  as_root systemctl enable --now waydroid-container.service
  firewall_rules

  do_restore

  local arm="$ARM"
  if [ "$arm" = auto ]; then
    case "$(grep -m1 'vendor_id' /proc/cpuinfo 2>/dev/null)" in *AuthenticAMD*) arm=ndk;; *) arm=houdini;; esac
  fi
  if [ "$arm" != skip ]; then
    local overlay=/var/lib/waydroid/overlay/system/lib64
    if ls "$overlay"/libhoudini.so "$overlay"/libndk_translation.so >/dev/null 2>&1; then ok "перекладач ARM уже встановлено"; else
      say "  Перекладач ARM ($arm) потрібен, бо Viber — ARM-застосунок. Використовую waydroid_script (комміт ${WAYDROID_SCRIPT_COMMIT:0:8})."
      why_root "встановити перекладач ARM у образ Android"
      local ws="$DATA_DIR/waydroid_script"
      if [ ! -f "$ws/main.py" ]; then
        # Без git: архів саме цього комміту (він і задає вміст; адреса з хешем не міняється).
        run mkdir -p "$ws"
        if [ "$DRY" = 1 ]; then say "    [dry-run] завантажити waydroid_script@${WAYDROID_SCRIPT_COMMIT:0:8} і розпакувати в $ws"; else
          curl -fsSL "$WAYDROID_SCRIPT_URL/archive/$WAYDROID_SCRIPT_COMMIT.tar.gz" | tar -xz -C "$ws" --strip-components=1 || die "не вдалося завантажити waydroid_script"
        fi
      fi
      [ -d "$ws/venv" ] || run python3 -m venv "$ws/venv"
      run "$ws/venv/bin/pip" install --quiet -r "$ws/requirements.txt"
      as_root "$ws/venv/bin/python" "$ws/main.py" install "$([ "$arm" = ndk ] && echo libndk || echo libhoudini)"
    fi
  fi

  [ -f "$HOME/.android/adbkey" ] || { run mkdir -p "$HOME/.android"; run adb keygen "$HOME/.android/adbkey"; }
  start_session || return 0
  if [ "$DRY" != 1 ]; then
    waydroid prop set persist.waydroid.suspend false >/dev/null 2>&1 && ok "persist.waydroid.suspend = false"
    local policy; policy="$(detect_android_policy)"
    case "$policy" in
      hide-hyprland) ok "Hyprland: runner сам ховає вікна Android (правило ставиться під час роботи адаптера)";;
      hide-kde) install_kwin_rule || { waydroid prop set persist.waydroid.multi_windows false >/dev/null 2>&1; warn "multi_windows вимкнено"; };;
      off) waydroid prop set persist.waydroid.multi_windows false >/dev/null 2>&1 && warn "multi_windows вимкнено: Android працює одним вікном, яке не з'являється саме. Розмір вікна інший, ніж у режимі за замовчуванням: перевірте автопост Viber на 2–3 чатах";;
      keep) warn "вікна Android лишено як є: під час автопосту вони можуть з'являтись на робочому столі";;
    esac
    install_adbkeyboard || true
    if waydroid app list 2>/dev/null | grep -q 'com.viber.voip'; then ok "Viber встановлено"; else
      warn "Viber ще не встановлено."
      say "    1) відкрийте вікно Android: waydroid show-full-ui"
      say "    2) у Google Play (увійдіть в обліковий запис Google) встановіть Viber"
      say "    3) активуйте Viber як додатковий пристрій: у Viber на телефоні «Налаштування → Додати пристрій» і відскануйте QR зі вікна Android"
      say "    Після цього повторіть: $0 --check"
    fi
  fi
}

# --- Трей, сервіс, обробники, прив'язка ---------------------------------------------------------------------------------------
step_service() {
  step "4. Трей, автозапуск і обробники посилань"
  run "$ROOT/scripts/install-whatsapp-runner-autostart.sh"
  ok "сервіс work-os-runner-tray.service і обробники workos-runner:// та workos-waydroid:// встановлено"
  if [ "${XDG_CURRENT_DESKTOP:-}" != "${XDG_CURRENT_DESKTOP/GNOME/}" ]; then
    warn "GNOME: іконка трея потребує розширення AppIndicator (gnome-shell-extension-appindicator); без нього runner працює, але іконки не видно"
  fi
  if [ "$MODE" = install ] && [ "$DRY" != 1 ]; then
    systemctl --user start work-os-runner-tray.service 2>/dev/null && ok "трей запущено: він сам відкриє браузер і runner" || warn "запустіть вручну: systemctl --user start work-os-runner-tray.service"
  fi
}

step_bind() {
  step "5. Прив'язка до Work OS"
  if [ -n "$RUNNER_TOKEN" ] || grep -qs '^WORK_OS_EXECUTOR_TOKEN=' "$CONF_FILE" 2>/dev/null; then
    say "  Runner прив'язано кодом: входити в Work OS у браузері runner не треба."
  else
    say "  1) У вікні браузера runner (відкриється саме) увійдіть у Work OS: $WORK_OS_URL"
    say "  2) Токен runner підхопиться сам зі сторінки Work OS; якщо ні: «Налаштування → Сервіс → Executor пошуку чатів»"
  fi
  say "  WhatsApp Web (QR) і Telegram Web (web.telegram.org): увійдіть у вікні браузера runner, якщо входів не відновлено з архіву."
}

# --- Код встановлення, токен, архів входів -----------------------------------------------------------------------------------------
json_get() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=JSON.parse(d)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }

step_enroll() {
  [ -n "$CODE" ] || return 0
  step "Прив'язка за одноразовим кодом"
  if [ "$DRY" = 1 ]; then say "    [dry-run] обміняти код на токен runner (POST $WORK_OS_URL/api/runner/enroll)"; return 0; fi
  local body response
  body="$(printf '{"action":"redeem","code":"%s","host":"%s"}' "$CODE" "$(hostname | tr -cd 'A-Za-z0-9._ -')")"
  response="$(curl -sS --max-time 30 -X POST -H 'Content-Type: application/json' -d "$body" "$WORK_OS_URL/api/runner/enroll" 2>&1)" || die "не вдалося зв'язатися з Work OS: $response"
  RUNNER_TOKEN="$(printf '%s' "$response" | json_get token)"
  if [ -z "$RUNNER_TOKEN" ]; then die "код не прийнято: $(printf '%s' "$response" | json_get error)"; fi
  conf_set WORK_OS_EXECUTOR_TOKEN "$RUNNER_TOKEN"; conf_set WORK_OS_URL "$WORK_OS_URL"
  ok "Runner прив'язано до Work OS: токен збережено в $CONF_FILE (доступ лише для вас). Код більше не діє."
}

# Відновлення входів: архів лежить у хмарі Work OS, розшифровується паролем локально; наявне не затирається, а переїжджає в *.bak-ДАТА.
do_restore() {
  [ "$RESTORE" = 1 ] || [ -n "$CODE" ] || return 0
  step "Відновлення входів з архіву"
  if [ "$DRY" = 1 ]; then say "    [dry-run] перевірити архів у хмарі й, якщо він є, відновити (профіль браузера, дані Android)"; return 0; fi
  local token="${RUNNER_TOKEN:-}"
  if [ -z "$token" ] && [ -f "$CONF_FILE" ]; then token="$(grep '^WORK_OS_EXECUTOR_TOKEN=' "$CONF_FILE" | head -1 | cut -d= -f2- | tr -d "'\"")"; fi
  [ -n "$token" ] || { warn "немає токена runner: відновлення пропущено (запустіть із --code)"; return 0; }
  local yes_flag=(); [ "$YES" = 1 ] && yes_flag=(--yes)
  set +e
  node "$ROOT/scripts/runner-transfer.mjs" restore --site "$WORK_OS_URL" --token "$token" ${yes_flag[@]+"${yes_flag[@]}"} </dev/tty
  local code=$?
  set -e
  case "$code" in
    0) ok "входи відновлено: WhatsApp, Telegram і Viber без QR";;
    3) say "  Архіву в хмарі немає (це перший ПК). Після встановлення увійдіть у WhatsApp Web (QR) і Telegram Web у вікні браузера runner; Viber активується з телефона.";;
    4) warn "відновлення пропущено за вашим вибором";;
    *) warn "відновлення не завершилось (код $code): runner працюватиме, але входи доведеться зробити вручну; повторити: $0 --restore";;
  esac
}

do_remove() {
  step "Видалення runner"
  if [ "$DRY" = 1 ]; then say "    [dry-run] зупинити сервіс, прибрати обробники й $ROOT$([ "$PURGE" = 1 ] && echo ', налаштування, стан і профіль браузера runner')"; return 0; fi
  "$ROOT/scripts/install-whatsapp-runner-autostart.sh" --remove || true
  pkill -f 'scripts/chat-discovery-runner.mjs' 2>/dev/null || true
  rm -f "$APPS/work-os-runner-browser.desktop"
  if [ "$PURGE" = 1 ]; then
    rm -rf "$CONF_DIR" "$STATE_DIR" "$HOME/.local/share/work-os-runner-browser"
    ok "налаштування, стан і профіль браузера runner прибрано"
  else
    say "  Входи (профіль браузера runner), налаштування й дані Waydroid лишено. Прибрати ще й їх: --remove --purge (Waydroid-дані вручну: ~/.local/share/waydroid)."
  fi
  case "$ROOT" in "$DATA_DIR"/*) rm -rf "$ROOT"; ok "runner видалено: $ROOT";; *) say "  Теку $ROOT не видаляю (це не встановлення з сайту): видаліть її самі, якщо вона не потрібна.";; esac
}

# --- Перевірка -------------------------------------------------------------------------------------------------------------
check_all() {
  step "Перевірка готовності runner"
  PROBLEMS=0
  if node_ok; then ok "Node $(node --version)"; else bad "Node ≥ ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} не знайдено → scripts/install-runner.sh"; fi
  [ -f "$ROOT/scripts/chat-discovery-runner.mjs" ] && ok "runner: $ROOT" || bad "немає файлів runner у $ROOT → встановіть заново"
  python3 - <<'PY' >/dev/null 2>&1 && ok "трей: Python GTK і AppIndicator доступні" || bad "трей: бракує python-gobject/AppIndicator → scripts/install-runner.sh"
import gi
gi.require_version('Gtk', '3.0')
try:
    gi.require_version('AyatanaAppIndicator3', '0.1')
except (ValueError, ImportError):
    gi.require_version('AppIndicator3', '0.1')
PY
  if systemctl --user is-active --quiet work-os-runner-tray.service 2>/dev/null; then ok "сервіс трея працює"; else bad "сервіс трея не запущено → systemctl --user start work-os-runner-tray.service"; fi
  [ "$(xdg-mime query default x-scheme-handler/workos-runner 2>/dev/null)" = work-os-runner.desktop ] && ok "обробник workos-runner:// встановлено" || bad "обробник workos-runner:// не встановлено → scripts/install-whatsapp-runner-autostart.sh"
  if curl -fsS --max-time 3 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then ok "браузер з портом ${CDP_PORT} відповідає"; else bad "браузер з портом ${CDP_PORT} не відповідає → відкрийте браузер runner (меню «Work OS: браузер runner») або ваш браузер із цим портом"; fi
  local status_file="$STATE_DIR/runner-status.json" state=""
  [ -f "$status_file" ] && state="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('state',''))" "$status_file" 2>/dev/null || true)"
  case "$state" in ready|working) ok "runner підключений до Work OS (стан: $state)";; "") bad "runner не запущено (немає $status_file) → systemctl --user start work-os-runner-tray.service";; *) bad "runner: стан «$state» (див. $STATE_DIR/whatsapp-runner.log; без токена — увійдіть у Work OS у браузері runner)";; esac
  if [ "$SKIP_WAYDROID" = 1 ]; then warn "Waydroid пропущено"; elif ! have waydroid; then bad "Waydroid не встановлено → scripts/install-runner.sh"; else
    local out
    out="$(cd "$ROOT" && node scripts/runner-doctor.mjs 2>/dev/null | tail -1 || true)"
    if printf '%s' "$out" | grep -q '"status":"ready"'; then ok "Android, Viber і клавіатура готові (та сама перевірка, що в картці автопосту)"
    elif printf '%s' "$out" | grep -Eq '"reason":"(waydroid_not_running|waydroid_frozen|android_unreachable)"'; then warn "Android у Waydroid зараз не запущено: адаптер Viber сам запустить його перед партією (або: waydroid session start)"
    else bad "Viber: $(printf '%s' "$out" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('text')+' ['+str(d.get('reason'))+']')" 2>/dev/null || echo 'перевірка не відповіла') → scripts/install-runner.sh або картка Viber у Work OS"; fi
  fi
  if [ "$PROBLEMS" = 0 ]; then printf '\n%sУсе готове.%s\n' "$G" "$N"; else printf '\n%sПотребує уваги: %s%s\n' "$R" "$PROBLEMS" "$N"; return 1; fi
}

# --- Головний потік --------------------------------------------------------------------------------------------------------
[ "$(uname -s)" = Linux ] || die "підтримано лише Linux"
[ "$(id -u)" != 0 ] || die "запускайте від звичайного користувача (sudo спитається, коли потрібно)"
if [ "$MODE" = remove ]; then do_remove; exit 0; fi
detect_distro
if [ "$MODE" = check ]; then check_all; exit $?; fi
say "Work OS: встановлення runner. Адреса Work OS: $WORK_OS_URL"
[ "$DRY" = 1 ] && say "(режим --dry-run: нічого не змінюється)"
step_base
step_enroll
step_browser
step_waydroid
step_service
step_bind
[ "$DRY" = 1 ] || { sleep 3; check_all || true; }
