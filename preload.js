const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName, dataUrl) => ipcRenderer.invoke('save-file', { defaultName, dataUrl }),
  saveDDS: (defaultName, rgbaBase64, width, height) => ipcRenderer.invoke('save-dds', { defaultName, rgbaBase64, width, height }),
  // KN5 API
  selectKn5File: () => ipcRenderer.invoke('kn5:select-file'),
  selectAssettoRoot: () => ipcRenderer.invoke('kn5:select-root'),
  listAssettoCars: () => ipcRenderer.invoke('kn5:list-cars'),
  convertKn5: (kn5Path) => ipcRenderer.invoke('kn5:convert', kn5Path),
  readConvertedFolder: (outputDir) => ipcRenderer.invoke('kn5:read-output', outputDir),
  getCarPreview: (previewPath) => ipcRenderer.invoke('kn5:get-preview', previewPath),
  getCarPreviews: (previewPaths) => ipcRenderer.invoke('kn5:get-previews', previewPaths),
  createSkin: (carPath, skinName, files) => ipcRenderer.invoke('create-skin', { carPath, skinName, files })
});

window.addEventListener('DOMContentLoaded', () => {
  // Preload ready
});
