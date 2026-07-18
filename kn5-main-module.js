'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const OUTPUT_EXTENSIONS = /\.(fbx|ini|png|jpe?g|dds|tga)$/i;
const TEMP_PREFIX = 'kn5-import-';

function registerKn5Import({ app, ipcMain, dialog, projectDir = __dirname }) {
  const activeTempRoots = new Set();
  const outputToTempRoot = new Map();

  const settingsPath = () => path.join(app.getPath('userData'), 'kn5-settings.json');
  const readSettings = () => {
    try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
    catch (_) { return {}; }
  };
  const writeSettings = settings => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  };
  const isAssettoRoot = root => !!root && fs.existsSync(path.join(root, 'content', 'cars'));
  const normalizeAssettoRoot = selected => {
    if (!selected) return null;
    const absolute = path.resolve(selected);
    if (isAssettoRoot(absolute)) return absolute;
    if (path.basename(absolute).toLowerCase() === 'content' && fs.existsSync(path.join(absolute, 'cars'))) {
      return path.dirname(absolute);
    }
    if (path.basename(absolute).toLowerCase() === 'cars' && path.basename(path.dirname(absolute)).toLowerCase() === 'content') {
      const root = path.dirname(path.dirname(absolute));
      return isAssettoRoot(root) ? root : null;
    }
    return null;
  };
  const findAssettoRoot = () => {
    const candidates = [
      readSettings().acRoot,
      'D:\\SteamLibrary\\steamapps\\common\\assettocorsa',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa',
      'C:\\Program Files\\Steam\\steamapps\\common\\assettocorsa'
    ];
    return candidates.find(isAssettoRoot) || null;
  };
  const usefulKn5 = fileName => {
    const lower = fileName.toLowerCase();
    return lower.endsWith('.kn5') && lower !== 'collider.kn5'
      && !/_lod_[b-z](?:\.|_)/i.test(lower)
      && !/(?:^|[_-])lod[b-z](?:\.|[_-])/i.test(lower);
  };
  const readCarName = (carDir, fallback) => {
    try {
      const raw = fs.readFileSync(path.join(carDir, 'ui', 'ui_car.json'), 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(raw).name || fallback;
    } catch (_) { return fallback; }
  };
  const readCarBrand = (carDir) => {
    try {
      const raw = fs.readFileSync(path.join(carDir, 'ui', 'ui_car.json'), 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(raw).brand || '';
    } catch (_) { return ''; }
  };
  const findCarPreviewPath = (carDir) => {
    // Look for preview.jpg or preview.png in any skin folder
    const skinsDir = path.join(carDir, 'skins');
    if (!fs.existsSync(skinsDir)) return null;
    try {
      const skins = fs.readdirSync(skinsDir, { withFileTypes: true }).filter(e => e.isDirectory());
      for (const skin of skins) {
        const skinDir = path.join(skinsDir, skin.name);
        // Try common preview filenames
        const candidates = ['preview.jpg', 'preview.png', 'Preview.jpg', 'Preview.png'];
        for (const name of candidates) {
          const p = path.join(skinDir, name);
          if (fs.existsSync(p)) return p;
        }
        // Fallback: find any file starting with "preview"
        try {
          const files = fs.readdirSync(skinDir);
          const prev = files.find(f => /^preview\.(jpg|jpeg|png)$/i.test(f));
          if (prev) return path.join(skinDir, prev);
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  };
  const listCars = root => {
    if (!isAssettoRoot(root)) throw new Error('No se ha encontrado una instalación válida de Assetto Corsa.');
    const carsRoot = path.join(root, 'content', 'cars');
    return fs.readdirSync(carsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const carDir = path.join(carsRoot, entry.name);
        const kn5 = fs.readdirSync(carDir, { withFileTypes: true })
          .filter(item => item.isFile() && usefulKn5(item.name))
          .map(item => ({ name: item.name, path: path.join(carDir, item.name) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return { id: entry.name, name: readCarName(carDir, entry.name), brand: readCarBrand(carDir), path: carDir, kn5, previewPath: findCarPreviewPath(carDir) };
      })
      .filter(car => car.kn5.length)
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const converterDir = () => app.isPackaged
    ? path.join(process.resourcesPath, 'kn5-tools')
    : path.join(projectDir, 'kn5-tools');

  const managedTempRoot = root => {
    const resolved = root && path.resolve(root);
    return !!resolved && path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith(TEMP_PREFIX);
  };
  const removeTempRoot = root => {
    if (!managedTempRoot(root)) return;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
    activeTempRoots.delete(root);
    for (const [output, mappedRoot] of outputToTempRoot) if (mappedRoot === root) outputToTempRoot.delete(output);
  };
  const cleanupOldTempRoots = () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    try {
      for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;
        const fullPath = path.join(os.tmpdir(), entry.name);
        try { if (fs.statSync(fullPath).mtimeMs < cutoff) removeTempRoot(fullPath); } catch (_) {}
      }
    } catch (_) {}
  };
  const runConverter = kn5Path => new Promise((resolve, reject) => {
    const toolDir = converterDir();
    const executable = path.join(toolDir, 'Kn5ToFbx.exe');
    if (!fs.existsSync(executable)) return reject(new Error('No se encuentra kn5-tools/Kn5ToFbx.exe.'));
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(executable, [kn5Path], { cwd: toolDir, windowsHide: true, shell: false });
    const timer = setTimeout(() => { if (!settled) child.kill(); }, 10 * 60 * 1000);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { settled = true; clearTimeout(timer); reject(error); });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((stderr || stdout || `Conversor finalizado con código ${code}.`).trim()));
      const matches = [...stdout.matchAll(/^OK:\s*(.+)$/gmi)];
      const outputDir = matches.length ? matches[matches.length - 1][1].trim() : null;
      if (!outputDir || !fs.existsSync(outputDir)) return reject(new Error('No se localizó la salida del conversor.'));
      resolve({ outputDir, log: stdout.trim() });
    });
  });
  const convertTemporary = async sourceKn5 => {
    if (!sourceKn5 || !fs.existsSync(sourceKn5) || !/\.kn5$/i.test(sourceKn5)) throw new Error('KN5 inexistente o inválido.');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
    activeTempRoots.add(tempRoot);
    const temporaryKn5 = path.join(tempRoot, path.basename(sourceKn5));
    try {
      await fs.promises.copyFile(sourceKn5, temporaryKn5);
      const result = await runConverter(temporaryKn5);
      const outputDir = path.resolve(result.outputDir);
      outputToTempRoot.set(outputDir, tempRoot);
      return { ...result, outputDir, temporary: true };
    } catch (error) {
      removeTempRoot(tempRoot);
      throw error;
    }
  };
  const readOutput = root => {
    const files = [];
    const visit = current => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (OUTPUT_EXTENSIONS.test(entry.name)) {
          const ext = path.extname(entry.name).toLowerCase();
          files.push({
            name: entry.name,
            relativePath: path.relative(root, fullPath).split(path.sep).join('/'),
            mime: ext === '.ini' ? 'text/plain' : ext === '.png' ? 'image/png' : /\.jpe?g/.test(ext) ? 'image/jpeg' : 'application/octet-stream',
            data: fs.readFileSync(fullPath)
          });
        }
      }
    };
    visit(root);
    return files;
  };

  ipcMain.handle('kn5:select-file', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Assetto Corsa KN5', extensions: ['kn5'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('kn5:select-root', async () => {
    const result = await dialog.showOpenDialog({ title: 'Seleccionar raíz de Assetto Corsa', defaultPath: findAssettoRoot() || undefined, properties: ['openDirectory'] });
    if (result.canceled) return null;
    const root = normalizeAssettoRoot(result.filePaths[0]);
    if (!root) throw new Error('Selecciona la raíz de Assetto Corsa, content o content\\cars.');
    writeSettings({ ...readSettings(), acRoot: root });
    return root;
  });
  ipcMain.handle('kn5:list-cars', async () => {
    const root = findAssettoRoot();
    if (!root) return { root: null, cars: [] };
    const settings = readSettings();
    if (settings.acRoot !== root) writeSettings({ ...settings, acRoot: root });
    const carsList = listCars(root);
    // Include preview as base64 directly in the response
    for (const car of carsList) {
      if (car.previewPath && fs.existsSync(car.previewPath)) {
        try {
          const buf = fs.readFileSync(car.previewPath);
          const ext = car.previewPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
          car.preview = `data:image/${ext};base64,${buf.toString('base64')}`;
        } catch (_) { car.preview = null; }
      } else {
        car.preview = null;
      }
    }
    return { root, cars: carsList };
  });
  // Load previews in batches to avoid overwhelming IPC
  ipcMain.handle('kn5:get-previews', async (_event, previewPaths) => {
    const results = {};
    for (const p of previewPaths) {
      if (!p || !fs.existsSync(p)) continue;
      try {
        const data = fs.readFileSync(p);
        const ext = p.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
        results[p] = `data:image/${ext};base64,${data.toString('base64')}`;
      } catch (_) {}
    }
    return results;
  });
  ipcMain.handle('kn5:convert', async (_event, kn5Path) => convertTemporary(kn5Path));
  ipcMain.handle('kn5:get-preview', async (_event, previewPath) => {
    if (!previewPath || !fs.existsSync(previewPath)) return null;
    try {
      const data = fs.readFileSync(previewPath);
      const ext = previewPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      return `data:image/${ext};base64,${data.toString('base64')}`;
    } catch (_) { return null; }
  });
  ipcMain.handle('kn5:read-output', async (_event, outputDir) => {
    const normalized = outputDir && path.resolve(outputDir);
    const tempRoot = normalized && outputToTempRoot.get(normalized);
    if (!tempRoot || !fs.existsSync(normalized)) throw new Error('La salida temporal ya no existe.');
    try { return readOutput(normalized); }
    finally { removeTempRoot(tempRoot); }
  });

  app.whenReady().then(cleanupOldTempRoots);
  app.on('before-quit', () => { for (const root of [...activeTempRoots]) removeTempRoot(root); });
  return { settingsPath, cleanup: () => { for (const root of [...activeTempRoots]) removeTempRoot(root); } };
}

module.exports = { registerKn5Import };
