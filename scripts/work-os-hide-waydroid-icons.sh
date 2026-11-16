#!/bin/sh
# Ховає з меню програм ярлики Android-застосунків, які створює Waydroid (Work OS runner користується Android у фоні).
dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
for f in "$dir"/waydroid.*.desktop "$dir"/Waydroid.desktop "$dir"/work-os-waydroid.desktop; do
  [ -f "$f" ] || continue
  grep -q '^NoDisplay=true' "$f" && continue
  if grep -q '^NoDisplay=' "$f"; then sed -i 's/^NoDisplay=.*/NoDisplay=true/' "$f"
  else sed -i '0,/^\[Desktop Entry\]/s//[Desktop Entry]\nNoDisplay=true/' "$f"; fi
done
# Системні ярлики Waydroid перекриваються копіями в теці користувача з NoDisplay=true.
for name in Waydroid.desktop waydroid.market.desktop waydroid.app.install.desktop; do
  [ -f "/usr/share/applications/$name" ] && [ ! -f "$dir/$name" ] && { cp "/usr/share/applications/$name" "$dir/$name"; grep -q "^NoDisplay=true" "$dir/$name" || sed -i '0,/^\[Desktop Entry\]/s//[Desktop Entry]\nNoDisplay=true/' "$dir/$name"; }
done
update-desktop-database "$dir" >/dev/null 2>&1 || true
