// Electron main process: boots window, wires IPC + sync loop.
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLocalDb } from './db.js';
import { registerHandlers } from './handlers.js';
import { startSyncLoop, stopSyncLoop, onSyncStatus } from './sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 用 Electron 官方的 app.isPackaged 判断开发/生产，不依赖外部环境变量。
// 旧逻辑用 process.env.VITE_DEV_SERVER_URL 容易被遗留的 shell 会话污染，
// 导致正式打包的 exe 一启动就连到 dev server（5174），页面空白。
const isDev = !app.isPackaged;

let win: BrowserWindow | null = null;

async function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1180, minHeight: 720,
    title: '眼科客户管理系统',
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Forward sync status updates to renderer (preload re-exposes as onSyncStatus).
  onSyncStatus((s) => { win?.webContents.send('clinic:syncStatus', s); });

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5174';
    await win.loadURL(url);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
}

// Single-instance lock (front-desk device runs one window).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    await initLocalDb();
    registerHandlers(() => win);
    // Sync loop runs only if device is registered; safe to start (no-op when not bound).
    startSyncLoop();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    stopSyncLoop();
    if (process.platform !== 'darwin') app.quit();
  });
}
