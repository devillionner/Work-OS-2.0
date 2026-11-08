# Runner Work OS: на чому він тримається і як поставити його на новий Linux

Runner — це програма на вашому ПК, яка виконує автопост: відкриває WhatsApp Web і Telegram Web у браузері та керує Viber в Android (Waydroid). Work OS у хмарі лише дає йому задачі через live-канал.

## Швидкий старт

```bash
git clone https://github.com/devillionner/Work-OS-2.0.git ~/Work-OS-2.0
~/Work-OS-2.0/scripts/install-runner.sh
```

Інсталятор сам визначить дистрибутив, спитає про браузер, поставить усе потрібне, запустить трей і наприкінці покаже перевірку готовності зеленим і червоним. Перевірити будь-коли без змін: `scripts/install-runner.sh --check`. Подивитись план без змін: `--dry-run`.

Підтримано: Arch/CachyOS/Manjaro/EndeavourOS (`pacman`), Fedora (`dnf`), Ubuntu/Debian/Mint (`apt`), x86_64. Windows і ARM-комп'ютери поки не підтримано.

## Від чого залежить runner

| Що | Навіщо | Специфічне? |
|---|---|---|
| Node.js ≥ 22.13 | Сам runner (`scripts/chat-discovery-runner.mjs`) | Ні. Якщо в системі старіший, інсталятор ставить офіційний Node без root з перевіркою SHA-256 |
| Залежності репозиторію (`npm ci`) | Імпорти спільного коду | Ні |
| Браузер із `--remote-debugging-port=9222` і прапорцями `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling` | Runner керує вкладками WhatsApp Web і Telegram Web через CDP; прапорці потрібні, щоб приховані вкладки не гальмували | Ні. Тут це Opera з `~/.local/share/applications/opera.desktop`; інсталятор уміє Opera, Chrome, Chromium, Brave |
| Профіль браузера з входами в WhatsApp Web і Telegram Web | Без нього треба сканувати QR | Ні. Тут це профіль вашої Opera; інсталятор за потреби створює окремий (`~/.local/share/work-os-runner-browser`) |
| Waydroid (образ GAPPS) | Android, у якому працює Viber | Ні, але пакети й kernel різні: `binder` у ядрі, на Ubuntu/Debian репозиторій `repo.waydro.id` |
| Перекладач ARM (`libhoudini` для Intel, `libndk` для AMD) | Viber — ARM-застосунок, а Waydroid на x86 | Ні. Ставиться через `waydroid_script` (закріплений комміт) |
| `persist.waydroid.suspend=false` | Інакше Android засинає й adb пропадає | Ні |
| `adb` (`android-tools`) і ключ `~/.android/adbkey` | Керування Android; ключ дописується в `adb_keys` Waydroid без root | Ні |
| ADBKeyBoard (`com.android.adbkeyboard`) | Введення підпису у Viber клавіатурою adb | Ні; APK перевіряється за SHA-256 |
| Viber, активований як додатковий пристрій | Сам автопост Viber | Ні; QR зі Viber на телефоні |
| Правила фаєрвола для `waydroid0` (`ufw route allow in/out on waydroid0` або зона `trusted` у firewalld) | Без них Android не має інтернету | Залежить від фаєрвола: тут `ufw` |
| systemd user-сервіс `work-os-runner-tray.service` | Піднімає трей при вході й після збою | Потрібен systemd (є скрізь у підтриманих системах) |
| Трей: Python `gi`, GTK 3, AppIndicator | Іконка, яка стартує й перезапускає runner | Назви пакетів різні, інсталятор знає їх; у GNOME потрібне розширення AppIndicator |
| Обробники `workos-runner://` і `workos-waydroid://` (`.desktop` + `xdg-mime`) | Кнопки «Запустити runner» і «Відкрити вікно» у Work OS | Ні |
| Правило вікон Android | Вікна Waydroid не виринають на робочому столі під час автопосту | **Залежить від робочого столу**, див. нижче |
| Токен runner | Авторизація live-каналу | Ні; береться зі сторінки Work OS у браузері runner |

### Вікна Android залежно від робочого столу

- **Hyprland** (як зараз): `scripts/hyprland-android-windows.mjs` сам ставить правило під час роботи адаптера. Інсталятору нічого додавати не треба.
- **KDE Plasma**: інсталятор додає правило KWin «Work OS: вікна Android» (клас `waydroid.*`: без фокусу, не в панелі завдань, згорнуте). **Не перевірено наживо.**
- **Інші** (GNOME, XFCE, інші Wayland/X11): інсталятор вимикає `persist.waydroid.multi_windows`, Android працює одним вікном, яке саме не з'являється. Розмір цього вікна інший, ніж у режимі за замовчуванням, а жести адаптера Viber від нього залежать. **Не перевірено: після встановлення проженіть автопост Viber на 2–3 чатах.** Змінити вибір: `--android-windows hide|off|keep`.

## Перенесення без повторної прив'язки

На старій системі:

```bash
scripts/runner-backup.sh backup            # спитає пароль, створить ~/work-os-runner-ДАТА.wosrunner
```

На новій системі:

```bash
scripts/install-runner.sh --restore ~/work-os-runner-ДАТА.wosrunner
```

В архіві: профіль браузера runner (сесії WhatsApp Web і Telegram Web), дані Waydroid (`~/.local/share/waydroid`, тобто Android із уже активованим Viber; розмір — гігабайти), ключ adb, налаштування runner. Те, що вже лежить на місці, не затирається, а відкладається як `*.bak-ДАТА`. Образ Android і перекладач ARM архів не містить: їх ставить інсталятор.

**Архів містить входи в WhatsApp, Telegram і Viber.** Він зашифрований паролем (AES-256), але тримайте його й пароль у безпечному місці. Пароль не відновлюється. Якщо runner працює у вашому щоденному браузері, а не в окремому профілі, у архів іде профіль цього браузера (це все його дані); задати інший: `--browser-profile ТЕКА`.

## Що перевірено і що ні

Перевірено: визначення дистрибутива й план встановлення для Arch (CachyOS), Fedora 41, Ubuntu 24.04 (`--dry-run` із підставленим `os-release`), відмова на непідтриманому; `--check` на цьому ПК; резервну копію й відновлення на тестових теках (правильний пароль, хибний пароль, наявне відкладається, вміст однаковий).

Не перевірено: справжнє встановлення в чистих контейнерах (на цьому ПК немає docker/podman/distrobox), `apt` і `dnf` гілки наживо, встановлення Waydroid з нуля, завантаження ADBKeyBoard за закріпленою сумою (сума взята з APK, який уже стоїть у цьому Waydroid, а чи збігається з нею файл за посиланням, покаже перший запуск: при розбіжності інсталятор нічого не ставить і друкує реальну суму), правило KWin і режим без `multi_windows` наживо, відновлення з архіву з Android-даними під `sudo`.
