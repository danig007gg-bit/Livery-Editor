const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dxt = require('dxt-js');
const { registerKn5Import } = require('./kn5-main-module');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    title: 'Editor de Liveries Assetto Corsa',
    backgroundColor: '#0b0b0e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

// ── Registrar módulo KN5 ────────────────────────────────────────────
try {
  registerKn5Import({ app, ipcMain, dialog, projectDir: __dirname });
  console.log('[Main] KN5 module registered successfully');
} catch (e) {
  console.error('[Main] KN5 module registration failed:', e.message);
}

ipcMain.handle('save-file', async (event, { defaultName, dataUrl }) => {
  const ext = defaultName.split('.').pop().toLowerCase();
  const filters = ext === 'dds'
    ? [{ name: 'DDS Image', extensions: ['dds'] }]
    : [{ name: 'PNG Image', extensions: ['png'] }];
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters
  });
  if (canceled || !filePath) return { canceled: true };
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return { filePath };
});

// ── Exportar DDS con compresión DXT5 ────────────────────────────────
ipcMain.handle('save-dds', async (event, { defaultName, rgbaBase64, width, height }) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'DDS Image', extensions: ['dds'] }]
  });
  if (canceled || !filePath) return { canceled: true };

  try {
    const rgbaBuffer = Buffer.from(rgbaBase64, 'base64');
    const rgbaArray = new Uint8Array(rgbaBuffer);

    // Comprimir a DXT5 con squish/dxt-js
    const compressed = dxt.compress(rgbaArray, width, height, dxt.flags.DXT5);

    // Construir archivo DDS con header DXT5
    const headerSize = 128;
    const fileBuffer = Buffer.alloc(headerSize + compressed.length);

    // Magic "DDS "
    fileBuffer.writeUInt32LE(0x20534444, 0);
    // dwSize = 124
    fileBuffer.writeUInt32LE(124, 4);
    // dwFlags: CAPS | HEIGHT | WIDTH | PIXELFORMAT | LINEARSIZE
    fileBuffer.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8);
    // Height
    fileBuffer.writeUInt32LE(height, 12);
    // Width
    fileBuffer.writeUInt32LE(width, 16);
    // dwPitchOrLinearSize: total size of compressed data
    fileBuffer.writeUInt32LE(compressed.length, 20);
    // dwDepth = 0
    fileBuffer.writeUInt32LE(0, 24);
    // dwMipMapCount = 0
    fileBuffer.writeUInt32LE(0, 28);
    // dwReserved1[11] — already zero

    // DDS_PIXELFORMAT (offset 76)
    fileBuffer.writeUInt32LE(32, 76);          // ddspf.dwSize
    fileBuffer.writeUInt32LE(0x4, 80);         // ddspf.dwFlags = DDPF_FOURCC
    // FourCC = "DXT5"
    fileBuffer.write('DXT5', 84, 4, 'ascii');
    fileBuffer.writeUInt32LE(0, 88);           // dwRGBBitCount = 0
    fileBuffer.writeUInt32LE(0, 92);           // dwRBitMask = 0
    fileBuffer.writeUInt32LE(0, 96);           // dwGBitMask = 0
    fileBuffer.writeUInt32LE(0, 100);          // dwBBitMask = 0
    fileBuffer.writeUInt32LE(0, 104);          // dwABitMask = 0

    // dwCaps = DDSCAPS_TEXTURE
    fileBuffer.writeUInt32LE(0x1000, 108);
    // dwCaps2, dwCaps3, dwCaps4, dwReserved2 = 0

    // Compressed pixel data
    compressed.copy ? compressed.copy(fileBuffer, headerSize) : Buffer.from(compressed).copy(fileBuffer, headerSize);

    fs.writeFileSync(filePath, fileBuffer);
    return { filePath };
  } catch (err) {
    return { error: err.message };
  }
});

// ── Create skin folder and save files directly ──────────────────────
ipcMain.handle('create-skin', async (event, { carPath, skinName, files }) => {
  if (!carPath || !skinName || !files?.length) return { error: 'Missing parameters' };
  const skinsDir = path.join(carPath, 'skins');
  const skinDir = path.join(skinsDir, skinName);
  try {
    fs.mkdirSync(skinDir, { recursive: true });
    for (const file of files) {
      const filePath = path.join(skinDir, file.name);
      if (file.dds) {
        // Compress RGBA to DXT5 and save as DDS
        const rgbaBuffer = Buffer.from(file.data, 'base64');
        const rgbaArray = new Uint8Array(rgbaBuffer);
        const compressed = dxt.compress(rgbaArray, file.width, file.height, dxt.flags.DXT5);
        const headerSize = 128;
        const fileBuffer = Buffer.alloc(headerSize + compressed.length);
        fileBuffer.writeUInt32LE(0x20534444, 0);
        fileBuffer.writeUInt32LE(124, 4);
        fileBuffer.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8);
        fileBuffer.writeUInt32LE(file.height, 12);
        fileBuffer.writeUInt32LE(file.width, 16);
        fileBuffer.writeUInt32LE(compressed.length, 20);
        fileBuffer.writeUInt32LE(32, 76);
        fileBuffer.writeUInt32LE(0x4, 80);
        fileBuffer.write('DXT5', 84, 4, 'ascii');
        fileBuffer.writeUInt32LE(0x1000, 108);
        Buffer.from(compressed).copy(fileBuffer, headerSize);
        fs.writeFileSync(filePath, fileBuffer);
      } else {
        // Save raw base64 data (PNG)
        const data = Buffer.from(file.data, 'base64');
        fs.writeFileSync(filePath, data);
      }
    }

    // Copy ui_skin.json with project name
    const uiSkinTemplatePath = app.isPackaged
      ? path.join(process.resourcesPath, 'ui_skin.json')
      : path.join(__dirname, 'ui_skin.json');
    if (fs.existsSync(uiSkinTemplatePath)) {
      try {
        const uiSkin = JSON.parse(fs.readFileSync(uiSkinTemplatePath, 'utf8'));
        uiSkin.skinname = skinName;
        fs.writeFileSync(path.join(skinDir, 'ui_skin.json'), JSON.stringify(uiSkin, null, 2), 'utf8');
      } catch (_) {}
    }

    // Copy logo.png as livery.png
    const logoPath = app.isPackaged
      ? path.join(process.resourcesPath, 'logo.png')
      : path.join(__dirname, 'logo.png');
    if (fs.existsSync(logoPath)) {
      try { fs.copyFileSync(logoPath, path.join(skinDir, 'livery.png')); } catch (_) {}
    }

    return { skinDir, filesWritten: files.length + 2 };
  } catch (err) {
    return { error: err.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
