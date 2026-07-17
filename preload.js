const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName, dataUrl) => ipcRenderer.invoke('save-file', { defaultName, dataUrl }),
  saveDDS: (defaultName, rgbaBase64, width, height) => ipcRenderer.invoke('save-dds', { defaultName, rgbaBase64, width, height })
});

window.addEventListener('DOMContentLoaded', () => {
  // Preload vacío para mantener la app segura y estable.
});
