# openGym on your phone

Self-host [openGym](https://github.com/DuarteSantos8/openGym) (AGPL-3.0, by Duarte Santos)
**on your Android phone itself** and use it like a normal app from your home screen.
No PC, no Docker, no cloud: the server runs in Termux, your data stays in `~/opengym-data`.

```
Chrome / home-screen app  ──►  gateway.mjs :8080  ──►  openGym API :3000  ──►  ~/opengym-data
                               (frontend + exercise media)                     (JSON files)
```

`gateway.mjs` replaces the nginx container from upstream's `docker-compose.yml`, so the
whole thing runs on Termux's plain Node.js.

## Setup (once, ~10 minutes)

1. Install **Termux from F-Droid** (<https://f-droid.org/packages/com.termux/>). The Play Store
   version is outdated. Optional add-ons from F-Droid: **Termux:Widget** (home-screen
   start/stop buttons) and **Termux:Boot** (start automatically when the phone boots).
2. In Termux:
   ```bash
   pkg install -y git
   git clone https://github.com/furman142/my_repo.git
   bash my_repo/opengym-phone/install.sh
   ~/.opengym/start.sh
   ```
   You need ~1.5 GB free space (the exercise animations are ~220 MB, plus build tools).
3. Open **Chrome** → `http://localhost:8080` → menu **⋮ → Add to Home screen / Install app**.
   You now have an openGym icon that opens full screen like a real app, works offline,
   and has the rest timer, plans, progress charts and all 5,600+ exercises.
4. Tap **Create profile** (passkey with your fingerprint) or **Continue without account**.

## Everyday use

| Want to | Do |
|---|---|
| Start the server | `~/.opengym/start.sh`, or the *openGym start* widget |
| Stop it | `~/.opengym/stop.sh`, or the *openGym stop* widget |
| Start on boot | Install Termux:Boot and open it once; already wired up |
| Update openGym | `bash my_repo/opengym-phone/install.sh` again |
| Back up | copy `~/opengym-data` (e.g. `cp -r ~/opengym-data /sdcard/` after `termux-setup-storage`) |
| See logs | `~/.opengym/api.log`, `~/.opengym/web.log` |

**Keep it alive:** Android likes to kill background apps. `start.sh` takes a Termux wake lock,
and you should also set Termux's battery usage to **Unrestricted** (Settings → Apps → Termux →
Battery). The app itself caches offline, so a workout keeps working even if the server was
killed; it syncs once the server is running again.

The server only listens on `127.0.0.1`, so nothing else on your Wi-Fi can reach it.
To reach it from your laptop on the same network, start with `BIND=0.0.0.0`; passkeys from
other devices then need HTTPS (see upstream's `docs/SELF_HOSTING_HTTPS.md`).

## Even simpler alternative

openGym also ships an official Android APK that runs **fully on the phone with no server at
all** (pick "On this phone only" on first launch):
<https://github.com/DuarteSantos8/openGym/releases/latest>. Use the Termux setup above if you
want the real self-hosted server (to sync a laptop/tablet later, use the API, webhooks, etc.).
