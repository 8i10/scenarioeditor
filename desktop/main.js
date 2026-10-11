'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const cc = require('./ccfolia');

// 設定・ログイン情報の保存先を固定（環境によって userData が親フォルダになるのを防ぐ）
app.setPath('userData', path.join(app.getPath('appData'), 'scenario-sender'));

const BAR_H = 44;
let win = null, viewer = null, room = null;
let cfg = { html: '', room: '', ratio: 0.55, keepClipboard: false };

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() { try { Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))); } catch (_) {} }
function saveCfg() { try { fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch (_) {} }

function status(msg, level) { if (win && !win.isDestroyed()) win.webContents.send('status', { msg, level: level || 'info' }); }
function state() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', { html: cfg.html, room: cfg.room, ratio: cfg.ratio, keepClipboard: cfg.keepClipboard });
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const lw = Math.round(w * cfg.ratio);
  viewer.setBounds({ x: 0, y: BAR_H, width: lw, height: Math.max(0, h - BAR_H) });
  room.setBounds({ x: lw + 1, y: BAR_H, width: Math.max(0, w - lw - 1), height: Math.max(0, h - BAR_H) });
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
function openRoom(u) {
  u = normRoomUrl(u) || 'https://ccfolia.com/';
  cfg.room = u; saveCfg(); state();
  room.webContents.loadURL(u).catch((e) => status('ココフォリアを開けませんでした：' + e.message, 'err'));
}

function injected(fnName, arg) {
  return '(async () => {' + cc.findChat.toString() + cc.setNativeValue.toString() + cc.prepareSend.toString() + cc.diagnose.toString() +
    ' return await ' + fnName + '(' + (arg === undefined ? '' : JSON.stringify(arg)) + '); })()';
}

let busy = Promise.resolve();
async function sendToRoom(p) {
  const payload = { text: String((p && p.text) || ''), tab: String((p && p.tab) || ''), name: String((p && p.name) || '') };
  if (!payload.text.trim()) return { ok: false, error: '送信する文章がありません' };
  if (!room) return { ok: false, error: 'ココフォリアが開かれていません' };
  const wc = room.webContents;
  let r;
  try { r = await wc.executeJavaScript(injected('prepareSend', payload), true); }
  catch (e) { return { ok: false, error: '送信処理でエラー：' + e.message }; }
  if (!r || !r.ok) return r || { ok: false, error: '不明なエラー' };
  if (r.method === 'enter') {
    // 送信ボタンが見つからない場合は、実際の Enter キー入力で送信
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  }
  if (cfg.keepClipboard) { try { require('electron').clipboard.writeText(payload.text); } catch (_) {} }
  return { ok: true };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 800, minHeight: 500,
    title: 'シナリオ送信ビューア',
    webPreferences: { preload: path.join(__dirname, 'preload-shell.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'shell.html'));

  viewer = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-viewer.js'), contextIsolation: true, sandbox: true },
  });
  room = new WebContentsView({
    webPreferences: { partition: 'persist:ccfolia', contextIsolation: true, sandbox: true },
  });
  win.contentView.addChildView(viewer);
  win.contentView.addChildView(room);
  externalOnly(viewer.webContents);
  externalOnly(room.webContents, (u) => /^https:\/\/([a-z0-9-]+\.)*ccfolia\.com\//i.test(u) || /accounts\.google\.com|twitter\.com|x\.com|discord\.com/i.test(u));
  viewer.webContents.on('will-navigate', (e, url) => { if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  room.webContents.on('did-navigate', (_e, url) => { if (/ccfolia\.com\/rooms\//.test(url)) { cfg.room = url; saveCfg(); state(); } });
  room.webContents.on('did-navigate-in-page', (_e, url) => { if (/ccfolia\.com\/rooms\//.test(url)) { cfg.room = url; saveCfg(); state(); } });

  win.on('resize', layout);
  layout();

  win.webContents.on('did-finish-load', () => {
    state();
    if (cfg.html && fs.existsSync(cfg.html)) openHtml(cfg.html);
    else viewer.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font-family:sans-serif;color:#666;display:flex;align-items:center;justify-content:center;height:90vh;margin:0">上の「📂 HTMLを開く」から閲覧用HTMLを選んでください</body>'));
    openRoom(cfg.room || 'https://ccfolia.com/');
  });
}

ipcMain.handle('kp-send', async (_e, p) => {
  const job = busy.then(() => sendToRoom(p));
  busy = job.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 250)));
  const r = await job;
  status(r.ok ? ('送信しました → ' + (p && p.tab ? p.tab : '（現在のタブ）')) : ('送信できませんでした：' + r.error), r.ok ? 'ok' : 'err');
  return r;
});
ipcMain.handle('kp-is-app', () => true);
ipcMain.handle('shell-open-html', async () => {
  const r = await dialog.showOpenDialog(win, { title: '閲覧用HTMLを開く', properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
  if (!r.canceled && r.filePaths[0]) openHtml(r.filePaths[0]);
});
ipcMain.handle('shell-reload', () => { if (cfg.html) openHtml(cfg.html); });
ipcMain.handle('shell-open-room', (_e, u) => openRoom(u));
ipcMain.handle('shell-ratio', (_e, r) => { cfg.ratio = Math.min(0.8, Math.max(0.2, Number(r) || 0.55)); saveCfg(); layout(); state(); });
ipcMain.handle('shell-keep-clipboard', (_e, v) => { cfg.keepClipboard = !!v; saveCfg(); state(); });
ipcMain.handle('shell-diagnose', async () => {
  let text;
  try {
    const d = await room.webContents.executeJavaScript(injected('diagnose'), true);
    text = '部屋：' + (d.room ? 'OK' : '× 部屋が開かれていません') +
      '\nURL：' + d.url +
      '\nチャット入力欄：' + (d.textarea ? 'OK' : '× 見つかりません') +
      '\n名前欄：' + (d.nameInput ? 'OK（現在：' + d.nameValue + '）' : '× 見つかりません') +
      '\n送信ボタン：' + (d.submit ? 'OK' : '見つからないため Enter キーで送信します') +
      '\nチャットタブ：' + (d.tabs.length ? d.tabs.join(' ／ ') : '× 見つかりません') +
      '\n\nシナリオ側の送信先タブ名は、上のチャットタブ名と同じにしてください。';
  } catch (e) { text = '確認できませんでした：' + e.message; }
  await dialog.showMessageBox(win, { type: 'info', title: '接続確認', message: 'ココフォリア接続確認', detail: text, buttons: ['OK'] });
});
ipcMain.handle('shell-devtools', (_e, which) => { (which === 'room' ? room : viewer).webContents.openDevTools({ mode: 'detach' }); });

app.whenReady().then(() => {
  loadCfg();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'ファイル', submenu: [{ label: '閲覧用HTMLを開く…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.send('menu', 'open') }, { type: 'separator' }, { role: 'quit', label: '終了' }] },
    { role: 'editMenu', label: '編集' },
    { label: '表示', submenu: [{ label: 'HTMLを再読み込み', accelerator: 'CmdOrCtrl+R', click: () => cfg.html && openHtml(cfg.html) }, { label: 'ココフォリアを再読み込み', accelerator: 'CmdOrCtrl+Shift+R', click: () => room && room.webContents.reload() }, { type: 'separator' }, { role: 'togglefullscreen', label: '全画面' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
