#!/data/data/com.termux/files/usr/bin/bash
# One-time setup: clones openGym, builds it, and installs start/stop shortcuts.
# Run inside Termux (F-Droid build):  bash install.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/openGym"
DATA="$HOME/opengym-data"

echo "==> Installing Node.js and git"
pkg update -y
pkg install -y nodejs-lts git

if [ -d "$APP/.git" ]; then
  echo "==> Updating existing clone"
  git -C "$APP" pull --ff-only
else
  echo "==> Cloning openGym (about 550 MB, exercise animations included)"
  git clone --depth 1 https://github.com/DuarteSantos8/openGym.git "$APP"
fi

echo "==> Installing API dependencies"
(cd "$APP/api" && npm ci --omit=optional --no-audit --no-fund)

echo "==> Building the app (takes a few minutes on a phone)"
(cd "$APP/frontend" && npm ci --ignore-scripts --no-audit --no-fund && npm run build)

mkdir -p "$DATA" "$HOME/.opengym"
cp "$HERE/gateway.mjs" "$HERE/start.sh" "$HERE/stop.sh" "$HOME/.opengym/"
chmod +x "$HOME/.opengym/"*.sh

# Home-screen shortcuts via the Termux:Widget add-on (optional)
mkdir -p "$HOME/.shortcuts"
ln -sf "$HOME/.opengym/start.sh" "$HOME/.shortcuts/openGym start"
ln -sf "$HOME/.opengym/stop.sh"  "$HOME/.shortcuts/openGym stop"

# Auto-start when the phone boots via the Termux:Boot add-on (optional)
mkdir -p "$HOME/.termux/boot"
ln -sf "$HOME/.opengym/start.sh" "$HOME/.termux/boot/opengym"

echo
echo "Done. Start it with:  ~/.opengym/start.sh"
echo "Then open http://localhost:8080 in Chrome and choose  ⋮ → Add to Home screen / Install app"
