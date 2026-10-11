'use strict';
// 閲覧用HTML側に送信用の窓口 window.kpBridge を用意する（HTML側の送信モードがこれを使う）
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kpBridge', {
  isApp: true,
  send: (payload) => ipcRenderer.invoke('kp-send', payload),
  tabs: () => ipcRenderer.invoke('kp-tabs'),
  chars: () => ipcRenderer.invoke('kp-chars'),
  scenes: () => ipcRenderer.invoke('kp-scenes'),
});
