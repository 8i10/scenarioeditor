'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const cc = require('./ccfolia');
const br = require('./browser');
const { autoUpdater } = require('electron-updater');

// 設定・ログイン情報の保存先を固定（環境によって userData が親フォルダになるのを防ぐ）
app.setPath('userData', path.join(app.getPath('appData'), 'scenario-sender'));

const BAR_H = 44;
let win = null, viewer = null;
const rooms = []; // { id, win }
let roomSeq = 0;
let cfg = { html: '', room: '', target: '', keepClipboard: false, manualTabs: [] };

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() { try { Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))); } catch (_) {} }
function saveCfg() { try { fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch (_) {} }

function status(msg, level) { if (win && !win.isDestroyed()) win.webContents.send('status', { msg, level: level || 'info' }); }
// 送信できる部屋の一覧（アプリのウィンドウ＋連携ブラウザのタブ）
let browserOn = false;
async function allRooms() {
  const list = rooms.filter((r) => !r.win.isDestroyed()).map((r) => ({ key: 'w' + r.id, kind: 'app', title: r.win.getTitle() || ('部屋' + r.id), url: r.win.webContents.getURL(), win: r.win }));
  const b = await br.listRooms();
  browserOn = !!b;
  (b || []).forEach((t) => list.push({ key: 'b' + t.id, kind: 'browser', id: t.id, title: t.title, url: t.url, ws: t.ws }));
  return list;
}
let lastState = '';
async function state(force) {
  if (!win || win.isDestroyed()) return;
  const list = await allRooms();
  const st = { version: app.getVersion(), html: cfg.html, room: cfg.room, target: cfg.target, keepClipboard: cfg.keepClipboard, browserOn,
    rooms: list.map((r) => ({ key: r.key, kind: r.kind, title: r.title, url: r.url })) };
  const js = JSON.stringify(st);
  if (!force && js === lastState) return;
  lastState = js;
  if (win && !win.isDestroyed()) win.webContents.send('state', st);
}

function layout() {
  if (!win || !viewer) return;
  const [w, h] = win.getContentSize();
  viewer.setBounds({ x: 0, y: BAR_H, width: w, height: Math.max(0, h - BAR_H) });
}

function externalOnly(wc, allow) {
  wc.setWindowOpenHandler(({ url }) => {
    if (allow && allow(url)) return { action: 'allow' };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function openHtml(file) {
  if (!file) return;
  cfg.html = file; saveCfg(); state();
  viewer.webContents.loadFile(file).catch((e) => status('HTMLを開けませんでした：' + e.message, 'err'));
}

function normRoomUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://ccfolia.com/rooms/' + u.replace(/^\/+/, '');
  return u;
}

// ココフォリアの部屋は別ウィンドウで開く（複数可）
function openRoom(u) {
  u = normRoomUrl(u) || 'https://ccfolia.com/';
  cfg.room = u; saveCfg();
  const id = ++roomSeq;
  const rw = new BrowserWindow({
    width: 1280, height: 860, title: 'ココフォリア',
    webPreferences: { partition: 'persist:ccfolia', contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  rooms.push({ id, win: rw });
  externalOnly(rw.webContents, (url) => /^https:\/\/([a-z0-9-]+\.)*ccfolia\.com\//i.test(url) || /accounts\.google\.com|twitter\.com|x\.com|discord\.com/i.test(url));
  const touch = () => { const url = rw.webContents.getURL(); if (/ccfolia\.com\/rooms\//.test(url)) { cfg.room = url; saveCfg(); } state(); };
  rw.webContents.on('did-navigate', touch);
  rw.webContents.on('did-navigate-in-page', touch);
  rw.on('page-title-updated', () => setTimeout(state, 0));
  rw.on('closed', () => { const i = rooms.findIndex((r) => r.id === id); if (i >= 0) rooms.splice(i, 1); if (cfg.target === 'w' + id) { cfg.target = ''; saveCfg(); } state(); });
  rw.loadURL(u).catch((e) => status('ココフォリアを開けませんでした：' + e.message, 'err'));
  state();
}

// 送信先の部屋を決める（自動＝開いている部屋が1つのとき）
async function targetRoom() {
  const list = await allRooms();
  if (cfg.target) {
    const r = list.find((x) => x.key === cfg.target);
    if (r) return { room: r };
  }
  if (!list.length) return { error: 'ココフォリアの部屋が見つかりません（「🌐 ブラウザで開く」で部屋を開いてください）' };
  const inRoom = list.filter((r) => /ccfolia\.com\/rooms\//.test(r.url));
  if (inRoom.length === 1) return { room: inRoom[0] };
  if (list.length === 1) return { room: list[0] };
  return { error: '部屋が複数開いています。上の「送信先の部屋」で選んでください' };
}
function evalIn(room, expr) {
  if (room.kind === 'app') return room.win.webContents.executeJavaScript(expr, true);
  return br.evaluate(room.ws, expr);
}
async function enterIn(room) {
  if (room.kind === 'browser') return br.pressEnter(room.ws);
  const wc = room.win.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
}

function injected(fnName, arg) {
  return '(async () => {' + cc.findChat.toString() + cc.setNativeValue.toString() + cc.readSelectOptions.toString() + cc.closeSelect.toString() + cc.selectTabViaDropdown.toString() + cc.prepareSend.toString() + cc.diagnose.toString() +
    ' return await ' + fnName + '(' + (arg === undefined ? '' : JSON.stringify(arg)) + '); })()';
}

let busy = Promise.resolve();
async function sendToRoom(p) {
  const payload = { text: String((p && p.text) || ''), tab: String((p && p.tab) || ''), name: String((p && p.name) || '') };
  if (!payload.text.trim()) return { ok: false, error: '送信する文章がありません' };
  const t = await targetRoom();
  if (!t.room) return { ok: false, error: t.error };
  let r;
  try { r = await evalIn(t.room, injected('prepareSend', payload)); }
  catch (e) { return { ok: false, error: '送信処理でエラー：' + e.message }; }
  if (!r || !r.ok) return r || { ok: false, error: '不明なエラー' };
  if (r.method === 'enter') {
    // 送信ボタンが見つからない場合は、実際の Enter キー入力で送信
    try { await enterIn(t.room); } catch (e) { return { ok: false, error: 'Enter キーを送れませんでした：' + e.message }; }
  }
  if (cfg.keepClipboard) { try { require('electron').clipboard.writeText(payload.text); } catch (_) {} }
  return { ok: true };
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const def = { x: wa.x, y: wa.y, width: Math.round(wa.width * 0.735), height: wa.height };
  const b = cfg.bounds && cfg.bounds.width ? cfg.bounds : def;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, minWidth: 600, minHeight: 400,
    title: 'シナリオ送信ビューア',
    webPreferences: { preload: path.join(__dirname, 'preload-shell.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'shell.html'));

  viewer = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-viewer.js'), contextIsolation: true, sandbox: true },
  });
  win.contentView.addChildView(viewer);
  externalOnly(viewer.webContents);
  viewer.webContents.on('will-navigate', (e, url) => { if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); } });

  win.on('resize', layout);
  const keepBounds = () => { if (win && !win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) { cfg.bounds = win.getBounds(); saveCfg(); } };
  win.on('resized', keepBounds); win.on('moved', keepBounds);
  if (cfg.maximized) win.maximize();
  win.on('maximize', () => { cfg.maximized = true; saveCfg(); }); win.on('unmaximize', () => { cfg.maximized = false; saveCfg(); });
  win.on('closed', () => { rooms.slice().forEach((r) => { if (!r.win.isDestroyed()) r.win.close(); }); win = null; });
  layout();

  win.webContents.on('did-finish-load', () => {
    state(true);
    if (cfg.html && fs.existsSync(cfg.html)) openHtml(cfg.html);
    else viewer.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font-family:sans-serif;color:#666;display:flex;align-items:center;justify-content:center;height:90vh;margin:0">上の「📂 HTMLを開く」から閲覧用HTMLを選んでください</body>'));
  });
}

ipcMain.handle('kp-send', async (_e, p) => {
  const job = busy.then(() => sendToRoom(p));
  busy = job.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 250)));
  const r = await job;
  status(r.ok ? ('送信しました → ' + (p && p.tab ? p.tab : '（現在のタブ）')) : ('送信できませんでした：' + r.error), r.ok ? 'ok' : 'err');
  return r;
});
ipcMain.handle('kp-tabs', async () => {
  const t = await targetRoom();
  if (!t.room) return { ok: true, tabs: (cfg.manualTabs || []).filter(Boolean), error: t.error };
  const manual = (cfg.manualTabs || []).filter(Boolean);
  try {
    const d = await evalIn(t.room, injected('diagnose'));
    const fromSel = []; (d.selectOptions || []).forEach((s) => (s.options || []).forEach((o) => fromSel.push(o)));
    const clean = (x) => String(x || '').replace(/^[🔒🔓]\s*/u, '').replace(/[0-9０-９+]+$/, '').trim();
    return { ok: true, tabs: (d.tabs || []).concat(d.stripTabs || [], fromSel).map(clean).filter((x) => x && !/^[<>＜＞‹›«»]+$/.test(x)).concat(manual) };
  }
  catch (e) { return { ok: true, tabs: manual, error: e.message }; }
});
ipcMain.handle('kp-is-app', () => true);
ipcMain.handle('shell-open-html', async () => {
  const r = await dialog.showOpenDialog(win, { title: '閲覧用HTMLを開く', properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
  if (!r.canceled && r.filePaths[0]) openHtml(r.filePaths[0]);
});
ipcMain.handle('shell-reload', () => { if (cfg.html) openHtml(cfg.html); });
ipcMain.handle('shell-open-room', (_e, u) => openRoom(u));
ipcMain.handle('shell-target', (_e, key) => { cfg.target = key ? String(key) : ''; saveCfg(); state(true); });
ipcMain.handle('shell-focus-room', async () => {
  const t = await targetRoom();
  if (!t.room) { status(t.error, 'err'); return; }
  if (t.room.kind === 'app') { if (t.room.win.isMinimized()) t.room.win.restore(); t.room.win.focus(); }
  else { try { await br.activate(t.room.id); } catch (_) {} }
});
// 連携ブラウザ（Chrome / Edge）で部屋を開く
ipcMain.handle('shell-open-browser', async (_e, u) => {
  const url = normRoomUrl(u) || cfg.room || 'https://ccfolia.com/';
  if (normRoomUrl(u)) { cfg.room = url; saveCfg(); }
  if (await br.isConnected()) {
    try { await br.openUrl(url); status('連携ブラウザで部屋を開きました', 'ok'); } catch (e) { status('部屋を開けませんでした：' + e.message, 'err'); }
  } else {
    const r = br.launch(path.join(app.getPath('userData'), 'browser-profile'), url);
    status(r.ok ? '連携ブラウザを起動しました（初回はココフォリアにログインしてください）' : r.error, r.ok ? 'ok' : 'err');
  }
  setTimeout(() => state(), 2500);
});
ipcMain.handle('shell-keep-clipboard', (_e, v) => { cfg.keepClipboard = !!v; saveCfg(); state(); });
ipcMain.handle('shell-diagnose', async () => {
  let text;
  const t = await targetRoom();
  if (!t.room) text = t.error;
  else {
    try {
      const d = await evalIn(t.room, injected('diagnose'));
      text = '接続先：' + (t.room.kind === 'browser' ? '連携ブラウザ' : 'アプリのウィンドウ') +
        '\n部屋：' + (d.room ? 'OK' : '× 部屋が開かれていません') +
        '\nURL：' + d.url +
        '\nチャット入力欄：' + (d.textarea ? 'OK' : '× 見つかりません') +
        '\n名前欄：' + (d.nameInput ? 'OK（現在：' + d.nameValue + '）' : '× 見つかりません') +
        '\n送信ボタン：' + (d.submit ? 'OK' : '見つからないため Enter キーで送信します') +
        '\nチャットタブ（タブバー）：' + (d.tabs.length ? d.tabs.join(' ／ ') : 'なし') +
        '\nタブ帯の候補：' + ((d.stripTabs || []).join(' ／ ') || 'なし') +
        (d.selectOptions || []).map((x, i) => '\nプルダウン' + (i + 1) + (x.label ? '（' + x.label + '）' : '') + '：' + (x.options.length ? x.options.join(' ／ ') : '選択肢なし')).join('') +
        '\n手動設定のタブ：' + ((cfg.manualTabs || []).filter(Boolean).join(' ／ ') || 'なし') +
        '\n\nシナリオ側の送信先タブ名は、上のチャットタブ名と同じにしてください。';
    } catch (e) { text = '確認できませんでした：' + e.message; }
  }
  await dialog.showMessageBox(win, { type: 'info', title: '接続確認', message: 'ココフォリア接続確認', detail: text, buttons: ['OK'] });
});
ipcMain.handle('shell-check-update', () => checkUpdatesManually());
let tabsWin = null;
ipcMain.handle('shell-tabs', () => {
  if (tabsWin && !tabsWin.isDestroyed()) { tabsWin.focus(); return; }
  tabsWin = new BrowserWindow({ parent: win, modal: true, width: 460, height: 520, title: 'チャットタブ名の設定', resizable: true, minimizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload-shell.js'), contextIsolation: true, sandbox: true } });
  tabsWin.setMenuBarVisibility(false);
  tabsWin.loadFile(path.join(__dirname, 'tabs.html'));
  tabsWin.on('closed', () => { tabsWin = null; });
});
ipcMain.handle('tabs-get', () => (cfg.manualTabs || []));
ipcMain.handle('tabs-set', (_e, list) => { cfg.manualTabs = (Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean); saveCfg(); status('チャットタブ名を保存しました（' + cfg.manualTabs.length + '件）', 'ok'); if (tabsWin && !tabsWin.isDestroyed()) tabsWin.close(); });
ipcMain.handle('shell-devtools', () => { viewer.webContents.openDevTools({ mode: 'detach' }); });


// ---- アップデート（GitHub Releases から確認） ----
const RELEASES_URL = 'https://github.com/8i10/scenarioeditor/releases/latest';
let manualCheck = false;
function setupUpdater() {
  if (!app.isPackaged) return;
  // Mac は署名なしでは自動置き換えができないため、通知してダウンロードページを開く
  autoUpdater.autoDownload = process.platform !== 'darwin';
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', async (info) => {
    status('新しいバージョン ' + info.version + ' があります' + (autoUpdater.autoDownload ? '（ダウンロード中…）' : ''), 'ok');
    if (!autoUpdater.autoDownload) {
      const r = await dialog.showMessageBox(win, { type: 'info', title: 'アップデート', message: '新しいバージョン ' + info.version + ' があります', detail: 'ダウンロードページを開きますか？（ダウンロードしたアプリで上書きしてください）', buttons: ['ダウンロードページを開く', 'あとで'], defaultId: 0, cancelId: 1 });
      if (r.response === 0) shell.openExternal(RELEASES_URL);
    }
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', title: 'アップデート', message: '最新版です（' + app.getVersion() + '）', buttons: ['OK'] });
    manualCheck = false;
  });
  autoUpdater.on('download-progress', (p) => status('アップデートをダウンロード中… ' + Math.round(p.percent || 0) + '%'));
  autoUpdater.on('update-downloaded', async (info) => {
    manualCheck = false;
    const r = await dialog.showMessageBox(win, { type: 'info', title: 'アップデート', message: 'バージョン ' + info.version + ' の準備ができました', detail: '再起動して更新しますか？（「あとで」を選ぶと、アプリ終了時に更新されます）', buttons: ['再起動して更新', 'あとで'], defaultId: 0, cancelId: 1 });
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });
  autoUpdater.on('error', (e) => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'warning', title: 'アップデート', message: 'アップデートを確認できませんでした', detail: String((e && e.message) || e), buttons: ['OK'] });
    manualCheck = false;
  });
  autoUpdater.checkForUpdates().catch(() => {});
}
function checkUpdatesManually() {
  if (!app.isPackaged) { dialog.showMessageBox(win, { type: 'info', message: '開発版ではアップデート確認は使えません', buttons: ['OK'] }); return; }
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  loadCfg();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'ファイル', submenu: [{ label: '閲覧用HTMLを開く…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.send('menu', 'open') }, { type: 'separator' }, { role: 'quit', label: '終了' }] },
    { role: 'editMenu', label: '編集' },
    { label: 'ヘルプ', submenu: [{ label: 'アップデートを確認…', click: checkUpdatesManually }, { label: 'バージョン ' + app.getVersion(), enabled: false }] },
    { label: '表示', submenu: [{ label: 'HTMLを再読み込み', accelerator: 'CmdOrCtrl+R', click: () => cfg.html && openHtml(cfg.html) }, { type: 'separator' }, { role: 'togglefullscreen', label: '全画面' }] },
  ]));
  createWindow();
  setupUpdater();
  setInterval(() => { state().catch(() => {}); }, 3000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
