'use strict';

/* The open workspace document: items, camera, undo history, autosave. */

const WS = (() => {

  const HISTORY_LIMIT = 80;

  let id = null;
  let name = '';
  let items = [];
  let camera = { x: 0, y: 0, zoom: 1 };
  let background = { type: 'dots', size: 40 };   // per-workspace paper

  let undoStack = [];
  let redoStack = [];
  let savedSnapshot = '';       // items JSON as last written to disk
  let loading = false;

  /* ----------------------------------------------------------- access */

  const isOpen = () => id !== null;
  const getId = () => id;
  const getName = () => name;
  const getItems = () => items;
  const getCamera = () => camera;
  const getBackground = () => background;
  function setBackground(patch) {
    background = { ...background, ...patch };
    markDirty();
    Render.schedule();
  }
  const getItem = (itemId) => items.find((i) => i.id === itemId) || null;
  const indexOf = (itemId) => items.findIndex((i) => i.id === itemId);

  function setName(v) { name = v; }

  /* ------------------------------------------------------------ bounds */

  /* World-space bounding box of an item, including stroke width. */
  function bounds(item) {
    switch (item.type) {
      case 'stroke': {
        const pts = item.points;
        if (!pts.length) return { x: item.x || 0, y: item.y || 0, w: 0, h: 0 };
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          const px = pts[i], py = pts[i + 1];
          if (px < x0) x0 = px;
          if (py < y0) y0 = py;
          if (px > x1) x1 = px;
          if (py > y1) y1 = py;
        }
        const pad = (item.width || 2) / 2 + 1;
        return { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + pad * 2, h: (y1 - y0) + pad * 2 };
      }
      case 'shape': {
        const pad = (item.width || 2) / 2 + 1;
        return { x: item.x - pad, y: item.y - pad, w: item.w + pad * 2, h: item.h + pad * 2 };
      }
      default:
        return { x: item.x, y: item.y, w: item.w, h: item.h || 0 };
    }
  }

  function contentBounds(ids = null) {
    const list = ids ? items.filter((i) => ids.has(i.id)) : items;
    return U.unionRects(list.map(bounds));
  }

  /* --------------------------------------------------------- mutation */

  function add(item) {
    items.push(item);
    markDirty();
    return item;
  }

  function addMany(list) {
    items.push(...list);
    markDirty();
  }

  function removeIds(ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    const before = items.length;
    items = items.filter((i) => !set.has(i.id));
    if (items.length !== before) markDirty();
  }

  /* Swap one item for zero or more replacements, keeping its place in the
     z-order. Used by the partial eraser when it cuts a stroke into pieces. */
  function replaceItem(itemId, replacements) {
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx < 0) return false;
    items.splice(idx, 1, ...replacements);
    markDirty();
    return true;
  }

  function bringToFront(ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    const moved = items.filter((i) => set.has(i.id));
    if (!moved.length) return;
    items = items.filter((i) => !set.has(i.id)).concat(moved);
    markDirty();
  }

  function sendToBack(ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    const moved = items.filter((i) => set.has(i.id));
    if (!moved.length) return;
    items = moved.concat(items.filter((i) => !set.has(i.id)));
    markDirty();
  }

  /* ---------------------------------------------------------- history */

  const snapshot = () => JSON.stringify(items);

  /* Call BEFORE a change you want to be undoable. */
  function commit() {
    if (loading || !isOpen()) return;
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function restore(json) {
    items = JSON.parse(json);
    markDirty();
    App.rebuildAll();
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    return true;
  }

  const canUndo = () => undoStack.length > 0;
  const canRedo = () => redoStack.length > 0;

  /* ------------------------------------------------------ persistence */

  let dirty = false;
  let saving = false;

  function markDirty() {
    if (!isOpen() || loading) return;
    dirty = true;
    App.setSaveState('saving');
    autosave();
  }

  const autosave = U.debounce(() => { void flushSave(); }, 550);

  async function flushSave() {
    if (!isOpen() || !dirty || saving) return;
    saving = true;
    const payload = {
      version: 1,
      id,
      name,
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
      background: { type: background.type, size: background.size },
      items
    };
    const snap = snapshot();
    try {
      await window.api.saveWorkspace(id, payload);
      savedSnapshot = snap;
      dirty = false;
      App.setSaveState('saved');
    } catch (err) {
      console.error('workspace save failed', err);
      App.setSaveState('error');
      U.toast('Could not save this workspace');
    } finally {
      saving = false;
    }
  }

  /* Force a write right now (used on close / app exit / switching workspace). */
  async function saveNow() {
    autosave.flush();
    if (dirty) await flushSave();
  }

  /* Camera changes are persisted, but they are not undoable and not urgent. */
  const cameraSave = U.debounce(() => { dirty = true; void flushSave(); }, 900);
  function markCameraDirty() {
    if (!isOpen() || loading) return;
    cameraSave();
  }

  /* Drops anything malformed rather than letting one bad item kill the board. */
  function sanitizeItems(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
    for (const it of raw) {
      if (!it || typeof it !== 'object' || typeof it.type !== 'string') continue;
      const base = { id: typeof it.id === 'string' ? it.id : U.uid('i'), type: it.type };
      if (it.type === 'stroke') {
        if (!Array.isArray(it.points) || it.points.length < 2) continue;
        out.push({
          ...base,
          tool: it.tool === 'highlighter' ? 'highlighter' : 'pen',
          color: typeof it.color === 'string' ? it.color : '#ffffff',
          width: U.clamp(num(it.width, 3), 0.5, 200),
          points: it.points.map((n) => num(n))
        });
      } else if (it.type === 'shape') {
        out.push({
          ...base,
          shape: ['rect', 'ellipse', 'diamond', 'line', 'arrow'].includes(it.shape) ? it.shape : 'rect',
          x: num(it.x), y: num(it.y), w: num(it.w, 10), h: num(it.h, 10),
          color: typeof it.color === 'string' ? it.color : '#ffffff',
          width: U.clamp(num(it.width, 2), 0.5, 200),
          fill: typeof it.fill === 'string' ? it.fill : null,
          radius: num(it.radius, 8)
        });
      } else if (it.type === 'text') {
        out.push({
          ...base,
          x: num(it.x), y: num(it.y), w: U.clamp(num(it.w, 260), 40, 6000), h: num(it.h, 40),
          text: typeof it.text === 'string' ? it.text : '',
          color: typeof it.color === 'string' ? it.color : '#ffffff',
          size: U.clamp(num(it.size, 18), 6, 400),
          bold: !!it.bold,
          boxed: it.boxed !== false
        });
      } else if (it.type === 'todo') {
        out.push({
          ...base,
          x: num(it.x), y: num(it.y), w: U.clamp(num(it.w, 280), 120, 3000), h: num(it.h, 120),
          title: typeof it.title === 'string' ? it.title : '',
          color: typeof it.color === 'string' ? it.color : '#ffffff',
          size: U.clamp(num(it.size, 15), 8, 90),
          entries: Array.isArray(it.entries)
            ? it.entries.filter((e) => e && typeof e === 'object').map((e) => ({
              id: typeof e.id === 'string' ? e.id : U.uid('t'),
              text: typeof e.text === 'string' ? e.text : '',
              done: !!e.done
            }))
            : []
        });
      } else if (it.type === 'image') {
        if (typeof it.src !== 'string' || !it.src.startsWith('data:image/')) continue;
        out.push({
          ...base,
          x: num(it.x), y: num(it.y), w: num(it.w, 200), h: num(it.h, 150),
          src: it.src, natW: num(it.natW, 0), natH: num(it.natH, 0),
          alt: typeof it.alt === 'string' ? it.alt : ''
        });
      } else if (it.type === 'link') {
        out.push({
          ...base,
          x: num(it.x), y: num(it.y), w: U.clamp(num(it.w, 230), 100, 2000), h: num(it.h, 52),
          target: typeof it.target === 'string' ? it.target : '',
          label: typeof it.label === 'string' ? it.label : '',
          size: U.clamp(num(it.size, 14), 8, 90)
        });
      }
    }
    return out;
  }

  async function open(wsId, wsName) {
    await saveNow();
    loading = true;
    id = wsId;
    name = wsName;
    undoStack = [];
    redoStack = [];
    dirty = false;

    let data = null;
    try { data = await window.api.loadWorkspace(wsId); }
    catch (err) { console.error('workspace load failed', err); }

    items = sanitizeItems(data && data.items);
    const cam = data && data.camera;
    camera = {
      x: cam && isFinite(cam.x) ? cam.x : 0,
      y: cam && isFinite(cam.y) ? cam.y : 0,
      zoom: cam && isFinite(cam.zoom) ? U.clamp(cam.zoom, 0.05, 8) : 1
    };
    const bg = data && data.background;
    const BG_TYPES = ['dots', 'grid', 'lines', 'columns', 'graph', 'plain'];
    background = {
      type: bg && BG_TYPES.includes(bg.type) ? bg.type : 'dots',
      size: bg && isFinite(bg.size) ? U.clamp(bg.size, 8, 400) : 40
    };

    savedSnapshot = snapshot();
    loading = false;
    return true;
  }

  async function close() {
    await saveNow();
    id = null;
    name = '';
    items = [];
    undoStack = [];
    redoStack = [];
    camera = { x: 0, y: 0, zoom: 1 };
    background = { type: 'dots', size: 40 };
  }

  return {
    isOpen, getId, getName, setName, getItems, getItem, indexOf, getCamera,
    getBackground, setBackground,
    bounds, contentBounds,
    add, addMany, removeIds, replaceItem, bringToFront, sendToBack,
    commit, undo, redo, canUndo, canRedo,
    markDirty, markCameraDirty, saveNow, open, close
  };
})();
