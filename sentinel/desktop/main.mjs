// SENTINEL desktop app (Electron main process).
//
// Runs the SENTINEL server in-process (it supervises go2rtc as a child process) and shows the
// dashboard in a locked-down window. Nothing listens beyond 127.0.0.1 unless the user enables
// LAN mode in the advanced settings file.
import { app, BrowserWindow, dialog, Menu, nativeImage, session, shell, Tray } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = app.isPackaged ? process.resourcesPath : path.join(HERE, 'build');
const ASSETS = path.join(HERE, 'assets');
const USER = app.getPath('userData');
const DATA = path.join(USER, 'data');
const LOGS = path.join(USER, 'logs');
const ENV_FILE = path.join(USER, 'sentinel.env');
const PREFS_FILE = path.join(USER, 'desktop.json');
const startHidden = process.argv.includes('--hidden');

app.setName('SENTINEL');

// ---- one instance only ----------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

/** @type {BrowserWindow | null} */ let win = null;
/** @type {Tray | null} */ let tray = null;
/** @type {Awaited<ReturnType<any>> | null} */ let server = null;
let quitting = false;

// ---- small persisted desktop preferences ------------------------------------------------
function readPrefs() {
  try {
    return JSON.parse(readFileSync(PREFS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writePrefs(p) {
  writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2));
}

// ---- start at login ---------------------------------------------------------------------
const linuxAutostart = path.join(os.homedir(), '.config', 'autostart', 'sentinel.desktop');
function linuxExec() {
  // AppImage: the stable path is $APPIMAGE (process.execPath points into a temp mount).
  return process.env.APPIMAGE || process.execPath;
}
function getOpenAtLogin() {
  if (process.platform === 'linux') return existsSync(linuxAutostart);
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
}
function setOpenAtLogin(on) {
  if (!app.isPackaged) return; // never register a dev build
  if (process.platform === 'linux') {
    if (on) {
      mkdirSync(path.dirname(linuxAutostart), { recursive: true });
      writeFileSync(
        linuxAutostart,
        `[Desktop Entry]\nType=Application\nName=SENTINEL\nExec="${linuxExec()}" --hidden\nX-GNOME-Autostart-enabled=true\n`,
      );
    } else rmSync(linuxAutostart, { force: true });
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}

// ---- server -------------------------------------------------------------------------------
async function startBackend() {
  mkdirSync(DATA, { recursive: true });
  mkdirSync(LOGS, { recursive: true });
  const logFile = path.join(LOGS, 'sentinel.log');
  try {
    if (statSync(logFile).size > 5 * 1024 * 1024) renameSync(logFile, `${logFile}.1`);
  } catch {
    /* no log yet */
  }
  if (!existsSync(ENV_FILE)) {
    writeFileSync(
      ENV_FILE,
      [
        '# SENTINEL advanced settings (desktop app). Restart SENTINEL after editing.',
        '# Watching from your phone on the home network:',
        '#   SENTINEL_HOST=0.0.0.0',
        '#   SENTINEL_PASSWORD=<at least 10 characters>',
        '# Never port-forward SENTINEL on your router.',
        '',
      ].join('\n'),
    );
  }

  process.env.SENTINEL_DATA_DIR = DATA;
  process.env.SENTINEL_ENV_FILE = ENV_FILE;
  process.env.SENTINEL_WEB_DIST = path.join(RES, 'web');
  process.env.GO2RTC_BIN = path.join(RES, 'bin', process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc');

  const mod = await import(pathToFileURL(path.join(RES, 'server', 'server.mjs')).href);
  return mod.startServer({ fallbackToFreePort: true, logFile });
}

// ---- window -------------------------------------------------------------------------------
function iconPath() {
  return path.join(ASSETS, 'icon.png');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'SENTINEL — Security Command Center',
    backgroundColor: '#05070a',
    autoHideMenuBar: true,
    icon: existsSync(iconPath()) ? iconPath() : undefined,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Started hidden at login: don't pull camera video until the window is actually opened.
  win.loadURL(startHidden ? 'about:blank' : server.url);
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });

  // Stay on the dashboard; anything else opens in the system browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server.url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(server.go2rtc.url)) {
      openGo2rtcWindow(url);
      return { action: 'deny' };
    }
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing the window keeps SENTINEL in the tray; streams pause while hidden.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('hide', () => {
    if (!quitting) win.loadURL('about:blank'); // stop pulling video from the cameras
  });
  win.on('show', () => {
    if (!win.webContents.getURL().startsWith(server.url)) win.loadURL(server.url);
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** go2rtc's own WebUI (for the Xiaomi login), with its password filled in automatically. */
/** @type {BrowserWindow | null} */ let g2Win = null;
function openGo2rtcWindow(url) {
  if (g2Win && !g2Win.isDestroyed()) {
    g2Win.loadURL(url);
    g2Win.focus();
    return;
  }
  g2Win = new BrowserWindow({
    width: 1100,
    height: 820,
    parent: win ?? undefined,
    title: 'go2rtc — Xiaomi login',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  g2Win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//.test(u) && !u.startsWith(server.go2rtc.url)) void shell.openExternal(u);
    return { action: 'deny' };
  });
  g2Win.loadURL(url);
}

app.on('login', (event, webContents, details, authInfo, callback) => {
  const g2 = new URL(server?.go2rtc.url ?? 'http://127.0.0.1:0');
  if (!authInfo.isProxy && authInfo.host === g2.hostname && String(authInfo.port) === g2.port && g2Win && webContents === g2Win.webContents) {
    event.preventDefault();
    callback(server.go2rtc.username, server.go2rtc.password);
  }
});

// ---- tray -------------------------------------------------------------------------------
function buildTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('SENTINEL — Security Command Center');
  const refresh = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'פתח את SENTINEL', click: showWindow },
        { label: 'פתח בדפדפן', click: () => void shell.openExternal(server.url) },
        { type: 'separator' },
        {
          label: 'הפעל עם המחשב',
          type: 'checkbox',
          checked: getOpenAtLogin(),
          enabled: app.isPackaged,
          click: (item) => {
            setOpenAtLogin(item.checked);
            refresh();
          },
        },
        { label: 'הגדרות מתקדמות (קובץ)', click: () => void shell.openPath(ENV_FILE) },
        { label: 'תיקיית נתונים ולוגים', click: () => void shell.openPath(USER) },
        { type: 'separator' },
        { label: 'יציאה', click: () => quit() },
      ]),
    );
  refresh();
  tray.on('click', showWindow);
}

function buildAppMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]),
  );
}

async function quit() {
  quitting = true;
  try {
    await server?.stop();
  } finally {
    app.exit(0);
  }
}

// ---- lifecycle --------------------------------------------------------------------------
app.on('second-instance', showWindow);
app.on('activate', showWindow); // macOS dock click
app.on('before-quit', (e) => {
  if (!quitting) {
    e.preventDefault();
    void quit();
  }
});
app.on('window-all-closed', () => {
  /* keep running in the tray */
});

app.whenReady().then(async () => {
  // Media/camera/microphone/location etc. are never needed by the dashboard.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  // Snapshots go straight to Pictures/SENTINEL.
  session.defaultSession.on('will-download', (_e, item) => {
    const dir = path.join(app.getPath('pictures'), 'SENTINEL');
    mkdirSync(dir, { recursive: true });
    item.setSavePath(path.join(dir, item.getFilename()));
  });

  try {
    server = await startBackend();
  } catch (err) {
    dialog.showErrorBox('SENTINEL לא הצליח לעלות', `${err?.message ?? err}\n\nלוגים: ${LOGS}`);
    app.exit(1);
    return;
  }

  // First run of an installed app: start with the computer (can be turned off from the tray).
  const prefs = readPrefs();
  if (app.isPackaged && !prefs.loginItemInitialized) {
    setOpenAtLogin(true);
    writePrefs({ ...prefs, loginItemInitialized: true });
  }

  buildAppMenu();
  createWindow();
  buildTray();
});
