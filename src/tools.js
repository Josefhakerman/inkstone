'use strict';

/* Tools, the toolbar / properties panel, selection, and all canvas pointer work. */

const Tools = (() => {

  /* ------------------------------------------------------------- state */

  const PALETTE = ['#ffffff', '#c9d1d9', '#ff6b6b', '#ffa94d', '#ffd43b',
                   '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];
  const HL_PALETTE = ['#ffd43b', '#ffa94d', '#ff6b6b', '#69db7c', '#4dabf7', '#da77f2'];
  const FILL_PALETTE = [null, '#ffffff', '#ff6b6b', '#ffa94d', '#ffd43b',
                        '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];

  const DEFAULTS = {
    tool: 'select',
    shape: 'rect',
    penColor: '#ffffff', penWidth: 3,
    hlColor: '#ffd43b', hlWidth: 22,
    eraserSize: 26, eraserMode: 'part',
    shapeColor: '#ffffff', shapeWidth: 2, shapeFill: null,
    textColor: '#ffffff', textSize: 18, textBold: false,
    todoColor: '#ffffff', todoSize: 15,
    fillColor: '#ffffff'
  };

  let state = { ...DEFAULTS };

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem('toolState') || '{}');
      state = { ...DEFAULTS, ...raw, tool: 'select' };
    } catch (_) { state = { ...DEFAULTS }; }
  }
  const saveState = U.debounce(() => {
    try { localStorage.setItem('toolState', JSON.stringify(state)); } catch (_) {}
  }, 400);

  /* --------------------------------------------------------- selection */

  let selection = new Set();
  let clipboard = [];

  const getSelection = () => selection;
  const isSelected = (id) => selection.has(id);

  function selectOnly(id, { keepFocus = false } = {}) {
    selection = new Set(id ? [id] : []);
    if (!keepFocus) Elements.blurEditing();
    afterSelectionChange();
  }
  function selectMany(ids) {
    selection = new Set(ids);
    afterSelectionChange();
  }
  function toggleSelect(id) {
    if (selection.has(id)) selection.delete(id); else selection.add(id);
    afterSelectionChange();
  }
  function deselect(id) {
    selection.delete(id);
    afterSelectionChange();
  }
  function clearSelection() {
    if (!selection.size) return;
    selection.clear();
    afterSelectionChange();
  }
  function afterSelectionChange() {
    // Drop ids for items that no longer exist.
    for (const id of [...selection]) if (!WS.getItem(id)) selection.delete(id);
    Elements.syncTransforms();
    Render.schedule();
    renderProps();
  }

  function selectionItems() {
    return [...selection].map((id) => WS.getItem(id)).filter(Boolean);
  }

  function selectionBounds() {
    const items = selectionItems();
    if (!items.length) return null;
    return U.unionRects(items.map(WS.bounds));
  }

  const canResizeSelection = () => selection.size === 1;

  /* ------------------------------------------------------- hit testing */

  /* Canvas-drawn items only; DOM items handle their own pointer events. */
  function hitTest(wx, wy) {
    const zoom = WS.getCamera().zoom;
    const tol = 6 / zoom;
    const items = WS.getItems();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'stroke') {
        const half = it.width / 2 + tol;
        const p = it.points;
        for (let k = 0; k + 3 < p.length; k += 2) {
          if (U.distToSegment(wx, wy, p[k], p[k + 1], p[k + 2], p[k + 3]) <= half) return it;
        }
        if (p.length === 2 && U.dist(wx, wy, p[0], p[1]) <= half) return it;
      } else if (it.type === 'shape') {
        if (hitShape(it, wx, wy, tol)) return it;
      } else if (it.type === 'image') {
        if (U.pointInRect(wx, wy, it)) return it;
      }
    }
    return null;
  }

  function hitShape(it, wx, wy, tol) {
    const half = it.width / 2 + tol;
    const { x, y, w, h } = it;
    if (it.shape === 'line' || it.shape === 'arrow') {
      return U.distToSegment(wx, wy, x, y, x + w, y + h) <= half;
    }
    const inside = wx >= x - half && wx <= x + w + half && wy >= y - half && wy <= y + h + half;
    if (!inside) return false;
    if (it.fill) {
      // Filled shapes are solid targets.
      if (it.shape === 'ellipse') {
        const nx = (wx - (x + w / 2)) / (Math.abs(w / 2) + half);
        const ny = (wy - (y + h / 2)) / (Math.abs(h / 2) + half);
        return nx * nx + ny * ny <= 1;
      }
      if (it.shape === 'diamond') {
        const nx = Math.abs(wx - (x + w / 2)) / (Math.abs(w / 2) + half);
        const ny = Math.abs(wy - (y + h / 2)) / (Math.abs(h / 2) + half);
        return nx + ny <= 1;
      }
      return true;
    }
    // Unfilled: only the outline counts.
    const innerX = wx >= x + half && wx <= x + w - half;
    const innerY = wy >= y + half && wy <= y + h - half;
    if (it.shape === 'rect') return !(innerX && innerY);
    if (it.shape === 'ellipse') {
      const rx = Math.abs(w / 2), ry = Math.abs(h / 2);
      if (rx < 1 || ry < 1) return true;
      const nx = (wx - (x + w / 2)) / rx, ny = (wy - (y + h / 2)) / ry;
      const d = Math.sqrt(nx * nx + ny * ny);
      return Math.abs(d - 1) * Math.min(rx, ry) <= half;
    }
    if (it.shape === 'diamond') {
      const rx = Math.abs(w / 2), ry = Math.abs(h / 2);
      if (rx < 1 || ry < 1) return true;
      const nx = Math.abs(wx - (x + w / 2)) / rx, ny = Math.abs(wy - (y + h / 2)) / ry;
      return Math.abs(nx + ny - 1) * Math.min(rx, ry) <= half;
    }
    return false;
  }

  /* Which canvas items fall inside a marquee. */
  function itemsInRect(rect) {
    const out = [];
    for (const it of WS.getItems()) {
      const b = WS.bounds(it);
      if (U.rectContains(rect, b) || (U.rectsOverlap(rect, b) && it.type !== 'stroke')) out.push(it.id);
      else if (it.type === 'stroke' && U.rectsOverlap(rect, b)) {
        const p = it.points;
        for (let k = 0; k < p.length; k += 2) {
          if (U.pointInRect(p[k], p[k + 1], rect)) { out.push(it.id); break; }
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------- item moving */

  function translateItem(item, dx, dy) {
    if (item.type === 'stroke') {
      const p = item.points;
      for (let i = 0; i < p.length; i += 2) { p[i] += dx; p[i + 1] += dy; }
    } else {
      item.x += dx;
      item.y += dy;
    }
  }

  /* Scale an item from `origin` by (kx,ky). Used by the resize handles. */
  function scaleItem(item, origin, kx, ky) {
    if (item.type === 'stroke') {
      const p = item.points;
      for (let i = 0; i < p.length; i += 2) {
        p[i] = origin.x + (p[i] - origin.x) * kx;
        p[i + 1] = origin.y + (p[i + 1] - origin.y) * ky;
      }
      item.width = Math.max(0.5, item.width * (Math.abs(kx) + Math.abs(ky)) / 2);
    } else {
      item.x = origin.x + (item.x - origin.x) * kx;
      item.y = origin.y + (item.y - origin.y) * ky;
      item.w *= kx;
      if (item.type === 'shape' || item.type === 'image') item.h *= ky;
    }
  }

  /* ------------------------------------------------------- item factory */

  function newTextItem(wx, wy, w) {
    return {
      id: U.uid('i'), type: 'text',
      x: wx, y: wy, w: w || 280, h: 44,
      text: '', color: state.textColor, size: state.textSize, bold: state.textBold
    };
  }

  function newTodoItem(wx, wy) {
    return {
      id: U.uid('i'), type: 'todo',
      x: wx, y: wy, w: 300, h: 140,
      title: '', color: state.todoColor, size: state.todoSize,
      entries: [{ id: U.uid('t'), text: '', done: false }]
    };
  }

  function newLinkItem(wx, wy, targetId, label) {
    return {
      id: U.uid('i'), type: 'link',
      x: wx, y: wy, w: 250, h: 56,
      target: targetId, label: label || '', size: 14
    };
  }

  /* --------------------------------------------------------- gestures */

  const vp = () => document.getElementById('viewport');

  let gesture = null;        // { kind, ... }
  let spaceDown = false;
  let lastMouse = { x: 0, y: 0 };
  let hoverWorld = null;

  function pointerPos(e) {
    const r = vp().getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function pointerWorld(e) {
    const [sx, sy] = pointerPos(e);
    return Render.screenToWorld(sx, sy);
  }

  function endGesture() {
    gesture = null;
    Render.setPreview(null);
    updateCursor();
  }

  /* ---- pan ---------------------------------------------------------- */

  function beginPan(e) {
    const cam = WS.getCamera();
    const [sx, sy] = pointerPos(e);
    gesture = { kind: 'pan', sx, sy, camX: cam.x, camY: cam.y };
    vp().style.cursor = 'grabbing';
  }

  function panTo(e) {
    const cam = WS.getCamera();
    const [sx, sy] = pointerPos(e);
    cam.x = gesture.camX - (sx - gesture.sx) / cam.zoom;
    cam.y = gesture.camY - (sy - gesture.sy) / cam.zoom;
    WS.markCameraDirty();
    Render.schedule();
  }

  /* ---- freehand ----------------------------------------------------- */

  function beginStroke(e, tool) {
    const [wx, wy] = pointerWorld(e);
    const color = tool === 'highlighter' ? state.hlColor : state.penColor;
    const width = tool === 'highlighter' ? state.hlWidth : state.penWidth;
    gesture = {
      kind: 'stroke',
      item: { id: U.uid('i'), type: 'stroke', tool, color, width, points: [wx, wy] }
    };
    Render.setPreview((c) => Render.drawStroke(c, gesture.item));
  }

  function extendStroke(e) {
    const [wx, wy] = pointerWorld(e);
    const p = gesture.item.points;
    const n = p.length;
    const minStep = 1.6 / WS.getCamera().zoom;
    if (n >= 2 && U.dist(wx, wy, p[n - 2], p[n - 1]) < minStep) return;
    p.push(wx, wy);
    Render.schedule();
  }

  function finishStroke() {
    const item = gesture.item;
    if (item.points.length >= 2) {
      WS.commit();
      WS.add(item);
    }
    endGesture();
    Render.schedule();
  }

  /* ---- shapes ------------------------------------------------------- */

  function beginShape(e) {
    const [wx, wy] = pointerWorld(e);
    gesture = {
      kind: 'shape', ox: wx, oy: wy,
      item: {
        id: U.uid('i'), type: 'shape', shape: state.shape,
        x: wx, y: wy, w: 0, h: 0,
        color: state.shapeColor, width: state.shapeWidth,
        fill: state.shapeFill, radius: 8
      }
    };
    Render.setPreview((c) => Render.drawShape(c, gesture.item));
  }

  function extendShape(e) {
    const [wx0, wy0] = pointerWorld(e);
    let wx = wx0, wy = wy0;
    const it = gesture.item;
    const isLine = it.shape === 'line' || it.shape === 'arrow';
    if (e.shiftKey) {
      if (isLine) {
        // Snap to 45 degree increments.
        const dx = wx - gesture.ox, dy = wy - gesture.oy;
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        wx = gesture.ox + Math.cos(a) * len;
        wy = gesture.oy + Math.sin(a) * len;
      } else {
        const s = Math.max(Math.abs(wx - gesture.ox), Math.abs(wy - gesture.oy));
        wx = gesture.ox + Math.sign(wx - gesture.ox || 1) * s;
        wy = gesture.oy + Math.sign(wy - gesture.oy || 1) * s;
      }
    }
    if (isLine) {
      it.x = gesture.ox; it.y = gesture.oy;
      it.w = wx - gesture.ox; it.h = wy - gesture.oy;
    } else {
      const r = U.normRect(gesture.ox, gesture.oy, wx, wy);
      it.x = r.x; it.y = r.y; it.w = r.w; it.h = r.h;
    }
    Render.schedule();
  }

  function finishShape() {
    const it = gesture.item;
    const tiny = Math.abs(it.w) < 2 && Math.abs(it.h) < 2;
    endGesture();
    if (tiny) { Render.schedule(); return; }
    WS.commit();
    WS.add(it);
    setTool('select');
    selectOnly(it.id);
    Render.schedule();
  }

  /* ---- eraser ------------------------------------------------------- */

  function beginErase(e) {
    const [wx, wy] = pointerWorld(e);
    gesture = { kind: 'erase', committed: false, px: wx, py: wy };
    eraseAt(e);
  }

  /* Distance from a point to the path the eraser swept this frame. Using the
     whole segment (not just the current position) means a fast drag still
     cuts cleanly instead of leaving gaps between mouse samples. */
  const sweptDist = (x, y, g, wx, wy) => U.distToSegment(x, y, g.px, g.py, wx, wy);

  /* Splits one stroke around the eraser sweep, returning the surviving runs
     of points, or null when the stroke is untouched. */
  function cutStroke(item, g, wx, wy, r) {
    const p = item.points;
    const n = p.length / 2;
    if (n === 0) return null;

    const runs = [];
    let run = [];
    let cutAny = false;

    const feed = (x, y) => {
      if (sweptDist(x, y, g, wx, wy) <= r) {
        cutAny = true;
        if (run.length >= 4) runs.push(run);
        run = [];
      } else {
        run.push(x, y);
      }
    };

    feed(p[0], p[1]);
    for (let i = 1; i < n; i++) {
      const ax = p[(i - 1) * 2], ay = p[(i - 1) * 2 + 1];
      const bx = p[i * 2], by = p[i * 2 + 1];
      // Walk long segments in small steps so the eraser can bite mid-segment.
      const len = Math.hypot(bx - ax, by - ay);
      const steps = len > r / 2 ? Math.min(96, Math.ceil(len / (r / 2))) : 1;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        feed(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    if (run.length >= 4) runs.push(run);

    return cutAny ? runs : null;
  }

  function eraseAt(e) {
    const [wx, wy] = pointerWorld(e);
    const g = gesture;
    const r = state.eraserSize / 2;
    const partial = state.eraserMode === 'part';

    // Bounding box of the swept eraser disc, for cheap rejection.
    const sweep = {
      x: Math.min(g.px, wx) - r, y: Math.min(g.py, wy) - r,
      w: Math.abs(wx - g.px) + r * 2, h: Math.abs(wy - g.py) + r * 2
    };

    const doomed = [];
    const touch = () => { if (!g.committed) { WS.commit(); g.committed = true; } };

    for (const it of WS.getItems().slice()) {
      if (it.type !== 'stroke' && it.type !== 'shape') continue;
      if (!U.rectsOverlap(sweep, WS.bounds(it))) continue;

      if (it.type === 'shape') {
        // Shapes are not polylines, so both modes remove them whole.
        if (hitShape(it, wx, wy, r)) doomed.push(it.id);
        continue;
      }

      if (!partial) {
        const p = it.points;
        let hit = false;
        for (let k = 0; k + 3 < p.length && !hit; k += 2) {
          if (sweptDist(p[k], p[k + 1], g, wx, wy) <= r + it.width / 2) hit = true;
          else if (U.distToSegment(g.px, g.py, p[k], p[k + 1], p[k + 2], p[k + 3]) <= r + it.width / 2) hit = true;
        }
        if (!hit && p.length >= 2 && sweptDist(p[0], p[1], g, wx, wy) <= r + it.width / 2) hit = true;
        if (hit) doomed.push(it.id);
        continue;
      }

      const runs = cutStroke(it, g, wx, wy, r);
      if (!runs) continue;
      touch();
      const pieces = runs.map((pts) => ({
        id: U.uid('i'), type: 'stroke', tool: it.tool,
        color: it.color, width: it.width, points: pts
      }));
      WS.replaceItem(it.id, pieces);
      selection.delete(it.id);
    }

    if (doomed.length) {
      touch();
      WS.removeIds(doomed);
      for (const id of doomed) selection.delete(id);
    }

    g.px = wx;
    g.py = wy;
    Render.schedule();
  }

  /* ---- marquee ------------------------------------------------------ */

  function beginMarquee(e, additive) {
    const [wx, wy] = pointerWorld(e);
    gesture = { kind: 'marquee', ox: wx, oy: wy, rect: { x: wx, y: wy, w: 0, h: 0 }, additive, base: new Set(selection) };
    Render.setPreview((c) => Render.drawMarquee(c, gesture.rect));
  }

  function extendMarquee(e) {
    const [wx, wy] = pointerWorld(e);
    gesture.rect = U.normRect(gesture.ox, gesture.oy, wx, wy);
    const inside = itemsInRect(gesture.rect);
    // DOM items are rect-based too, so the same test covers them.
    selection = new Set(gesture.additive ? [...gesture.base, ...inside] : inside);
    Elements.syncTransforms();
    Render.schedule();
  }

  function finishMarquee() {
    endGesture();
    afterSelectionChange();
  }

  /* ---- move --------------------------------------------------------- */

  /* Public: DOM nodes call this from their own mousedown. */
  function beginMoveDrag(e) {
    const [wx, wy] = pointerWorld(e);
    const items = selectionItems();
    if (!items.length) return;
    gesture = {
      kind: 'move', ox: wx, oy: wy, moved: false, committed: false,
      items, start: items.map((i) => (i.type === 'stroke' ? null : { x: i.x, y: i.y }))
    };
    if (gesture.items.some((i) => i.type === 'stroke')) {
      gesture.strokeStart = items.map((i) => (i.type === 'stroke' ? i.points.slice() : null));
    }
    attachWindowDrag();
    vp().style.cursor = 'move';
  }

  function moveTo(e) {
    const [wx, wy] = pointerWorld(e);
    let dx = wx - gesture.ox, dy = wy - gesture.oy;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (!gesture.moved && Math.hypot(dx, dy) * WS.getCamera().zoom < 3) return;
    if (!gesture.committed) { WS.commit(); gesture.committed = true; }
    gesture.moved = true;
    gesture.items.forEach((it, i) => {
      if (it.type === 'stroke') {
        const src = gesture.strokeStart[i];
        for (let k = 0; k < src.length; k += 2) {
          it.points[k] = src[k] + dx;
          it.points[k + 1] = src[k + 1] + dy;
        }
      } else {
        it.x = gesture.start[i].x + dx;
        it.y = gesture.start[i].y + dy;
      }
    });
    WS.markDirty();
    Elements.syncTransforms();
    Render.schedule();
  }

  /* ---- resize ------------------------------------------------------- */

  function beginResize(e, handle) {
    const item = selectionItems()[0];
    if (!item) return;
    const box = WS.bounds(item);
    gesture = {
      kind: 'resize', handle, item, box,
      committed: false,
      snapshot: JSON.parse(JSON.stringify(item))
    };
    attachWindowDrag();
  }

  function resizeTo(e) {
    const { handle, item, box, snapshot } = gesture;
    const [wx, wy] = pointerWorld(e);
    const minSize = 8;

    // Restore the pre-drag geometry, then apply the new box.
    Object.assign(item, JSON.parse(JSON.stringify(snapshot)));

    let nx = box.x, ny = box.y, nw = box.w, nh = box.h;
    if (handle.includes('w')) { nw = box.x + box.w - wx; nx = wx; }
    if (handle.includes('e')) { nw = wx - box.x; }
    if (handle.includes('n')) { nh = box.y + box.h - wy; ny = wy; }
    if (handle.includes('s')) { nh = wy - box.y; }

    const domItem = item.type === 'text' || item.type === 'todo' || item.type === 'link';
    if (domItem) {
      // Width only - height follows the content.
      nw = Math.max(60, nw);
      item.w = nw;
      if (handle.includes('w')) item.x = box.x + box.w - nw;
      Elements.refreshStyle(item);
      WS.markDirty();
      Render.schedule();
      return;
    }

    const keepAspect = e.shiftKey || (item.type === 'image' && !e.altKey);
    if (keepAspect && box.w > 0 && box.h > 0 && handle.length === 2) {
      const k = Math.max(Math.abs(nw) / box.w, Math.abs(nh) / box.h);
      const signW = nw < 0 ? -1 : 1, signH = nh < 0 ? -1 : 1;
      nw = box.w * k * signW;
      nh = box.h * k * signH;
      if (handle.includes('w')) nx = box.x + box.w - nw;
      if (handle.includes('n')) ny = box.y + box.h - nh;
    }
    nw = Math.abs(nw) < minSize ? minSize * Math.sign(nw || 1) : nw;
    nh = Math.abs(nh) < minSize ? minSize * Math.sign(nh || 1) : nh;

    const kx = box.w ? nw / box.w : 1;
    const ky = box.h ? nh / box.h : 1;
    const origin = {
      x: handle.includes('w') ? box.x + box.w : box.x,
      y: handle.includes('n') ? box.y + box.h : box.y
    };
    scaleItem(item, origin, kx, ky);
    if (item.type === 'shape' || item.type === 'image') {
      // Keep width/height positive so hit testing stays simple.
      if (item.w < 0 && item.shape !== 'line' && item.shape !== 'arrow') { item.x += item.w; item.w = -item.w; }
      if (item.h < 0 && item.shape !== 'line' && item.shape !== 'arrow') { item.y += item.h; item.h = -item.h; }
    }
    if (!gesture.committed) { WS.commit(); gesture.committed = true; }
    WS.markDirty();
    Render.schedule();
  }

  /* Handle under the cursor, in screen space. */
  function handleAt(sx, sy) {
    if (!canResizeSelection()) return null;
    const box = selectionBounds();
    if (!box) return null;
    const item = selectionItems()[0];
    const domItem = item && (item.type === 'text' || item.type === 'todo' || item.type === 'link');
    for (const h of Render.handlePoints(box)) {
      if (domItem && h.k !== 'e' && h.k !== 'w') continue;
      if (U.dist(sx, sy, h.x, h.y) <= Render.HANDLE_R + 4) return h.k;
    }
    return null;
  }

  const CURSOR_FOR_HANDLE = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize'
  };

  /* ------------------------------------------------------ pointer flow */

  function attachWindowDrag() {
    addEventListener('mousemove', onWindowMove, true);
    addEventListener('mouseup', onWindowUp, true);
  }
  function detachWindowDrag() {
    removeEventListener('mousemove', onWindowMove, true);
    removeEventListener('mouseup', onWindowUp, true);
  }

  function onWindowMove(e) {
    if (!gesture) return;
    switch (gesture.kind) {
      case 'pan': panTo(e); break;
      case 'stroke': extendStroke(e); break;
      case 'shape': extendShape(e); break;
      case 'erase': eraseAt(e); break;
      case 'marquee': extendMarquee(e); break;
      case 'move': moveTo(e); break;
      case 'resize': resizeTo(e); break;
    }
  }

  function onWindowUp(e) {
    if (!gesture) { detachWindowDrag(); return; }
    const kind = gesture.kind;
    detachWindowDrag();
    if (kind === 'stroke') finishStroke();
    else if (kind === 'shape') finishShape();
    else if (kind === 'marquee') finishMarquee();
    else { endGesture(); renderProps(); }
    Elements.setInteractive(state.tool === 'select');
  }

  /* Capture phase: resize handles win over anything underneath. */
  function onCaptureDown(e) {
    if (!WS.isOpen() || e.button !== 0) return;
    if (state.tool !== 'select' || spaceDown) return;
    const [sx, sy] = pointerPos(e);
    const h = handleAt(sx, sy);
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    Elements.blurEditing();
    beginResize(e, h);
  }

  function onViewportDown(e) {
    if (!WS.isOpen()) return;
    U.closeMenu();

    // Middle button or space always pans.
    if (e.button === 1 || (spaceDown && e.button === 0) || (state.tool === 'pan' && e.button === 0)) {
      e.preventDefault();
      beginPan(e);
      attachWindowDrag();
      return;
    }
    if (e.button === 2) { onViewportContextDown(e); return; }
    if (e.button !== 0) return;

    e.preventDefault();

    switch (state.tool) {
      case 'select': {
        // Freeze DOM hit-testing for the duration of the drag.
        Elements.setInteractive(false);
        const [wx, wy] = pointerWorld(e);
        const hit = hitTest(wx, wy);
        if (hit) {
          if (e.shiftKey) toggleSelect(hit.id);
          else if (!selection.has(hit.id)) selectOnly(hit.id);
          else Elements.blurEditing();
          if (selection.has(hit.id)) { beginMoveDrag(e); return; }
        } else {
          Elements.blurEditing();
          if (!e.shiftKey) clearSelection();
          beginMarquee(e, e.shiftKey);
        }
        attachWindowDrag();
        break;
      }
      case 'pen':
      case 'highlighter':
        clearSelection();
        beginStroke(e, state.tool);
        attachWindowDrag();
        break;
      case 'eraser':
        clearSelection();
        beginErase(e);
        attachWindowDrag();
        break;
      case 'shape':
        clearSelection();
        beginShape(e);
        attachWindowDrag();
        break;
      case 'fill': {
        const [wx, wy] = pointerWorld(e);
        applyFillAt(wx, wy);
        break;
      }
      case 'text': placeText(e); break;
      case 'todo': placeTodo(e); break;
      case 'image': void placeImage(e); break;
      case 'link': void placeLink(e); break;
    }
  }

  function onViewportContextDown(e) {
    const [wx, wy] = pointerWorld(e);
    const hit = hitTest(wx, wy);
    if (hit && !selection.has(hit.id)) selectOnly(hit.id);
    else if (!hit) clearSelection();
  }

  function onViewportContextMenu(e) {
    if (!WS.isOpen()) return;
    e.preventDefault();
    if (selection.size) openSelectionMenu(e.clientX, e.clientY);
    else openCanvasMenu(e.clientX, e.clientY, pointerWorld(e));
  }

  function onViewportMove(e) {
    const [sx, sy] = pointerPos(e);
    lastMouse = { x: e.clientX, y: e.clientY };
    hoverWorld = Render.screenToWorld(sx, sy);
    if (gesture) return;
    updateCursor(sx, sy);
    if (state.tool === 'pen' || state.tool === 'highlighter' || state.tool === 'eraser') {
      const size = state.tool === 'eraser' ? state.eraserSize
        : state.tool === 'highlighter' ? state.hlWidth : state.penWidth;
      const color = state.tool === 'eraser' ? 'rgba(255,120,120,.75)'
        : state.tool === 'highlighter' ? state.hlColor : state.penColor;
      Render.setPreview((c) => Render.drawCursorRing(c, sx, sy, size, color));
    }
  }

  function onViewportLeave() {
    if (!gesture) Render.setPreview(null);
  }

  function updateCursor(sx, sy) {
    const v = vp();
    if (gesture) return;
    if (spaceDown || state.tool === 'pan') { v.style.cursor = 'grab'; return; }
    if (state.tool === 'select') {
      if (sx !== undefined) {
        const h = handleAt(sx, sy);
        if (h) { v.style.cursor = CURSOR_FOR_HANDLE[h]; return; }
      }
      v.style.cursor = 'default';
      return;
    }
    if (state.tool === 'text') { v.style.cursor = 'text'; return; }
    v.style.cursor = 'crosshair';
  }

  /* ---------------------------------------------------- item placement */

  function placeText(e) {
    const [wx, wy] = pointerWorld(e);
    WS.commit();
    const item = newTextItem(wx, wy - 14);
    WS.add(item);
    Elements.addNode(item);
    setTool('select');
    selectOnly(item.id, { keepFocus: true });
    requestAnimationFrame(() => Elements.focusText(item.id));
  }

  function placeTodo(e) {
    const [wx, wy] = pointerWorld(e);
    WS.commit();
    const item = newTodoItem(wx, wy);
    WS.add(item);
    Elements.addNode(item);
    setTool('select');
    selectOnly(item.id, { keepFocus: true });
    requestAnimationFrame(() => {
      const node = Elements.getNode(item.id);
      const t = node && node.querySelector('.todo-title');
      if (t) t.focus();
    });
  }

  async function placeImage(e) {
    const [wx, wy] = pointerWorld(e);
    setTool('select');
    let picked = [];
    try { picked = await window.api.pickImages(); }
    catch (err) { console.error(err); U.toast('Could not open that image'); return; }
    if (!picked.length) return;
    await insertImages(picked.map((p) => p.dataUrl), wx, wy);
  }

  async function insertImages(dataUrls, wx, wy) {
    const created = [];
    let offset = 0;
    for (const url of dataUrls) {
      try {
        const { src, w, h } = await U.loadImageScaled(url);
        const maxW = 520;
        const k = w > maxW ? maxW / w : 1;
        created.push({
          id: U.uid('i'), type: 'image',
          x: wx + offset, y: wy + offset,
          w: Math.round(w * k), h: Math.round(h * k),
          src, natW: w, natH: h, alt: ''
        });
        offset += 24;
      } catch (err) { console.error('image insert failed', err); }
    }
    if (!created.length) { U.toast('That image could not be read'); return; }
    WS.commit();
    WS.addMany(created);
    selectMany(created.map((i) => i.id));
    Render.schedule();
    U.toast(created.length === 1 ? 'Image added' : `${created.length} images added`);
  }

  async function placeLink(e) {
    const [wx, wy] = pointerWorld(e);
    setTool('select');
    const target = await pickWorkspace('Link to workspace');
    if (!target) return;
    WS.commit();
    const item = newLinkItem(wx, wy, target.id, target.name);
    WS.add(item);
    Elements.addNode(item);
    selectOnly(item.id);
  }

  /* Modal list of every workspace, for the link tool. */
  function pickWorkspace(title) {
    return new Promise((resolve) => {
      const all = Store.allWorkspaces().filter((w) => w.id !== WS.getId());
      let done = false;
      const finish = (v) => { if (done) return; done = true; U.closeModal(); resolve(v); };
      U.openModal((box) => {
        box.appendChild(U.el('h3', { text: title }));
        if (!all.length) {
          box.appendChild(U.el('p', { text: 'There are no other workspaces yet. Create another one in the sidebar first.' }));
          box.appendChild(U.el('div', { class: 'actions' }, [
            U.el('button', { class: 'btn', text: 'Close', onclick: () => finish(null) })
          ]));
          return;
        }
        box.appendChild(U.el('p', { text: 'Pick the workspace this card should jump to.' }));
        const search = U.el('input', { class: 'field', type: 'text', placeholder: 'Filter…', spellcheck: 'false' });
        const list = U.el('div', { class: 'picklist' });
        const draw = (q) => {
          list.innerHTML = '';
          const ql = q.trim().toLowerCase();
          const rows = all.filter((w) => !ql || w.name.toLowerCase().includes(ql) ||
            w.path.join('/').toLowerCase().includes(ql));
          if (!rows.length) { list.appendChild(U.el('p', { text: 'No matches.' })); return; }
          for (const w of rows) {
            const row = U.el('div', { class: 'pick' });
            const ic = U.el('span', { class: 'ico' });
            ic.appendChild(U.icon('board', 15));
            row.append(ic, U.el('span', { text: w.name }));
            if (w.path.length) row.appendChild(U.el('span', { class: 'path', text: w.path.join(' / ') }));
            row.addEventListener('click', () => finish(w));
            list.appendChild(row);
          }
        };
        search.addEventListener('input', () => draw(search.value));
        search.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Escape') finish(null);
          if (e.key === 'Enter') {
            const first = list.querySelector('.pick');
            if (first) first.click();
          }
        });
        box.append(search, list, U.el('div', { class: 'actions' }, [
          U.el('button', { class: 'btn', text: 'Cancel', onclick: () => finish(null) })
        ]));
        draw('');
        setTimeout(() => search.focus(), 0);
      });
    });
  }

  /* ------------------------------------------------------------- fill */

  function applyFillAt(wx, wy) {
    const items = WS.getItems();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type !== 'shape') continue;
      if (it.shape === 'line' || it.shape === 'arrow') continue;
      // Treat the shape as solid for picking, so clicking inside always works.
      const inside = U.pointInRect(wx, wy, it, it.width / 2);
      if (!inside) continue;
      if (it.shape === 'ellipse') {
        const nx = (wx - (it.x + it.w / 2)) / (it.w / 2 || 1);
        const ny = (wy - (it.y + it.h / 2)) / (it.h / 2 || 1);
        if (nx * nx + ny * ny > 1.05) continue;
      } else if (it.shape === 'diamond') {
        const nx = Math.abs(wx - (it.x + it.w / 2)) / (it.w / 2 || 1);
        const ny = Math.abs(wy - (it.y + it.h / 2)) / (it.h / 2 || 1);
        if (nx + ny > 1.05) continue;
      }
      WS.commit();
      it.fill = state.fillColor;
      WS.markDirty();
      Render.schedule();
      return;
    }
    U.toast('Click inside a shape to fill it');
  }

  /* ------------------------------------------------------ selection ops */

  function deleteSelection() {
    if (!selection.size) return;
    WS.commit();
    const ids = [...selection];
    WS.removeIds(ids);
    for (const id of ids) Elements.removeNode(id);
    clearSelection();
    Render.schedule();
  }

  function duplicateSelection(offset = 22) {
    const items = selectionItems();
    if (!items.length) return;
    WS.commit();
    const copies = items.map((it) => {
      const c = JSON.parse(JSON.stringify(it));
      c.id = U.uid('i');
      if (c.type === 'todo') c.entries = c.entries.map((e) => ({ ...e, id: U.uid('t') }));
      translateItem(c, offset, offset);
      return c;
    });
    WS.addMany(copies);
    for (const c of copies) if (c.type === 'text' || c.type === 'todo' || c.type === 'link') Elements.addNode(c);
    selectMany(copies.map((c) => c.id));
    Render.schedule();
  }

  function copySelection() {
    const items = selectionItems();
    if (!items.length) return;
    clipboard = JSON.parse(JSON.stringify(items));
    U.toast(`Copied ${items.length} item${items.length === 1 ? '' : 's'}`);
  }

  function cutSelection() {
    copySelection();
    deleteSelection();
  }

  function pasteClipboard() {
    if (!clipboard.length) return;
    const box = U.unionRects(clipboard.map(WS.bounds));
    const target = hoverWorld || [WS.getCamera().x, WS.getCamera().y];
    const dx = target[0] - (box.x + box.w / 2);
    const dy = target[1] - (box.y + box.h / 2);
    WS.commit();
    const copies = clipboard.map((it) => {
      const c = JSON.parse(JSON.stringify(it));
      c.id = U.uid('i');
      if (c.type === 'todo') c.entries = c.entries.map((e) => ({ ...e, id: U.uid('t') }));
      translateItem(c, dx, dy);
      return c;
    });
    WS.addMany(copies);
    for (const c of copies) if (c.type === 'text' || c.type === 'todo' || c.type === 'link') Elements.addNode(c);
    selectMany(copies.map((c) => c.id));
    Render.schedule();
  }

  function selectAll() {
    setTool('select');
    selectMany(WS.getItems().map((i) => i.id));
  }

  function nudge(dx, dy) {
    const items = selectionItems();
    if (!items.length) return;
    WS.commit();
    for (const it of items) translateItem(it, dx, dy);
    WS.markDirty();
    Elements.syncTransforms();
    Render.schedule();
  }

  function openSelectionMenu(x, y) {
    const one = selection.size === 1 ? selectionItems()[0] : null;
    U.contextMenu(x, y, [
      one && one.type === 'text' && { label: 'Edit text', icon: 'pencil', action: () => Elements.focusText(one.id, true) },
      one && one.type === 'link' && { label: 'Open linked workspace', icon: 'link', action: () => App.openWorkspace(one.target) },
      one && one.type === 'link' && { label: 'Change link target', icon: 'board', action: () => retargetLink(one) },
      one && one.type === 'image' && { label: 'Reset to original size', icon: 'image', action: () => resetImageSize(one) },
      (one && (one.type === 'text' || one.type === 'link' || one.type === 'image')) && { sep: true },
      { label: 'Bring to front', icon: 'front', key: ']', action: () => { WS.commit(); WS.bringToFront(selection); reorderDom(); } },
      { label: 'Send to back', icon: 'back', key: '[', action: () => { WS.commit(); WS.sendToBack(selection); reorderDom(); } },
      { sep: true },
      { label: 'Duplicate', icon: 'copy', key: 'Ctrl+D', action: () => duplicateSelection() },
      { label: 'Copy', icon: 'copy', key: 'Ctrl+C', action: copySelection },
      { sep: true },
      { label: 'Delete', icon: 'trash', danger: true, key: 'Del', action: deleteSelection }
    ].filter(Boolean));
  }

  function openCanvasMenu(x, y, world) {
    U.contextMenu(x, y, [
      { label: 'Paste here', icon: 'copy', key: 'Ctrl+V', action: pasteClipboard },
      { sep: true },
      { label: 'Add text box', icon: 'text', action: () => { const i = newTextItem(world[0], world[1]); WS.commit(); WS.add(i); Elements.addNode(i); selectOnly(i.id, { keepFocus: true }); requestAnimationFrame(() => Elements.focusText(i.id)); } },
      { label: 'Add checklist', icon: 'todo', action: () => { const i = newTodoItem(world[0], world[1]); WS.commit(); WS.add(i); Elements.addNode(i); selectOnly(i.id); } },
      { label: 'Add workspace link', icon: 'link', action: async () => { const t = await pickWorkspace('Link to workspace'); if (!t) return; const i = newLinkItem(world[0], world[1], t.id, t.name); WS.commit(); WS.add(i); Elements.addNode(i); selectOnly(i.id); } },
      { sep: true },
      { label: 'Select all', icon: 'select', key: 'Ctrl+A', action: selectAll },
      { label: 'Background…', icon: 'board', key: 'G', action: () => openPaperMenu(x, y) }
    ]);
  }

  /* ------------------------------------------------------------- paper */

  const PAPER_SIZES = [
    { v: 20, label: 'Fine' },
    { v: 40, label: 'Normal' },
    { v: 80, label: 'Wide' },
    { v: 160, label: 'Extra wide' }
  ];

  /* Background is a property of the workspace, not a global preference, so
     each board can carry the paper that suits it. */
  function openPaperMenu(x, y) {
    if (!WS.isOpen()) { U.toast('Open a workspace first'); return; }
    const bg = WS.getBackground();
    const items = [];

    for (const b of Render.BACKGROUNDS) {
      items.push({
        label: b.label,
        icon: bg.type === b.id ? 'check' : null,
        action: () => { WS.setBackground({ type: b.id }); App.updatePaperLabel(); openPaperMenu(x, y); }
      });
    }
    items.push({ sep: true });
    for (const s of PAPER_SIZES) {
      items.push({
        label: s.label,
        icon: bg.size === s.v ? 'check' : null,
        action: () => { WS.setBackground({ size: s.v }); App.updatePaperLabel(); openPaperMenu(x, y); }
      });
    }
    U.contextMenu(x, y, items);
  }

  /* Step through the background styles - bound to G. */
  function cyclePaper() {
    if (!WS.isOpen()) return;
    const list = Render.BACKGROUNDS;
    const cur = list.findIndex((b) => b.id === WS.getBackground().type);
    const next = list[(cur + 1) % list.length];
    WS.setBackground({ type: next.id });
    App.updatePaperLabel();
    U.toast(next.label);
  }

  /* DOM node stacking must follow item order after a z-order change. */
  function reorderDom() {
    Elements.rebuild();
    Render.schedule();
    afterSelectionChange();
  }

  async function retargetLink(item) {
    const t = await pickWorkspace('Change link target');
    if (!t) return;
    WS.commit();
    item.target = t.id;
    item.label = t.name;
    WS.markDirty();
    Elements.rebuild();
    afterSelectionChange();
  }

  function resetImageSize(item) {
    if (!item.natW) return;
    WS.commit();
    item.w = item.natW;
    item.h = item.natH;
    WS.markDirty();
    Render.schedule();
    afterSelectionChange();
  }

  /* --------------------------------------------------------- toolbar UI */

  const TOOL_DEFS = [
    { id: 'select', icon: 'select', label: 'Select & move', key: 'V' },
    { id: 'pan', icon: 'hand', label: 'Pan the workspace', key: 'H' },
    { sep: true },
    { id: 'pen', icon: 'pen', label: 'Draw', key: 'P' },
    { id: 'highlighter', icon: 'marker', label: 'Highlighter', key: 'M' },
    { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
    { sep: true },
    { id: 'shape', icon: 'rect', label: 'Shapes', key: 'R', dynamic: true },
    { id: 'fill', icon: 'bucket', label: 'Fill a shape', key: 'F' },
    { sep: true },
    { id: 'text', icon: 'text', label: 'Text box', key: 'T' },
    { id: 'todo', icon: 'todo', label: 'Checklist', key: 'K' },
    { id: 'image', icon: 'image', label: 'Add image', key: 'I' },
    { id: 'link', icon: 'link', label: 'Link to a workspace', key: 'L' }
  ];

  function renderToolbar() {
    const bar = document.getElementById('toolbar');
    bar.innerHTML = '';
    for (const def of TOOL_DEFS) {
      if (def.sep) { bar.appendChild(U.el('div', { class: 'tool-sep' })); continue; }
      const b = U.el('button', {
        class: 'tool' + (state.tool === def.id ? ' active' : ''),
        title: `${def.label}  (${def.key})`
      });
      b.appendChild(U.icon(def.dynamic ? state.shape : def.icon, 18));
      b.appendChild(U.el('span', { class: 'badge', text: def.key }));
      b.addEventListener('click', () => setTool(def.id));
      bar.appendChild(b);
    }
  }

  /* -------------------------------------------------- properties panel */

  function swatchRow(colors, current, onPick) {
    const row = U.el('div', { class: 'swatches' });
    for (const c of colors) {
      const sw = U.el('button', {
        class: 'sw' + (c === null ? ' none' : '') + (c === current ? ' active' : ''),
        title: c === null ? 'No fill' : c,
        style: c ? `background:${c}` : ''
      });
      sw.addEventListener('click', () => onPick(c));
      row.appendChild(sw);
    }
    return row;
  }

  function slider(label, value, min, max, step, onInput) {
    const val = U.el('span', { class: 'pval', text: String(Math.round(value * 10) / 10) });
    const input = U.el('input', { type: 'range', min, max, step, value });
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = String(Math.round(v * 10) / 10);
      onInput(v);
    });
    return U.el('div', { class: 'pgroup' }, [U.el('span', { class: 'plabel', text: label }), input, val]);
  }

  const sep = () => U.el('div', { class: 'psep' });

  function renderProps() {
    const panel = document.getElementById('props');
    panel.innerHTML = '';
    if (!WS.isOpen()) { panel.classList.add('hidden'); return; }

    const parts = [];

    if (state.tool === 'select' && selection.size) {
      parts.push(...selectionProps());
    } else {
      switch (state.tool) {
        case 'pen':
          parts.push(U.el('div', { class: 'pgroup' }, [
            U.el('span', { class: 'plabel', text: 'Colour' }),
            swatchRow(PALETTE, state.penColor, (c) => { state.penColor = c; saveState(); renderProps(); })
          ]));
          parts.push(sep(), slider('Size', state.penWidth, 1, 40, 0.5, (v) => { state.penWidth = v; saveState(); }));
          break;
        case 'highlighter':
          parts.push(U.el('div', { class: 'pgroup' }, [
            U.el('span', { class: 'plabel', text: 'Colour' }),
            swatchRow(HL_PALETTE, state.hlColor, (c) => { state.hlColor = c; saveState(); renderProps(); })
          ]));
          parts.push(sep(), slider('Size', state.hlWidth, 6, 90, 1, (v) => { state.hlWidth = v; saveState(); }));
          break;
        case 'eraser': {
          const modes = [
            ['part', 'Partial', 'Rubs out only the bit of a stroke you cross'],
            ['stroke', 'Whole', 'Removes the entire stroke you touch']
          ];
          const row = U.el('div', { class: 'pgroup' });
          row.appendChild(U.el('span', { class: 'plabel', text: 'Erase' }));
          for (const [id, label, hint] of modes) {
            row.appendChild(U.el('button', {
              class: 'pbtn' + (state.eraserMode === id ? ' on' : ''),
              text: label, title: hint,
              onclick: () => { state.eraserMode = id; saveState(); renderProps(); }
            }));
          }
          parts.push(row, sep());
          parts.push(slider('Size', state.eraserSize, 6, 140, 1, (v) => { state.eraserSize = v; saveState(); }));
          break;
        }
        case 'shape': {
          const shapes = ['rect', 'ellipse', 'diamond', 'line', 'arrow'];
          const row = U.el('div', { class: 'pgroup' });
          row.appendChild(U.el('span', { class: 'plabel', text: 'Shape' }));
          for (const s of shapes) {
            const b = U.el('button', { class: 'pbtn' + (state.shape === s ? ' on' : ''), title: s, style: 'padding:0 8px' });
            b.appendChild(U.icon(s, 15));
            b.addEventListener('click', () => { state.shape = s; saveState(); renderToolbar(); renderProps(); });
            row.appendChild(b);
          }
          parts.push(row, sep());
          parts.push(U.el('div', { class: 'pgroup' }, [
            U.el('span', { class: 'plabel', text: 'Line' }),
            swatchRow(PALETTE, state.shapeColor, (c) => { state.shapeColor = c; saveState(); renderProps(); })
          ]));
          parts.push(sep(), slider('Width', state.shapeWidth, 0, 30, 0.5, (v) => { state.shapeWidth = v; saveState(); }));
          if (state.shape !== 'line' && state.shape !== 'arrow') {
            parts.push(sep(), U.el('div', { class: 'pgroup' }, [
              U.el('span', { class: 'plabel', text: 'Fill' }),
              swatchRow(FILL_PALETTE, state.shapeFill, (c) => { state.shapeFill = c; saveState(); renderProps(); })
            ]));
          }
          break;
        }
        case 'fill':
          parts.push(U.el('div', { class: 'pgroup' }, [
            U.el('span', { class: 'plabel', text: 'Fill' }),
            swatchRow(PALETTE, state.fillColor, (c) => { state.fillColor = c; saveState(); renderProps(); })
          ]));
          parts.push(sep(), U.el('button', {
            class: 'pbtn', text: 'Remove fill',
            onclick: () => { state.fillColor = null; saveState(); U.toast('Click a shape to clear its fill'); }
          }));
          break;
        case 'text':
          parts.push(U.el('div', { class: 'pgroup' }, [
            U.el('span', { class: 'plabel', text: 'Colour' }),
            swatchRow(PALETTE, state.textColor, (c) => { state.textColor = c; saveState(); renderProps(); })
          ]));
          parts.push(sep(), slider('Size', state.textSize, 8, 96, 1, (v) => { state.textSize = v; saveState(); }));
          parts.push(U.el('button', {
            class: 'pbtn' + (state.textBold ? ' on' : ''), text: 'Bold',
            onclick: () => { state.textBold = !state.textBold; saveState(); renderProps(); }
          }));
          break;
        case 'todo':
          parts.push(U.el('div', { class: 'pgroup' }, [
            U.el('span', { class: 'plabel', text: 'Accent' }),
            swatchRow(PALETTE, state.todoColor, (c) => { state.todoColor = c; saveState(); renderProps(); })
          ]));
          parts.push(sep(), slider('Size', state.todoSize, 10, 40, 1, (v) => { state.todoSize = v; saveState(); }));
          break;
        default:
          break;
      }
    }

    if (!parts.length) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    for (const p of parts) panel.appendChild(p);
  }

  /* Controls that edit whatever is currently selected. */
  function selectionProps() {
    const items = selectionItems();
    const parts = [];
    const has = (t) => items.some((i) => i.type === t);
    const applyAll = (fn) => {
      WS.commit();
      for (const it of items) fn(it);
      WS.markDirty();
      for (const it of items) if (it.type === 'text' || it.type === 'todo' || it.type === 'link') Elements.refreshStyle(it);
      Render.schedule();
      renderProps();
    };

    parts.push(U.el('span', { class: 'plabel', text: `${items.length} selected` }), sep());

    const colorful = items.filter((i) => i.type === 'stroke' || i.type === 'shape' || i.type === 'text' || i.type === 'todo');
    if (colorful.length) {
      const current = colorful[0].color;
      parts.push(U.el('div', { class: 'pgroup' }, [
        U.el('span', { class: 'plabel', text: 'Colour' }),
        swatchRow(PALETTE, current, (c) => applyAll((it) => { if ('color' in it) it.color = c; }))
      ]), sep());
    }

    if (has('shape')) {
      parts.push(U.el('div', { class: 'pgroup' }, [
        U.el('span', { class: 'plabel', text: 'Fill' }),
        swatchRow(FILL_PALETTE, items.find((i) => i.type === 'shape').fill,
          (c) => applyAll((it) => { if (it.type === 'shape') it.fill = c; }))
      ]), sep());
    }

    if (has('stroke') || has('shape')) {
      const w = (items.find((i) => i.type === 'stroke' || i.type === 'shape')).width;
      parts.push(slider('Width', w, 0, 60, 0.5, (v) => {
        for (const it of items) if (it.type === 'stroke' || it.type === 'shape') it.width = v;
        WS.markDirty();
        Render.schedule();
      }), sep());
    }

    if (has('text') || has('todo') || has('link')) {
      const s = (items.find((i) => i.type === 'text' || i.type === 'todo' || i.type === 'link')).size;
      parts.push(slider('Text', s, 8, 96, 1, (v) => {
        for (const it of items) if ('size' in it) it.size = v;
        WS.markDirty();
        for (const it of items) if (it.type === 'text' || it.type === 'todo' || it.type === 'link') Elements.refreshStyle(it);
        Render.schedule();
      }), sep());
    }

    if (has('text')) {
      const bold = items.find((i) => i.type === 'text').bold;
      parts.push(U.el('button', {
        class: 'pbtn' + (bold ? ' on' : ''), text: 'Bold',
        onclick: () => applyAll((it) => { if (it.type === 'text') it.bold = !bold; })
      }));
    }

    const front = U.el('button', { class: 'pbtn', title: 'Bring to front  ( ] )' });
    front.appendChild(U.icon('front', 15));
    front.addEventListener('click', () => { WS.commit(); WS.bringToFront(selection); reorderDom(); });
    const back = U.el('button', { class: 'pbtn', title: 'Send to back  ( [ )' });
    back.appendChild(U.icon('back', 15));
    back.addEventListener('click', () => { WS.commit(); WS.sendToBack(selection); reorderDom(); });
    parts.push(front, back);

    const del = U.el('button', { class: 'pbtn danger', title: 'Delete  (Del)' });
    del.appendChild(U.icon('trash', 15));
    del.addEventListener('click', deleteSelection);
    parts.push(del);

    return parts;
  }

  /* ---------------------------------------------------------- tool set */

  function setTool(id) {
    if (state.tool === id) return;
    state.tool = id;
    saveState();
    if (id !== 'select') { Elements.blurEditing(); clearSelection(); }
    Elements.setInteractive(id === 'select');
    Render.setPreview(null);
    renderToolbar();
    renderProps();
    updateCursor();
  }
  const getTool = () => state.tool;
  const getState = () => state;

  /* --------------------------------------------------------------- zoom */

  function zoomAt(screenX, screenY, factor) {
    const cam = WS.getCamera();
    const [wx, wy] = Render.screenToWorld(screenX, screenY);
    const next = U.clamp(cam.zoom * factor, 0.05, 8);
    if (next === cam.zoom) return;
    cam.zoom = next;
    // Keep the world point under the cursor pinned.
    const { w, h } = Render.getSize();
    cam.x = wx - (screenX - w / 2) / cam.zoom;
    cam.y = wy - (screenY - h / 2) / cam.zoom;
    WS.markCameraDirty();
    Render.schedule();
    App.updateZoomLabel();
  }

  function zoomBy(factor) {
    const { w, h } = Render.getSize();
    zoomAt(w / 2, h / 2, factor);
  }

  function onWheel(e) {
    if (!WS.isOpen()) return;
    e.preventDefault();
    const [sx, sy] = pointerPos(e);
    if (e.ctrlKey || e.metaKey) {
      zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0022));
      return;
    }
    const cam = WS.getCamera();
    const k = e.deltaMode === 1 ? 18 : 1;
    if (e.shiftKey) cam.x += (e.deltaY * k) / cam.zoom;
    else {
      cam.x += (e.deltaX * k) / cam.zoom;
      cam.y += (e.deltaY * k) / cam.zoom;
    }
    WS.markCameraDirty();
    Render.schedule();
  }

  /* ------------------------------------------------------------- paste */

  const modalOpen = () => !document.getElementById('modalBack').classList.contains('hidden');

  async function handlePaste(e) {
    if (!WS.isOpen() || modalOpen()) return;
    if (Elements.isEditing()) return;      // let the text box handle it
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.isContentEditable)) return;
    const cd = e.clipboardData;
    if (!cd) return;

    const files = [...(cd.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      const urls = await Promise.all(files.map((f) => new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => res(null);
        r.readAsDataURL(f);
      })));
      const at = hoverWorld || [WS.getCamera().x, WS.getCamera().y];
      await insertImages(urls.filter(Boolean), at[0], at[1]);
      return;
    }

    if (clipboard.length) { e.preventDefault(); pasteClipboard(); return; }

    const text = cd.getData('text/plain');
    if (text && text.trim()) {
      e.preventDefault();
      const at = hoverWorld || [WS.getCamera().x, WS.getCamera().y];
      WS.commit();
      const item = newTextItem(at[0], at[1], 360);
      item.text = text.trim();
      WS.add(item);
      Elements.addNode(item);
      selectOnly(item.id);
    }
  }

  async function handleDrop(e) {
    if (!WS.isOpen()) return;
    e.preventDefault();
    const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const [wx, wy] = pointerWorld(e);
    const urls = await Promise.all(files.map((f) => new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => res(null);
      r.readAsDataURL(f);
    })));
    await insertImages(urls.filter(Boolean), wx, wy);
  }

  /* -------------------------------------------------------------- keys */

  const KEY_TOOL = {
    v: 'select', h: 'pan', p: 'pen', m: 'highlighter', e: 'eraser',
    r: 'shape', f: 'fill', t: 'text', k: 'todo', i: 'image', l: 'link'
  };

  function onKeyDown(e) {
    if (Elements.isEditing() || modalOpen()) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.isContentEditable)) return;

    if (e.key === ' ' && !spaceDown) {
      spaceDown = true;
      updateCursor();
      if (!gesture) e.preventDefault();
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (mod) {
      switch (k) {
        case 'a': e.preventDefault(); selectAll(); return;
        case 'd': e.preventDefault(); duplicateSelection(); return;
        case 'c': copySelection(); return;
        case 'x': e.preventDefault(); cutSelection(); return;
        default: return;
      }
    }
    if (e.altKey) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection.size) { e.preventDefault(); deleteSelection(); }
      return;
    }
    if (e.key === 'Escape') { clearSelection(); setTool('select'); return; }
    if (e.key === ']') { if (selection.size) { WS.commit(); WS.bringToFront(selection); reorderDom(); } return; }
    if (e.key === '[') { if (selection.size) { WS.commit(); WS.sendToBack(selection); reorderDom(); } return; }
    if (e.key === 'Enter' && selection.size === 1) {
      const it = selectionItems()[0];
      if (it.type === 'text') { e.preventDefault(); Elements.focusText(it.id, true); }
      else if (it.type === 'link') { e.preventDefault(); App.openWorkspace(it.target); }
      return;
    }
    if (e.key.startsWith('Arrow') && selection.size) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 1;
      if (e.key === 'ArrowLeft') nudge(-step, 0);
      else if (e.key === 'ArrowRight') nudge(step, 0);
      else if (e.key === 'ArrowUp') nudge(0, -step);
      else nudge(0, step);
      return;
    }
    if (KEY_TOOL[k] && !e.repeat) { setTool(KEY_TOOL[k]); return; }
    if (k === 'g') cyclePaper();
  }

  function onKeyUp(e) {
    if (e.key === ' ') {
      spaceDown = false;
      if (gesture && gesture.kind === 'pan') { detachWindowDrag(); endGesture(); }
      updateCursor();
    }
  }

  /* -------------------------------------------------------------- init */

  function init() {
    loadState();
    const v = vp();
    v.addEventListener('mousedown', onCaptureDown, true);
    v.addEventListener('mousedown', onViewportDown);
    v.addEventListener('mousemove', onViewportMove);
    v.addEventListener('mouseleave', onViewportLeave);
    v.addEventListener('contextmenu', onViewportContextMenu);
    v.addEventListener('wheel', onWheel, { passive: false });
    v.addEventListener('dragover', (e) => e.preventDefault());
    v.addEventListener('drop', handleDrop);
    addEventListener('paste', handlePaste);
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    renderToolbar();
    renderProps();
    Elements.setInteractive(true);
  }

  return {
    init, setTool, getTool, getState,
    getSelection, isSelected, selectOnly, selectMany, toggleSelect, deselect, clearSelection,
    selectionBounds, canResizeSelection, selectionItems,
    beginMoveDrag, openSelectionMenu,
    deleteSelection, duplicateSelection, copySelection, pasteClipboard, selectAll,
    zoomBy, zoomAt, renderProps, renderToolbar, openPaperMenu, cyclePaper,
    insertImages, pickWorkspace, newLinkItem
  };
})();
