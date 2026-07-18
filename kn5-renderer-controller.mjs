// onFilesReady(files, metadata) debe conectar con el importador de FBX/INI/texturas
// que ya tenga la aplicación. Este módulo no contiene lógica del Livery Editor.
export function createKn5ImportController({ api = window.electronAPI, onFilesReady, onStatus = () => {} }) {
  const panel = document.getElementById('kn5-import-panel');
  if (!api) {
    document.documentElement.classList.remove('electron-runtime');
    if (panel) panel.hidden = true;
    return { available: false };
  }
  document.documentElement.classList.add('electron-runtime');
  if (panel) panel.hidden = false;

  const search = document.getElementById('kn5-car-search');
  const carSelect = document.getElementById('kn5-car-select');
  const modelSelect = document.getElementById('kn5-model-select');
  const carGrid = document.getElementById('kn5-car-grid');
  const directButton = document.getElementById('kn5-select-file');
  const rootButton = document.getElementById('kn5-select-root');
  const importButton = document.getElementById('kn5-import');
  const statusElement = document.getElementById('kn5-status');
  let cars = [];
  let selectedPath = null;
  let selectedCarIndex = null;

  const status = (message, error = false) => {
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.classList.toggle('error', error);
    }
    onStatus(message, error);
  };
  const selectKn5 = (kn5Path, label) => {
    selectedPath = kn5Path;
    importButton.disabled = false;
    importButton.style.opacity = '1';
    status(`Selected: ${label || kn5Path}`);
  };

  // ── Car Grid Rendering ──────────────────────────────────────────
  const renderCarGrid = (query) => {
    if (!carGrid) return;
    const normalized = (query || '').trim().toLocaleLowerCase();
    const matches = cars.map((car, index) => ({ car, index })).filter(({ car }) => {
      const text = [car.name, car.id, car.brand, ...car.kn5.map(item => item.name)].join(' ').toLocaleLowerCase();
      return !normalized || text.includes(normalized);
    });

    carGrid.innerHTML = '';

    if (!matches.length) {
      carGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--txt3);font-size:11px;padding:20px;">No cars found</div>';
      return;
    }

    for (const { car, index } of matches) {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--panel2);border:1px solid var(--border);border-radius:6px;cursor:pointer;overflow:hidden;transition:border-color .15s,transform .1s;';
      card.dataset.carIndex = index;

      card.innerHTML = `
        <div class="kn5-card-img" style="width:100%;height:120px;background:var(--bg2);display:flex;align-items:center;justify-content:center;overflow:hidden;">
          <span style="font-size:24px;opacity:.3;">🏎️</span>
        </div>
        <div style="padding:4px 6px;">
          <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:9px;color:var(--txt);letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;" title="${car.name}">${car.name}</div>
          <div style="font-size:8px;color:var(--txt3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;">${car.brand || car.id}</div>
        </div>
      `;

      card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--gold)'; card.style.transform = 'scale(1.02)'; });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = selectedCarIndex === index ? 'var(--accent2)' : 'var(--border)';
        card.style.transform = '';
      });

      card.addEventListener('click', () => {
        selectedCarIndex = index;
        // Highlight selected card
        carGrid.querySelectorAll('div[data-car-index]').forEach(c => c.style.borderColor = 'var(--border)');
        card.style.borderColor = 'var(--accent2)';

        // Populate model select
        modelSelect.replaceChildren(new Option('Select KN5 model', ''));
        car.kn5.forEach((model, mi) => modelSelect.appendChild(new Option(model.name, String(mi))));
        modelSelect.disabled = !car.kn5.length;

        if (car.kn5.length === 1) {
          modelSelect.value = '0';
          selectKn5(car.kn5[0].path, `${car.name} — ${car.kn5[0].name}`);
        }
      });

      carGrid.appendChild(card);

      // Use inline preview from listCars response (no extra IPC needed)
      if (car.preview) {
        const imgContainer = card.querySelector('.kn5-card-img');
        if (imgContainer) imgContainer.innerHTML = `<img src="${car.preview}" style="width:100%;height:100%;object-fit:cover;">`;
      }
    }
  };

  const renderCars = query => {
    const normalized = (query || '').trim().toLocaleLowerCase();
    const matches = cars.map((car, index) => ({ car, index })).filter(({ car }) => {
      const text = [car.name, car.id, ...car.kn5.map(item => item.name)].join(' ').toLocaleLowerCase();
      return !normalized || text.includes(normalized);
    });
    // Keep hidden select in sync for compatibility
    if (carSelect) {
      carSelect.replaceChildren();
      const placeholder = new Option(`${matches.length} cars`, '');
      carSelect.appendChild(placeholder);
      for (const { car, index } of matches) carSelect.appendChild(new Option(`${car.name} — ${car.id}`, String(index)));
    }
    // Render visual grid
    renderCarGrid(query);
  };

  const loadCars = async () => {
    status('Indexing content/cars...');
    try {
      const result = await api.listAssettoCars();
      cars = result.cars || [];
      renderCars(search ? search.value : '');
      status(result.root ? `AC root: ${result.root}` : 'Select Assetto Corsa root folder.', !result.root);
      // Load previews in batches after grid is rendered
      loadPreviewsBatched();
    } catch (error) { status(error.message || String(error), true); }
  };

  const loadPreviewsBatched = async () => {
    if (!api.getCarPreviews) return;
    const BATCH_SIZE = 12;
    const carsWithPreviews = cars.filter(c => c.previewPath);
    for (let i = 0; i < carsWithPreviews.length; i += BATCH_SIZE) {
      const batch = carsWithPreviews.slice(i, i + BATCH_SIZE);
      const paths = batch.map(c => c.previewPath);
      try {
        const results = await api.getCarPreviews(paths);
        for (const car of batch) {
          if (results[car.previewPath]) {
            car.preview = results[car.previewPath];
            // Update the card in the grid
            const card = carGrid.querySelector(`div[data-car-index="${cars.indexOf(car)}"]`);
            if (card) {
              const imgContainer = card.querySelector('.kn5-card-img');
              if (imgContainer) imgContainer.innerHTML = `<img src="${car.preview}" style="width:100%;height:100%;object-fit:cover;">`;
            }
          }
        }
      } catch (_) {}
    }
  };

  const entriesToFiles = entries => entries.map(entry => {
    const raw = entry.data?.data || entry.data;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const file = new File([bytes], entry.name, { type: entry.mime });
    Object.defineProperty(file, 'webkitRelativePath', { value: `converted/${entry.relativePath}`, configurable: true });
    return file;
  });

  directButton.addEventListener('click', async () => {
    try {
      const selected = await api.selectKn5File();
      if (selected) selectKn5(selected, selected.split(/[\\/]/).pop());
    } catch (error) { status(error.message || String(error), true); }
  });
  rootButton.addEventListener('click', async () => {
    try { if (await api.selectAssettoRoot()) await loadCars(); }
    catch (error) { status(error.message || String(error), true); }
  });
  if (search) {
    search.addEventListener('input', () => {
      renderCars(search.value);
      modelSelect.replaceChildren(new Option('KN5 Model', ''));
      modelSelect.disabled = true;
    });
  }
  modelSelect.addEventListener('change', () => {
    if (selectedCarIndex === null) return;
    const car = cars[selectedCarIndex];
    const model = modelSelect.value === '' ? null : car?.kn5?.[Number(modelSelect.value)];
    if (model) selectKn5(model.path, `${car.name} — ${model.name}`);
  });
  importButton.addEventListener('click', async () => {
    if (!selectedPath) return;
    importButton.disabled = true;
    const errorBox = document.getElementById('kn5-error-box');
    if (errorBox) errorBox.style.display = 'none';
    status('Converting KN5...');
    try {
      const converted = await api.convertKn5(selectedPath);
      const entries = await api.readConvertedFolder(converted.outputDir);
      const files = entriesToFiles(entries);
      if (!files.some(file => /\.fbx$/i.test(file.name))) throw new Error('Conversion did not produce any FBX.');
      await onFilesReady(files, { sourceKn5: selectedPath, temporary: true });
      status('KN5 converted and loaded. Temporary files cleaned.');
    } catch (error) {
      status(error.message || String(error), true);
      if (errorBox) errorBox.style.display = 'block';
    }
    finally { importButton.disabled = false; }
  });

  loadCars();
  return { available: true, reloadCars: loadCars, getSelectedPath: () => selectedPath };
}
