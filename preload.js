'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadTree: () => ipcRenderer.invoke('tree:load'),
  saveTree: (tree) => ipcRenderer.invoke('tree:save', tree),

  loadWorkspace: (id) => ipcRenderer.invoke('ws:load', id),
  saveWorkspace: (id, data) => ipcRenderer.invoke('ws:save', id, data),
  deleteWorkspace: (id) => ipcRenderer.invoke('ws:delete', id),

  pickImages: () => ipcRenderer.invoke('image:pick'),
  exportPng: (dataUrl, name) => ipcRenderer.invoke('export:png', dataUrl, name),

  onFlush: (fn) => ipcRenderer.on('app:flush', () => fn()),
  flushed: () => ipcRenderer.send('app:flushed'),

  dataDir: () => ipcRenderer.invoke('app:dataDir'),
  revealData: () => ipcRenderer.invoke('app:revealData')
});
