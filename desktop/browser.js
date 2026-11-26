'use strict';
/*
 * ブラウザ連携：Chrome / Edge をデバッグ用ポート付きで起動し、
 * そのブラウザで開いているココフォリアの部屋タブへ DevTools プロトコル経由で送信する。
 * （Chrome の仕様上、通常のプロファイルにはポートを付けられないため、専用プロファイルで起動する）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = 9339;

function candidates() {
  const env = process.env;
  const list = [];
  if (env.SCENARIO_SENDER_BROWSER) list.push(env.SCENARIO_SENDER_BROWSER);
  if (process.platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter(Boolean);
    roots.forEach((r) => list.push(path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')));
    roots.forEach((r) => list.push(path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')));
  } else if (process.platform === 'darwin') {
    const home = env.HOME || '';
    ['/Applications', path.join(home, 'Applications')].forEach((d) => {
      list.push(path.join(d, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'));
      list.push(path.join(d, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'));
    });
  } else {
    ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'].forEach((p) => list.push(p));
  }
  return list;
}
function findBrowser() { return candidates().find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || ''; }

function request(method, p, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout: timeout || 800 }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { try { resolve(buf ? JSON.parse(buf) : null); } catch (_) { resolve(buf); } });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// 連携中ブラウザのココフォリア部屋タブ一覧（未接続なら null）
async function listRooms() {
  let l;
  try { l = await request('GET', '/json/list'); } catch (_) { return null; }
  if (!Array.isArray(l)) return null;
  return l.filter((t) => t.type === 'page' && /ccfolia\.com\/rooms\//.test(t.url || ''))
    .map((t) => ({ id: t.id, title: t.title || '', url: t.url, ws: t.webSocketDebuggerUrl }));
}
async function isConnected() { try { await request('GET', '/json/version'); return true; } catch (_) { return false; } }

function launch(profileDir, url) {
  const exe = findBrowser();
  if (!exe) return { ok: false, error: 'Google Chrome / Microsoft Edge が見つかりません' };
  try { fs.mkdirSync(profileDir, { recursive: true }); } catch (_) {}
  const args = ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir, '--no-first-run', '--no-default-browser-check'];
  if (url) args.push(url);
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) { return { ok: false, error: 'ブラウザを起動できませんでした：' + e.message }; }
  return { ok: true, exe };
}
async function openUrl(url) { return request('PUT', '/json/new?' + encodeURI(url), 3000); }
async function activate(id) { return request('GET', '/json/activate/' + encodeURIComponent(id), 2000); }

// DevTools プロトコルで1回分のやり取りをする
function session(wsUrl, fn) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') { reject(new Error('WebSocket が使えません')); return; }
    const ws = new WebSocket(wsUrl);
    let seq = 0; const waits = new Map();
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('ブラウザの応答がありません')); }, 15000);
    const send = (method, params) => new Promise((res, rej) => {
      const id = ++seq; waits.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (_) { return; }
      if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); if (m.error) w.rej(new Error(m.error.message)); else w.res(m.result); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ブラウザに接続できませんでした')); };
    ws.onopen = async () => {
      try { const r = await fn(send); clearTimeout(timer); ws.close(); resolve(r); }
      catch (e) { clearTimeout(timer); try { ws.close(); } catch (_) {} reject(e); }
    };
  });
}
async function evaluate(wsUrl, expression) {
  return session(wsUrl, async (send) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || '実行エラー');
    return r.result ? r.result.value : undefined;
  });
}
async function pressEnter(wsUrl) {
  return session(wsUrl, async (send) => {
    const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: '\r', unmodifiedText: '\r' }, base));
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  });
}

module.exports = { PORT, findBrowser, listRooms, isConnected, launch, openUrl, activate, evaluate, pressEnter };
