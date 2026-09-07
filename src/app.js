'use strict';

/* Bootstrap and the glue between the sidebar, the workspace and the canvas. */

const App = (() => {

  let saveStateTimer = null;

  /* ------------------------------------------------------------ chrome */

  function refreshTitle() {
    const t = document.getElementById('tbTitle');
    if (!WS.isOpen()) { t.textContent = ''; document.title = 'Kivrn'; return; }
    const node = Store.find(WS.getId());
    const name = node ? node.name : WS.getName();
    WS.setName(name);
    const path = Store.pathOf(WS.getId());
    t.textContent = path.length ? `${path.join(' / ')} / ${name}` : name;
    document.title = `${name} — Kivrn`;
  }

  function setSaveState(kind) {
    const el = document.getElementById('saveState');
    clearTimeout(saveStateTimer);
    if (kind === 'saving') { el.textContent = 'Saving…'; el.style.color = ''; }
    else if (kind === 'error') { el.textContent = 'Not saved'; el.style.color = 'var(--ink)'; }
    else {
      el.textContent = 'Saved';
      el.style.color = '';
      saveStateTimer = setTimeout(() => { el.textContent = ''; }, 1600);
    }
  }

  function updatePaperLabel() {
    const btn = document.getElementById('btnPaper');
    if (!btn) return;
    if (!WS.isOpen()) { btn.textContent = 'Paper'; return; }
    const bg = WS.getBackground();
    const def = Render.BACKGROUNDS.find((b) => b.id === bg.type);
    btn.textContent = def ? def.label : 'Paper';
  }

  function updateZoomLabel() {
    const z = WS.isOpen() ? WS.getCamera().zoom : 1;
    document.getElementById('btnZoomLevel').textContent = Math.round(z * 100) + '%';
  }

  function resizeCanvas() {
    Render.resize();
    Elements.syncTransforms();
  }

  function rebuildAll() {
    Elements.rebuild();
    Tools.clearSelection();
    Render.schedule();
    updateZoomLabel();
  }

  /* -------------------------------------------------------- workspaces */

  let opening = false;

  async function openWorkspace(id) {
    if (opening) return;
    const node = Store.find(id);
    if (!node || node.type !== 'workspace') { U.toast('That workspace no longer exists'); return; }
    opening = true;
    try {
      Tools.clearSelection();
      await WS.open(id, node.name);
      Store.setLastOpen(id);
      Tree.setActive(id);
      document.getElementById('emptyState').classList.add('hidden');
      refreshTitle();
      Elements.rebuild();
      Render.schedule();
      updateZoomLabel();
      updatePaperLabel();
      Tools.renderProps();
    } finally {
      opening = false;
    }
  }

  async function onNodesDeleted(removedIds) {
    if (WS.isOpen() && removedIds.includes(WS.getId())) {
      await WS.close();
      Elements.rebuild();
      Render.schedule();
      showEmptyState();
      refreshTitle();
      Tree.setActive(null);
      Tools.renderProps();
    } else if (WS.isOpen()) {
      // A link on this board may now point at nothing.
      Elements.rebuild();
    }
  }

  function showEmptyState() {
    document.getElementById('emptyState').classList.remove('hidden');
  }

  /* Adds a link card on the current board pointing at `targetId`. */
  function copyLinkTarget(targetId) {
    if (!WS.isOpen()) { U.toast('Open a workspace first'); return; }
    if (targetId === WS.getId()) { U.toast('That is the workspace you are on'); return; }
    const node = Store.find(targetId);
    if (!node) return;
    const cam = WS.getCamera();
    const item = Tools.newLinkItem(cam.x - 125, cam.y - 28, targetId, node.name);
    WS.commit();
    WS.add(item);
    Elements.addNode(item);
    Tools.setTool('select');
    Tools.selectOnly(item.id);
    U.toast(`Link to "${node.name}" added`);
  }

  /* -------------------------------------------------------- navigation */

  function fitToContent() {
    if (!WS.isOpen()) return;
    const sel = Tools.getSelection();
    const b = sel.size ? Tools.selectionBounds() : WS.contentBounds();
    if (!b || b.w <= 0 && b.h <= 0) { goHome(); return; }
    const { w, h } = Render.getSize();
    const pad = 90;
    const zoom = U.clamp(Math.min((w - pad) / Math.max(b.w, 1), (h - pad) / Math.max(b.h, 1)), 0.05, 2.5);
    const cam = WS.getCamera();
    cam.zoom = zoom;
    cam.x = b.x + b.w / 2;
    cam.y = b.y + b.h / 2;
    WS.markCameraDirty();
    Render.schedule();
    updateZoomLabel();
  }

  function goHome() {
    if (!WS.isOpen()) return;
    const cam = WS.getCamera();
    cam.x = 0; cam.y = 0; cam.zoom = 1;
    WS.markCameraDirty();
    Render.schedule();
    updateZoomLabel();
  }

  function resetZoom() {
    if (!WS.isOpen()) return;
    const { w, h } = Render.getSize();
    Tools.zoomAt(w / 2, h / 2, 1 / WS.getCamera().zoom);
  }

  /* ------------------------------------------------------------ export */

  async function exportPng() {
    if (!WS.isOpen()) return;
    const b = WS.contentBounds();
    if (!b) { U.toast('Nothing to export yet'); return; }
    U.toast('Rendering…', 1200);
    await new Promise((r) => requestAnimationFrame(r));
    let dataUrl = null;
    try { dataUrl = Render.exportPNG(); }
    catch (err) { console.error('export failed', err); }
    if (!dataUrl) { U.toast('Export failed'); return; }
    try {
      const saved = await window.api.exportPng(dataUrl, WS.getName());
      if (saved) U.toast('Exported');
    } catch (err) {
      console.error('export save failed', err);
      U.toast('Could not write the PNG');
    }
  }

  /* --------------------------------------------------------- shortcuts */

  const SHORTCUTS = [
    ['Tools', null],
    ['V / H', 'Select / pan'],
    ['P / M / E', 'Draw, highlight, erase'],
    ['E then Partial/Whole', 'Rub out part of a stroke, or all of it'],
    ['R / F', 'Shapes, fill a shape'],
    ['T / K', 'Text box, checklist'],
    ['I / L', 'Image, workspace link'],
    ['Canvas', null],
    ['Space + drag', 'Pan (also middle-mouse drag)'],
    ['Wheel', 'Zoom about the cursor'],
    ['Shift + Wheel', 'Nudge sideways'],
    ['Ctrl + 0', 'Zoom to 100%'],
    ['Shift + 1', 'Fit everything on screen'],
    ['Home', 'Jump back to the centre'],
    ['G', 'Cycle the workspace background'],
    ['Selection', null],
    ['Click / Shift+Click', 'Select / add to selection'],
    ['Drag on empty space', 'Rubber-band select'],
    ['Alt + drag', 'Move an item from anywhere on it'],
    ['Arrows / Shift+Arrows', 'Nudge by 1 / 20'],
    ['[ and ]', 'Send to back / bring to front'],
    ['Ctrl + D', 'Duplicate'],
    ['Ctrl + C / X / V', 'Copy, cut, paste'],
    ['Delete', 'Delete selection'],
    ['Workspace', null],
    ['Ctrl + N', 'New workspace'],
    ['Ctrl + Shift + N', 'New folder'],
    ['Ctrl + Z / Ctrl + Y', 'Undo / redo'],
    ['F2', 'Rename in the sidebar'],
    ['Ctrl + E', 'Export as PNG']
  ];

  function showShortcuts() {
    U.openModal((box) => {
      box.appendChild(U.el('h3', { text: 'Keyboard shortcuts' }));
      const grid = U.el('div', { class: 'keys' });
      for (const [a, b] of SHORTCUTS) {
        if (b === null) { grid.appendChild(U.el('h4', { text: a })); continue; }
        grid.appendChild(U.el('span', { class: 'kk' }, a.split(/(\s*[+/]\s*)/).map((part) =>
          /^[\s+/]*$/.test(part) ? document.createTextNode(part) : U.el('kbd', { text: part })
        )));
        grid.appendChild(U.el('span', { class: 'kd', text: b }));
      }
      box.appendChild(grid);
      box.appendChild(U.el('div', { class: 'actions' }, [
        U.el('button', { class: 'btn primary', text: 'Close', onclick: U.closeModal })
      ]));
    });
  }

  /* --------------------------------------------------------- app keys */

  function onKeyDown(e) {
    // A modal owns the keyboard while it is up.
    if (!document.getElementById('modalBack').classList.contains('hidden')) return;
    const mod = e.ctrlKey || e.metaKey;
    const inField = e.target && (e.target.tagName === 'INPUT' || e.target.isContentEditable);

    if (mod && e.key.toLowerCase() === 'z' && !inField) {
      e.preventDefault();
      if (e.shiftKey) { if (!WS.redo()) U.toast('Nothing to redo'); }
      else if (!WS.undo()) U.toast('Nothing to undo');
      return;
    }
    if (mod && e.key.toLowerCase() === 'y' && !inField) {
      e.preventDefault();
      if (!WS.redo()) U.toast('Nothing to redo');
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); Tree.newFolder(null); return; }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); Tree.newWorkspace(null); return; }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); void exportPng(); return; }
    if (mod && (e.key === '0')) { e.preventDefault(); resetZoom(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); Tools.zoomBy(1.2); return; }
    if (mod && e.key === '-') { e.preventDefault(); Tools.zoomBy(1 / 1.2); return; }
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      document.getElementById('searchInput').focus();
      document.getElementById('searchInput').select();
      return;
    }
    if (inField) return;

    if (e.key === '!' || (e.shiftKey && e.key === '1')) { e.preventDefault(); fitToContent(); return; }
    if (e.key === 'Home') { e.preventDefault(); goHome(); return; }
    if (e.key === '?') { e.preventDefault(); showShortcuts(); return; }
    if (Tree.handleKey(e)) { e.preventDefault(); return; }
  }

  /* ------------------------------------------------------------- init */

  async function init() {
    await Store.load();

    Tree.init({ onOpen: openWorkspace, onDeleted: onNodesDeleted });
    Tools.init();
    Render.resize();

    addEventListener('resize', resizeCanvas);
    addEventListener('keydown', onKeyDown);

    document.getElementById('btnZoomIn').addEventListener('click', () => Tools.zoomBy(1.2));
    document.getElementById('btnZoomOut').addEventListener('click', () => Tools.zoomBy(1 / 1.2));
    document.getElementById('btnZoomLevel').addEventListener('click', resetZoom);
    document.getElementById('btnFit').addEventListener('click', fitToContent);
    document.getElementById('btnHome').addEventListener('click', goHome);
    document.getElementById('btnExport').addEventListener('click', () => void exportPng());
    document.getElementById('btnPaper').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      Tools.openPaperMenu(r.left, r.top - 8);
    });
    document.getElementById('btnHelp').addEventListener('click', showShortcuts);
    document.getElementById('btnRevealData').addEventListener('click', () => window.api.revealData());

    // Flush pending writes when the window loses focus or the app is closing.
    addEventListener('blur', () => { void WS.saveNow(); Store.flush(); });
    addEventListener('beforeunload', () => { void WS.saveNow(); Store.flush(); });
    window.api.onFlush(async () => {
      try { Store.flush(); await WS.saveNow(); }
      finally { window.api.flushed(); }
    });

    const lastOpen = Store.getTree().lastOpen;
    if (lastOpen && Store.find(lastOpen)) {
      await openWorkspace(lastOpen);
    } else {
      const first = Store.allWorkspaces()[0];
      if (first) await openWorkspace(first.id);
      else showEmptyState();
    }
    updateZoomLabel();
  }

  return {
    init, openWorkspace, refreshTitle, setSaveState, updateZoomLabel, updatePaperLabel,
    resizeCanvas, rebuildAll, copyLinkTarget, fitToContent, goHome,
    exportPng, showShortcuts, showEmptyState
  };
})();

window.addEventListener('DOMContentLoaded', () => {
  App.init().catch((err) => {
    console.error('startup failed', err);
    U.toast('Kivrn could not start - see the console for details', 8000);
  });
});
