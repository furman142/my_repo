#!/data/data/com.termux/files/usr/bin/bash
# Starts the openGym API (port 3000) and the web gateway (port 8080) in the background.
APP="$HOME/openGym"; DATA="$HOME/opengym-data"; RUN="$HOME/.opengym"
command -v termux-wake-lock >/dev/null && termux-wake-lock   # keep Android from killing it
"$RUN/stop.sh" >/dev/null 2>&1 || true
cd "$APP/api" && \
  DATA_DIR="$DATA" PORT=3000 RP_ID=localhost ORIGIN=http://localhost:8080 RP_NAME=openGym \
  nohup node server.js > "$RUN/api.log" 2>&1 &
echo $! > "$RUN/api.pid"
OPENGYM_DIR="$APP" WEB_PORT=8080 PORT=3000 nohup node "$RUN/gateway.mjs" > "$RUN/web.log" 2>&1 &
echo $! > "$RUN/web.pid"
sleep 2
echo "openGym is running → http://localhost:8080   (logs in $RUN)"
