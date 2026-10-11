#!/usr/bin/env bash
# File-opening check for the desktop app (Linux debug build on Xvfb).
# Needs: target-app/debug/speculum-app built, vite dev on :1420, Xvfb, xdotool.
# Covers: argv open, window title, single instance (2nd launch hands its file
# to the running app and exits), reopen last file, bad file keeps current,
# Ctrl+O opens the Open dialog, Ctrl+Shift+S Save As writes + switches.
set -u
cd "$(dirname "$0")/.."
export DISPLAY=${FILES_DISPLAY:-:97}
APP=$(pwd)/target-app/debug/speculum-app
T=$(mktemp -d /tmp/spec-files.XXXX)
export XDG_CONFIG_HOME=$T/config XDG_DATA_HOME=$T/data HOME_OVERRIDE=$T
export WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
unset SPECULUM_FILE
pass=0; fail=0
ok(){ echo "PASS  $1"; pass=$((pass+1)); }
bad(){ echo "FAIL  $1"; fail=$((fail+1)); }
wait_title(){ # $1 title, $2 seconds
  for _ in $(seq 1 $(( ${2:-20} * 4 ))); do xdotool search --onlyvisible --name "^$1\$" >/dev/null 2>&1 && return 0; sleep 0.25; done; return 1; }
napps(){ pgrep -f "^$APP" | wc -l; }
cleanup(){ pkill -f "^$APP" 2>/dev/null; sleep 0.5; pkill -9 -f "^$APP" 2>/dev/null; }
trap 'cleanup; [ -n "${DBUS_PID:-}" ] && kill $DBUS_PID 2>/dev/null' EXIT
# Single instance uses the session bus on Linux; headless boxes have none.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then eval "$(dbus-launch --sh-syntax)"; DBUS_PID=$DBUS_SESSION_BUS_PID; fi
pgrep -f "Xvfb $DISPLAY" >/dev/null || { (setsid Xvfb "$DISPLAY" -screen 0 1440x900x24 >/dev/null 2>&1 &); sleep 1; }
curl -s -o /dev/null http://localhost:1420/ || { echo "FAIL  vite dev not running on :1420"; exit 1; }
cleanup
D="$T/docs dir"; mkdir -p "$D"
(cd "$D" && setsid "$APP" "Alpha.speculum" >"$T/app1.log" 2>&1 &)
wait_title "Alpha — Speculum" 40 && ok "argv (relative path) opens Alpha, title shows file name" || bad "argv open / title"
sleep 2; [ -f "$D/Alpha.speculum" ] && ok "new file created on disk" || bad "Alpha.speculum not created"

timeout 20 "$APP" "$D/Beta.speculum" >"$T/app2.log" 2>&1; rc=$?
[ $rc -ne 124 ] && ok "second launch exits (rc $rc)" || bad "second launch kept running"
wait_title "Beta — Speculum" 20 && ok "second launch switched running app to Beta" || bad "single-instance switch"
[ "$(napps)" = 1 ] && ok "one app process" || bad "app processes: $(napps)"
sleep 1; grep -q "Beta.speculum" "$T/config/"*/last-file.txt 2>/dev/null && ok "last file remembered" || bad "last-file.txt"

printf 'not json' > "$D/Broken.speculum"
timeout 20 "$APP" "$D/Broken.speculum" >/dev/null 2>&1
sleep 2; xdotool search --name "^Beta — Speculum\$" >/dev/null && ok "unreadable file keeps current document" || bad "broken file replaced current"
for w in $(xdotool search --onlyvisible --name "^Speculum\$" 2>/dev/null); do xdotool windowfocus --sync "$w"; xdotool key Return; done

W=$(xdotool search --name "^Beta — Speculum\$" | head -1)
xdotool windowfocus --sync "$W"; sleep 0.5
xdotool key --clearmodifiers ctrl+o
wait_title "Open Speculum file" 10 && ok "Ctrl+O shows Open dialog" || bad "Ctrl+O dialog"
DLG=$(xdotool search --onlyvisible --name '^Open Speculum file$' | head -1)
[ -n "$DLG" ] && { xdotool windowfocus --sync "$DLG"; xdotool key Escape; sleep 1; }
xdotool windowfocus --sync "$W"; sleep 0.5
xdotool key --clearmodifiers ctrl+shift+s
if wait_title "Save Speculum file as" 10; then
  ok "Ctrl+Shift+S shows Save As dialog"
  DLG=$(xdotool search --onlyvisible --name '^Save Speculum file as$' | head -1)
  xdotool windowfocus --sync "$DLG"; sleep 0.5; xdotool key ctrl+a; xdotool type --delay 20 "$D/Gamma"; sleep 0.3; xdotool key Return
  wait_title "Gamma — Speculum" 15 && ok "Save As switched to Gamma" || bad "Save As switch"
  [ -f "$D/Gamma.speculum" ] && ok "Save As wrote Gamma.speculum (extension added)" || bad "Gamma.speculum missing"
else bad "Ctrl+Shift+S dialog"; fi

pkill -f "^$APP"; sleep 2; cleanup
(cd /tmp && setsid "$APP" >"$T/app3.log" 2>&1 &)
wait_title "Gamma — Speculum" 40 && ok "relaunch without a file reopens the last file" || bad "reopen last file"
echo "files-check: pass $pass fail $fail ($T)"
[ $fail = 0 ]
