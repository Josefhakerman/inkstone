'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// ---------------------------------------------------------------------------
// Storage layout (fully offline, on-disk):
//   <userData>/data/tree.json               -> folder / workspace hierarchy
//   <userData>/data/workspaces/<id>.json    -> one file per workspace
// ---------------------------------------------------------------------------

const DATA_DIR = () => path.join(app.getPath('userData'), 'data');
const WS_DIR = () => path.join(DATA_DIR(), 'workspaces');
const TREE_FILE = () => path.join(DATA_DIR(), 'tree.json');

// The app has been renamed twice (NoteApp -> InkStone -> Kivrn) and the data
// folder is keyed to the product name, so carry an older library over on first
// run. Newest name first, and the old folder is left alone as a backup.
const LEGACY_APP_NAMES = ['InkStone', 'NoteApp'];

async function migrateLegacyData() {
  try {
    await fsp.access(DATA_DIR());
    return;                                   // already have our own data
  } catch (_) { /* fall through */ }

  const parent = path.dirname(app.getPath('userData'));
  for (const name of LEGACY_APP_NAMES) {
    const legacy = path.join(parent, name, 'data');
    try {
      await fsp.access(legacy);
      await fsp.cp(legacy, DATA_DIR(), { recursive: true });
      console.log(`migrated notes from the previous ${name} folder`);
      return;
    } catch (_) { /* try the next name */ }
  }
}

async function sweepTempFiles() {
  try {
    for (const name of await fsp.readdir(WS_DIR())) {
      if (name.endsWith('.tmp')) await fsp.unlink(path.join(WS_DIR(), name)).catch(() => {});
    }
  } catch (_) { /* nothing to sweep */ }
}

async function ensureDirs() {
  await migrateLegacyData();
  await fsp.mkdir(WS_DIR(), { recursive: true });
  await sweepTempFiles();
}

// Atomic write: temp file + rename, so a crash mid-save can't shred a note.
async function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj), 'utf8');
  await fsp.rename(tmp, file);
}

async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('readJson failed for', file, err);
    return fallback;
  }
}

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''));
const wsFile = (id) => path.join(WS_DIR(), `${id}.json`);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#e8e8e8', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Give the renderer a moment to flush pending saves before the window dies.
  let allowClose = false;
  mainWindow.on('close', (e) => {
    if (allowClose || mainWindow.webContents.isCrashed()) return;
    e.preventDefault();
    const done = () => { allowClose = true; mainWindow.close(); };
    const timer = setTimeout(done, 8000);
    ipcMain.once('app:flushed', () => { clearTimeout(timer); done(); });
    mainWindow.webContents.send('app:flush');
  });

  // Offline app: never let the renderer navigate away or spawn browser windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
}

nativeTheme.themeSource = 'dark';

app.whenReady().then(async () => {
  await ensureDirs();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

// --- IPC ------------------------------------------------------------------

ipcMain.handle('tree:load', async () => {
  await ensureDirs();
  return readJson(TREE_FILE(), null);
});

ipcMain.handle('tree:save', async (_e, tree) => {
  await ensureDirs();
  await writeJsonAtomic(TREE_FILE(), tree);
  return true;
});

ipcMain.handle('ws:load', async (_e, id) => {
  if (!safeId(id)) throw new Error('bad workspace id');
  return readJson(wsFile(id), null);
});

ipcMain.handle('ws:save', async (_e, id, data) => {
  if (!safeId(id)) throw new Error('bad workspace id');
  await ensureDirs();
  await writeJsonAtomic(wsFile(id), data);
  return true;
});

ipcMain.handle('ws:delete', async (_e, id) => {
  if (!safeId(id)) throw new Error('bad workspace id');
  try {
    await fsp.unlink(wsFile(id));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return true;
});

// Returns [{ name, dataUrl }] for the picked images.
ipcMain.handle('image:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Add images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
  });
  if (res.canceled) return [];
  const out = [];
  for (const p of res.filePaths) {
    try {
      const buf = await fsp.readFile(p);
      const ext = path.extname(p).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext === 'bmp' ? 'bmp' : ext}`;
      out.push({ name: path.basename(p), dataUrl: `data:${mime};base64,${buf.toString('base64')}` });
    } catch (err) {
      console.error('image read failed', p, err);
    }
  }
  return out;
});

ipcMain.handle('export:png', async (_e, dataUrl, suggestedName) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export workspace as PNG',
    defaultPath: `${(suggestedName || 'workspace').replace(/[\/:*?"<>|]/g, '_')}.png`,
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (res.canceled || !res.filePath) return null;
  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  await fsp.writeFile(res.filePath, Buffer.from(base64, 'base64'));
  return res.filePath;
});

ipcMain.handle('app:dataDir', async () => DATA_DIR());
ipcMain.handle('app:revealData', async () => {
  await ensureDirs();
  shell.openPath(DATA_DIR());
  return true;
});
