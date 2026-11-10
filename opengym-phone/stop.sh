#!/data/data/com.termux/files/usr/bin/bash
RUN="$HOME/.opengym"
for f in "$RUN/api.pid" "$RUN/web.pid"; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
command -v termux-wake-unlock >/dev/null && termux-wake-unlock
echo "openGym stopped"
