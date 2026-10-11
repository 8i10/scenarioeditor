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
  return { textarea, form, nameInput, submit, tabs };
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
    // メインタブは表示名が異なる場合があるため、見つからなければ先頭のタブをメインとして扱う
    if (!tab && /^(メイン|main)$/i.test(want) && c.tabs.length) tab = c.tabs[0];
    if (!tab) {
      return { ok: false, error: 'タブ「' + p.tab + '」が見つかりません（ココフォリア側：' + c.tabs.map((t) => (t.textContent || '').trim()).join('／') + '）' };
    }
    if (tab.getAttribute('aria-selected') !== 'true') { tab.click(); await wait(150); c = findChat(); }
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
function diagnose() {
  const c = findChat();
  return {
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

module.exports = { findChat, setNativeValue, prepareSend, diagnose };
