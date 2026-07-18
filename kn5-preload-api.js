'use strict';

// Añadir estas propiedades al objeto que la aplicación ya exponga con contextBridge.
// No llames exposeInMainWorld() dos veces con el mismo nombre.
function createKn5PreloadApi(ipcRenderer) {
  return {
    selectKn5File: () => ipcRenderer.invoke('kn5:select-file'),
    selectAssettoRoot: () => ipcRenderer.invoke('kn5:select-root'),
    listAssettoCars: () => ipcRenderer.invoke('kn5:list-cars'),
    convertKn5: kn5Path => ipcRenderer.invoke('kn5:convert', kn5Path),
    readConvertedFolder: outputDir => ipcRenderer.invoke('kn5:read-output', outputDir)
  };
}

module.exports = { createKn5PreloadApi };
