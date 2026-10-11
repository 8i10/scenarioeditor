'use strict';
/*
 * ココフォリアの部屋ページ内で実行される関数群。
 * main.js から webContents.executeJavaScript で文字列化して注入する。
 * ココフォリアの画面構成が変わった場合はここを調整する。
 */

// チャット欄の要素を探す
function findChat() {
  const vis = (el) => !!(el && el.offsetParent !== null);
  const areas = Array.from(document.querySelectorAll('textarea')).filter(vis);
  const textarea =
    areas.find((t) => t.name === 'text') ||
    areas.find((t) => /メッセージ|message|発言/i.test(t.placeholder || '')) ||
    areas[areas.length - 1] || null;
  const form = textarea ? textarea.closest('form') : null;
  const scope = form || document;
  const nameInput =
    scope.querySelector('input[name="name"]') ||
    document.querySelector('input[name="name"]') || null;
  let submit = null;
  if (form) {
    submit = form.querySelector('button[type="submit"]') ||
      Array.from(form.querySelectorAll('button')).find((b) => /送信|send/i.test(b.textContent || b.getAttribute('aria-label') || '')) || null;
  }
  // チャットタブ（MUI Tabs）。チャット欄に最も近い tablist を優先
  let tabs = Array.from(document.querySelectorAll('[role="tab"]')).filter(vis);
  if (textarea) {
    const lists = Array.from(document.querySelectorAll('[role="tablist"]')).filter(vis);
    const tr = textarea.getBoundingClientRect();
    let best = null, bestD = Infinity;
    lists.forEach((l) => {
      const r = l.getBoundingClientRect();
      const overlapX = Math.min(r.right, tr.right) - Math.max(r.left, tr.left);
      if (overlapX <= 0) return;
      const d = Math.abs(tr.top - r.bottom);
      if (d < bestD) { bestD = d; best = l; }
    });
    if (best) tabs = Array.from(best.querySelectorAll('[role="tab"]')).filter(vis);
  }
  tabs = tabs.filter((t) => (t.textContent || '').trim());
  // 送信先タブのプルダウン（チャット入力欄の近くにあるセレクト）
  const selScope = form || (textarea ? textarea.parentElement && textarea.parentElement.parentElement : null) || document;
  const selects = Array.from(selScope.querySelectorAll('select,[role="combobox"],[aria-haspopup="listbox"]'))
    .filter((el) => vis(el) && el !== nameInput && !(nameInput && el.contains(nameInput)));
  return { textarea, form, nameInput, submit, tabs, selects };
}

// プルダウンの選択肢を読む（MUI のセレクトは一度開いて読み、閉じる）
async function readSelectOptions(sel) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (sel.tagName === 'SELECT') return Array.from(sel.options).map((o) => ({ label: (o.textContent || '').trim(), el: o }));
  sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  await wait(180);
  const opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"],[role="menu"] [role="menuitem"]'))
    .map((o) => ({ label: (o.textContent || '').trim(), el: o })).filter((o) => o.label);
  return opts;
}
function closeSelect() {
  const lb = document.querySelector('[role="listbox"],[role="menu"]');
  const target = lb || document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  const bd = document.querySelector('.MuiBackdrop-root,.MuiBackdrop-invisible');
  if (bd && document.querySelector('[role="listbox"],[role="menu"]')) bd.click();
}
// プルダウンで送信先タブを選ぶ
async function selectTabViaDropdown(c, want, norm) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = [];
  for (const sel of c.selects) {
    const opts = await readSelectOptions(sel);
    opts.forEach((o) => seen.push(o.label));
    let hit = opts.find((o) => norm(o.label) === want) || opts.find((o) => norm(o.label).indexOf(want) === 0);
    if (!hit && /^(メイン|main)$/i.test(want)) hit = opts.find((o) => /メイン|main/i.test(o.label));
    if (hit) {
      if (sel.tagName === 'SELECT') { setNativeValue(sel, hit.el.value); }
      else { hit.el.click(); await wait(120); }
      return { ok: true };
    }
    if (sel.tagName !== 'SELECT') { closeSelect(); await wait(100); }
  }
  return { ok: false, seen };
}

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// 送信準備：タブ切替・名前・本文の入力まで行い、送信方法を返す
async function prepareSend(p) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!/ccfolia\.com$/.test(location.hostname) || !/\/rooms\//.test(location.pathname)) {
    return { ok: false, error: 'ココフォリアの部屋が開かれていません' };
  }
  let c = findChat();
  if (!c.textarea) return { ok: false, error: 'チャット入力欄が見つかりません（チャットパネルを表示してください）' };
  if (p.tab) {
    const norm = (s) => String(s || '').replace(/\s+/g, '').trim();
    const want = norm(p.tab);
    let tab = c.tabs.find((t) => norm(t.textContent) === want) || c.tabs.find((t) => norm(t.textContent).indexOf(want) === 0);
    if (tab) {
      if (tab.getAttribute('aria-selected') !== 'true') { tab.click(); await wait(150); c = findChat(); }
    } else {
      // タブバーに無い場合は、入力欄近くのプルダウンから選ぶ
      const r = await selectTabViaDropdown(c, want, norm);
      if (!r.ok) {
        // メインタブは表示名が異なる場合があるため、先頭のタブをメインとして扱う
        if (/^(メイン|main)$/i.test(want) && c.tabs.length) { if (c.tabs[0].getAttribute('aria-selected') !== 'true') { c.tabs[0].click(); await wait(150); } }
        else {
          const names = c.tabs.map((t) => (t.textContent || '').trim()).concat(r.seen || []);
          return { ok: false, error: 'タブ「' + p.tab + '」が見つかりません（ココフォリア側：' + (names.join('／') || 'なし') + '）' };
        }
      }
      c = findChat();
    }
  }
  if (p.name && c.nameInput && c.nameInput.value !== p.name) {
    setNativeValue(c.nameInput, p.name);
    await wait(30);
  }
  c.textarea.focus();
  setNativeValue(c.textarea, p.text || '');
  await wait(30);
  if (c.submit && !c.submit.disabled) {
    c.submit.click();
    return { ok: true, method: 'button' };
  }
  c.textarea.focus();
  return { ok: true, method: 'enter' };
}

// 接続確認用：見つかった要素を報告
async function diagnose() {
  const c = findChat();
  const selectOptions = [];
  for (const sel of c.selects) {
    try {
      const opts = await readSelectOptions(sel);
      selectOptions.push({ label: (sel.getAttribute('aria-label') || sel.textContent || sel.name || '').trim().slice(0, 30), options: opts.map((o) => o.label) });
      if (sel.tagName !== 'SELECT') { closeSelect(); await new Promise((r) => setTimeout(r, 100)); }
    } catch (_) {}
  }
  return {
    selectOptions,
    url: location.href,
    room: /ccfolia\.com$/.test(location.hostname) && /\/rooms\//.test(location.pathname),
    textarea: !!c.textarea,
    textareaName: c.textarea ? (c.textarea.name || '') : '',
    nameInput: !!c.nameInput,
    nameValue: c.nameInput ? c.nameInput.value : '',
    submit: !!c.submit,
    tabs: c.tabs.map((t) => (t.textContent || '').trim()),
  };
}

module.exports = { findChat, setNativeValue, readSelectOptions, closeSelect, selectTabViaDropdown, prepareSend, diagnose };
