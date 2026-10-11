'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shellApi', {
  openHtml: () => ipcRenderer.invoke('shell-open-html'),
  reload: () => ipcRenderer.invoke('shell-reload'),
  openRoom: (u) => ipcRenderer.invoke('shell-open-room', u),
  ratio: (r) => ipcRenderer.invoke('shell-ratio', r),
  keepClipboard: (v) => ipcRenderer.invoke('shell-keep-clipboard', v),
  diagnose: () => ipcRenderer.invoke('shell-diagnose'),
  devtools: (w) => ipcRenderer.invoke('shell-devtools', w),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, s) => cb(s)),
});
