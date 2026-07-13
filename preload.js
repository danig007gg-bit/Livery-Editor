const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName, dataUrl) => ipcRenderer.invoke('save-file', { defaultName, dataUrl })
});

window.addEventListener('DOMContentLoaded', () => {
  // Preload vacío para mantener la app segura y estable.
});
