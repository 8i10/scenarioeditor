'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shellApi', {
  openHtml: () => ipcRenderer.invoke('shell-open-html'),
  reload: () => ipcRenderer.invoke('shell-reload'),
  openBrowser: (u) => ipcRenderer.invoke('shell-open-browser', u),
  target: (id) => ipcRenderer.invoke('shell-target', id),
  focusRoom: () => ipcRenderer.invoke('shell-focus-room'),
  keepClipboard: (v) => ipcRenderer.invoke('shell-keep-clipboard', v),
  diagnose: () => ipcRenderer.invoke('shell-diagnose'),
  checkUpdate: () => ipcRenderer.invoke('shell-check-update'),
  openTabs: (sec) => ipcRenderer.invoke('shell-tabs', sec),
  getTabs: () => ipcRenderer.invoke('tabs-get'),
  setTabs: (l) => ipcRenderer.invoke('tabs-set', l),
  devtools: (w) => ipcRenderer.invoke('shell-devtools', w),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, s) => cb(s)),
});
