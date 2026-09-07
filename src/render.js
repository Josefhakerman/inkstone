'use strict';

/* Canvas rendering: camera maths, the dot grid, strokes/shapes/images,
   and the overlay layer (selection handles, marquee, tool previews). */

const Render = (() => {

  const canvas = () => document.getElementById('canvas');
  const overlay = () => document.getElementById('overlay');
  const viewport = () => document.getElementById('viewport');

  let ctx = null, octx = null;
  let dpr = 1;
  let vw = 0, vh = 0;           // css pixels
  let showGrid = true;

  let preview = null;           // function(ctx) drawn on the overlay during a gesture
  let rafPending = false;

  const imageCache = new Map();  // src -> HTMLImageElement

  /* ------------------------------------------------------------ camera */

  function worldToScreen(wx, wy) {
    const c = WS.getCamera();
    return [(wx - c.x) * c.zoom + vw / 2, (wy - c.y) * c.zoom + vh / 2];
  }

  function screenToWorld(sx, sy) {
    const c = WS.getCamera();
    return [(sx - vw / 2) / c.zoom + c.x, (sy - vh / 2) / c.zoom + c.y];
  }

  const getSize = () => ({ w: vw, h: vh });

  /* World rect currently visible, with a small margin for culling. */
  function visibleWorldRect(margin = 64) {
    const [x0, y0] = screenToWorld(-margin, -margin);
    const [x1, y1] = screenToWorld(vw + margin, vh + margin);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* ------------------------------------------------------------ resize */

  function resize() {
    const vp = viewport();
    const r = vp.getBoundingClientRect();
    vw = Math.max(1, Math.round(r.width));
    vh = Math.max(1, Math.round(r.height));
    dpr = window.devicePixelRatio || 1;
    for (const cv of [canvas(), overlay()]) {
      cv.width = Math.round(vw * dpr);
      cv.height = Math.round(vh * dpr);
    }
    ctx = canvas().getContext('2d');
    octx = overlay().getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    schedule();
  }

  /* ---------------------------------------------------------- scheduling */

  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      drawMain();
      drawOverlay();
      Elements.syncTransforms();
    });
  }

  function setPreview(fn) {
    preview = fn;
    schedule();
  }

  /* -------------------------------------------------------- background */

  /* Each workspace picks its own paper. Spacing is multiplied up or down so
     the pattern stays legible instead of turning to mush at extreme zooms. */
  const BACKGROUNDS = [
    { id: 'dots', label: 'Dots' },
    { id: 'grid', label: 'Grid' },
    { id: 'graph', label: 'Graph' },
    { id: 'lines', label: 'Ruled lines' },
    { id: 'columns', label: 'Columns' },
    { id: 'plain', label: 'Plain' }
  ];

  /* Returns [effective world step, on-screen step] for the current zoom. */
  function fitStep(base, zoom, min = 22, max = 190) {
    let step = base;
    let guard = 0;
    while (step * zoom < min && guard++ < 24) step *= 2;
    guard = 0;
    while (step * zoom > max && guard++ < 24) step /= 2;
    return [step, step * zoom];
  }

  function drawBackground() {
    const bg = WS.getBackground();
    if (!bg || bg.type === 'plain' || !showGrid) { drawOrigin(); return; }

    const zoom = WS.getCamera().zoom;
    const [step, screenStep] = fitStep(bg.size || 40, zoom);
    if (screenStep < 6) { drawOrigin(); return; }

    const vr = visibleWorldRect(step * 2);
    const startX = Math.floor(vr.x / step) * step;
    const startY = Math.floor(vr.y / step) * step;
    const fade = U.clamp((screenStep - 14) / 40, 0, 1);
    if (fade <= 0.02) { drawOrigin(); return; }

    ctx.save();
    const ink = (a) => `rgba(255,255,255,${(a * fade).toFixed(3)})`;

    if (bg.type === 'dots') {
      ctx.fillStyle = ink(0.30);
      const r = screenStep > 90 ? 1.6 : 1.2;
      for (let wx = startX; wx < vr.x + vr.w; wx += step) {
        for (let wy = startY; wy < vr.y + vr.h; wy += step) {
          const [sx, sy] = worldToScreen(wx, wy);
          ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
        }
      }
    } else if (bg.type === 'lines') {
      ctx.strokeStyle = ink(0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let wy = startY; wy < vr.y + vr.h; wy += step) {
        const [, sy] = worldToScreen(vr.x, wy);
        const y = Math.round(sy) + 0.5;
        ctx.moveTo(0, y); ctx.lineTo(vw, y);
      }
      ctx.stroke();
    } else if (bg.type === 'columns') {
      ctx.strokeStyle = ink(0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let wx = startX; wx < vr.x + vr.w; wx += step) {
        const [sx] = worldToScreen(wx, vr.y);
        const x = Math.round(sx) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, vh);
      }
      ctx.stroke();
    } else if (bg.type === 'grid' || bg.type === 'graph') {
      // Graph paper adds a heavier rule every fifth line.
      const major = bg.type === 'graph' ? 5 : 0;
      const line = (a, w) => { ctx.strokeStyle = ink(a); ctx.lineWidth = w; };

      const drawSet = (wantMajor) => {
        ctx.beginPath();
        for (let wx = startX; wx < vr.x + vr.w; wx += step) {
          const isMajor = major && Math.round(wx / step) % major === 0;
          if (!!isMajor !== wantMajor) continue;
          const [sx] = worldToScreen(wx, vr.y);
          const x = Math.round(sx) + 0.5;
          ctx.moveTo(x, 0); ctx.lineTo(x, vh);
        }
        for (let wy = startY; wy < vr.y + vr.h; wy += step) {
          const isMajor = major && Math.round(wy / step) % major === 0;
          if (!!isMajor !== wantMajor) continue;
          const [, sy] = worldToScreen(vr.x, wy);
          const y = Math.round(sy) + 0.5;
          ctx.moveTo(0, y); ctx.lineTo(vw, y);
        }
        ctx.stroke();
      };

      line(0.13, 1);
      drawSet(false);
      if (major) { line(0.30, 1.6); drawSet(true); }
    }
    ctx.restore();
    drawOrigin();
  }

  /* Origin marker, so "Center" always means something visible. */
  function drawOrigin() {
    const [ox, oy] = worldToScreen(0, 0);
    if (ox < -40 || ox > vw + 40 || oy < -40 || oy > vh + 40) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.34)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox - 8, oy); ctx.lineTo(ox + 8, oy);
    ctx.moveTo(ox, oy - 8); ctx.lineTo(ox, oy + 8);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------ strokes */

  function tracePoints(c, pts, toScreen) {
    const n = pts.length / 2;
    if (n === 0) return;
    const p = (i) => {
      const wx = pts[i * 2], wy = pts[i * 2 + 1];
      return toScreen ? worldToScreen(wx, wy) : [wx, wy];
    };
    const [x0, y0] = p(0);
    c.beginPath();
    if (n === 1) { c.moveTo(x0, y0); c.lineTo(x0 + 0.01, y0); return; }
    c.moveTo(x0, y0);
    if (n === 2) { const [x1, y1] = p(1); c.lineTo(x1, y1); return; }
    // Quadratic smoothing through midpoints keeps freehand lines fluid.
    let [px, py] = p(0);
    for (let i = 1; i < n - 1; i++) {
      const [cx, cy] = p(i);
      const [nx, ny] = p(i + 1);
      c.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
      px = cx; py = cy;
    }
    const [lx, ly] = p(n - 1);
    c.lineTo(lx, ly);
  }

  function drawStroke(c, item, toScreen = true) {
    const zoom = toScreen ? WS.getCamera().zoom : 1;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = item.color;
    c.lineWidth = Math.max(0.4, item.width * zoom);
    if (item.tool === 'highlighter') {
      c.globalAlpha = 0.34;
      c.lineCap = 'butt';
      c.lineJoin = 'round';
    }
    tracePoints(c, item.points, toScreen);
    c.stroke();
    c.restore();
  }

  /* ------------------------------------------------------------- shapes */

  function shapePath(c, item, toScreen = true) {
    const zoom = toScreen ? WS.getCamera().zoom : 1;
    const [sx, sy] = toScreen ? worldToScreen(item.x, item.y) : [item.x, item.y];
    const w = item.w * zoom, h = item.h * zoom;
    c.beginPath();
    switch (item.shape) {
      case 'ellipse':
        c.ellipse(sx + w / 2, sy + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        break;
      case 'diamond':
        c.moveTo(sx + w / 2, sy);
        c.lineTo(sx + w, sy + h / 2);
        c.lineTo(sx + w / 2, sy + h);
        c.lineTo(sx, sy + h / 2);
        c.closePath();
        break;
      case 'line':
      case 'arrow':
        c.moveTo(sx, sy);
        c.lineTo(sx + w, sy + h);
        break;
      default: {
        const r = Math.min(Math.abs(item.radius ?? 8) * zoom, Math.abs(w) / 2, Math.abs(h) / 2);
        if (c.roundRect) c.roundRect(sx, sy, w, h, r);
        else c.rect(sx, sy, w, h);
      }
    }
  }

  function drawArrowHead(c, item, toScreen) {
    const zoom = toScreen ? WS.getCamera().zoom : 1;
    const [sx, sy] = toScreen ? worldToScreen(item.x, item.y) : [item.x, item.y];
    const ex = sx + item.w * zoom, ey = sy + item.h * zoom;
    const ang = Math.atan2(ey - sy, ex - sx);
    const len = U.clamp(item.width * zoom * 3.6, 8, 40);
    const spread = 0.44;
    c.beginPath();
    c.moveTo(ex, ey);
    c.lineTo(ex - len * Math.cos(ang - spread), ey - len * Math.sin(ang - spread));
    c.moveTo(ex, ey);
    c.lineTo(ex - len * Math.cos(ang + spread), ey - len * Math.sin(ang + spread));
    c.stroke();
  }

  function drawShape(c, item, toScreen = true) {
    const zoom = toScreen ? WS.getCamera().zoom : 1;
    const isLine = item.shape === 'line' || item.shape === 'arrow';
    c.save();
    if (item.fill && !isLine) {
      c.fillStyle = item.fill;
      shapePath(c, item, toScreen);
      c.fill();
    }
    if (item.width > 0) {
      c.strokeStyle = item.color;
      c.lineWidth = Math.max(0.4, item.width * zoom);
      c.lineJoin = 'round';
      c.lineCap = 'round';
      shapePath(c, item, toScreen);
      c.stroke();
      if (item.shape === 'arrow') drawArrowHead(c, item, toScreen);
    }
    c.restore();
  }

  /* ------------------------------------------------------------- images */

  function getImage(src) {
    let img = imageCache.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => schedule();
      img.onerror = () => {};
      img.src = src;
      imageCache.set(src, img);
    }
    return img;
  }

  function drawImageItem(c, item, toScreen = true) {
    const img = getImage(item.src);
    const zoom = toScreen ? WS.getCamera().zoom : 1;
    const [sx, sy] = toScreen ? worldToScreen(item.x, item.y) : [item.x, item.y];
    const w = item.w * zoom, h = item.h * zoom;
    if (img.complete && img.naturalWidth) {
      c.save();
      c.imageSmoothingQuality = 'high';
      if (c.roundRect) {
        c.beginPath();
        c.roundRect(sx, sy, w, h, Math.min(6 * zoom, w / 2, h / 2));
        c.clip();
      }
      c.drawImage(img, sx, sy, w, h);
      c.restore();
    } else {
      c.save();
      c.fillStyle = '#000000';
      c.strokeStyle = '#5e5e5e';
      c.lineWidth = 2;
      c.fillRect(sx, sy, w, h);
      c.strokeRect(sx, sy, w, h);
      c.restore();
    }
  }

  /* --------------------------------------------------------- main pass */

  function drawMain() {
    if (!ctx) return;
    ctx.clearRect(0, 0, vw, vh);
    if (!WS.isOpen()) return;

    drawBackground();

    const vr = visibleWorldRect();
    for (const item of WS.getItems()) {
      if (item.type !== 'stroke' && item.type !== 'shape' && item.type !== 'image') continue;
      if (!U.rectsOverlap(vr, WS.bounds(item))) continue;
      if (item.type === 'stroke') drawStroke(ctx, item);
      else if (item.type === 'shape') drawShape(ctx, item);
      else drawImageItem(ctx, item);
    }
  }

  /* ------------------------------------------------------------ overlay */

  const HANDLE_R = 5;

  /* Handle positions in screen space for a world rect. */
  function handlePoints(rect) {
    const [x0, y0] = worldToScreen(rect.x, rect.y);
    const [x1, y1] = worldToScreen(rect.x + rect.w, rect.y + rect.h);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return [
      { k: 'nw', x: x0, y: y0 }, { k: 'n', x: mx, y: y0 }, { k: 'ne', x: x1, y: y0 },
      { k: 'e', x: x1, y: my }, { k: 'se', x: x1, y: y1 }, { k: 's', x: mx, y: y1 },
      { k: 'sw', x: x0, y: y1 }, { k: 'w', x: x0, y: my }
    ];
  }

  function drawOverlay() {
    if (!octx) return;
    octx.clearRect(0, 0, vw, vh);
    if (!WS.isOpen()) return;

    const sel = Tools.getSelection();
    if (sel.size) {
      // Per-item outlines when several things are picked.
      if (sel.size > 1) {
        octx.save();
        octx.strokeStyle = 'rgba(255,255,255,.45)';
        octx.lineWidth = 1.5;
        octx.setLineDash([4, 4]);
        for (const itemId of sel) {
          const item = WS.getItem(itemId);
          if (!item) continue;
          const b = WS.bounds(item);
          const [x0, y0] = worldToScreen(b.x, b.y);
          const [x1, y1] = worldToScreen(b.x + b.w, b.y + b.h);
          octx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        }
        octx.restore();
      }

      const box = Tools.selectionBounds();
      if (box) {
        const [x0, y0] = worldToScreen(box.x, box.y);
        const [x1, y1] = worldToScreen(box.x + box.w, box.y + box.h);
        octx.save();
        octx.strokeStyle = '#ffffff';
        octx.lineWidth = 2;
        octx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        if (Tools.canResizeSelection()) {
          octx.fillStyle = '#000000';
          octx.lineWidth = 2;
          for (const h of handlePoints(box)) {
            octx.fillRect(h.x - HANDLE_R, h.y - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2);
            octx.strokeRect(h.x - HANDLE_R, h.y - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2);
          }
        }
        octx.restore();
      }
    }

    if (preview) {
      octx.save();
      preview(octx);
      octx.restore();
    }
  }

  function drawMarquee(c, r) {
    const [x0, y0] = worldToScreen(r.x, r.y);
    const [x1, y1] = worldToScreen(r.x + r.w, r.y + r.h);
    c.fillStyle = 'rgba(255,255,255,.10)';
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.setLineDash([6, 4]);
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    c.setLineDash([]);
  }

  /* Ring showing pen / eraser size at the cursor. */
  function drawCursorRing(c, sx, sy, worldSize, color) {
    const r = Math.max(2, (worldSize * WS.getCamera().zoom) / 2);
    c.beginPath();
    c.arc(sx, sy, r, 0, Math.PI * 2);
    c.strokeStyle = color || 'rgba(255,255,255,.7)';
    c.lineWidth = 1.5;
    c.stroke();
  }

  const setShowGrid = (v) => { showGrid = !!v; schedule(); };
  const getShowGrid = () => showGrid;

  /* ------------------------------------------------------------- export */

  /* Wrapped text helper shared by the export renderer. */
  function wrapText(c, text, maxWidth) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      if (!para) { lines.push(''); continue; }
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const test = line + word;
        if (c.measureText(test).width > maxWidth && line.trim()) {
          lines.push(line.replace(/\s+$/, ''));
          line = word.replace(/^\s+/, '');
        } else {
          line = test;
        }
      }
      lines.push(line.replace(/\s+$/, ''));
    }
    return lines;
  }

  const UI_FONT = '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';

  function drawTextItemFlat(c, item) {
    c.save();
    c.fillStyle = item.color;
    c.font = `${item.bold ? '600 ' : ''}${item.size}px ${UI_FONT}`;
    c.textBaseline = 'top';
    const lineH = item.size * 1.4;
    const lines = wrapText(c, item.text || '', item.w - 18);
    let y = item.y + 14 + 6;
    for (const ln of lines) {
      c.fillText(ln, item.x + 9, y);
      y += lineH;
    }
    c.restore();
  }

  function drawTodoItemFlat(c, item) {
    const s = item.size;
    c.save();
    c.font = `${s}px ${UI_FONT}`;
    const h = item.h || 120;
    if (c.roundRect) { c.beginPath(); c.roundRect(item.x, item.y, item.w, h, 10); }
    else { c.beginPath(); c.rect(item.x, item.y, item.w, h); }
    c.fillStyle = '#000000';
    c.fill();
    c.strokeStyle = '#5e5e5e';
    c.lineWidth = 2;
    c.stroke();

    c.textBaseline = 'top';
    let y = item.y + 7;
    c.fillStyle = '#e6e8ec';
    c.font = `600 ${s}px ${UI_FONT}`;
    c.fillText(item.title || 'Checklist', item.x + 10, y);
    y += s * 1.45 + 6;
    c.strokeStyle = '#5e5e5e';
    c.beginPath(); c.moveTo(item.x, y - 4); c.lineTo(item.x + item.w, y - 4); c.stroke();

    c.font = `${s}px ${UI_FONT}`;
    for (const e of item.entries) {
      const boxSize = s * 1.05;
      const bx = item.x + 12, by = y + s * 0.16;
      c.beginPath();
      if (c.roundRect) c.roundRect(bx, by, boxSize, boxSize, 4); else c.rect(bx, by, boxSize, boxSize);
      if (e.done) { c.fillStyle = item.color; c.fill(); }
      else { c.strokeStyle = '#4a4a5c'; c.lineWidth = 1.5; c.stroke(); }
      if (e.done) {
        c.strokeStyle = '#0a0a0c';
        c.lineWidth = Math.max(1.4, s * 0.13);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(bx + boxSize * 0.24, by + boxSize * 0.52);
        c.lineTo(bx + boxSize * 0.44, by + boxSize * 0.72);
        c.lineTo(bx + boxSize * 0.78, by + boxSize * 0.28);
        c.stroke();
      }
      const tx = bx + boxSize + 8;
      const lines = wrapText(c, e.text || '', item.w - (tx - item.x) - 16);
      c.fillStyle = e.done ? '#5f6472' : '#e6e8ec';
      let ly = y;
      for (const ln of lines) {
        c.fillText(ln, tx, ly);
        if (e.done) {
          const wdt = c.measureText(ln).width;
          c.strokeStyle = '#5f6472';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(tx, ly + s * 0.62); c.lineTo(tx + wdt, ly + s * 0.62);
          c.stroke();
        }
        ly += s * 1.35;
      }
      y = ly + 7;
    }
    c.restore();
  }

  function drawLinkItemFlat(c, item, labelResolver) {
    const s = item.size;
    const h = item.h || s * 3.4;
    c.save();
    c.beginPath();
    if (c.roundRect) c.roundRect(item.x, item.y, item.w, h, 10); else c.rect(item.x, item.y, item.w, h);
    c.fillStyle = '#000000';
    c.fill();
    c.strokeStyle = '#5e5e5e';
    c.lineWidth = 2;
    c.stroke();
    c.textBaseline = 'top';
    c.fillStyle = '#ffffff';
    c.font = `600 ${s}px ${UI_FONT}`;
    c.fillText('→', item.x + 11, item.y + h / 2 - s * 0.75);
    c.fillStyle = '#e6e8ec';
    const label = item.label || labelResolver(item.target) || 'Missing workspace';
    const lines = wrapText(c, label, item.w - 44);
    c.fillText(lines[0] + (lines.length > 1 ? '…' : ''), item.x + 11 + s * 1.5, item.y + h / 2 - s * 0.9);
    c.fillStyle = '#5f6472';
    c.font = `${s * 0.8}px ${UI_FONT}`;
    c.fillText('Workspace link', item.x + 11 + s * 1.5, item.y + h / 2 + s * 0.35);
    c.restore();
  }

  /* Renders the whole board (including DOM-backed items) to an offscreen
     canvas, in world coordinates. Returns a data URL. */
  function exportPNG({ padding = 60, maxPixels = 24e6, background = '#000000' } = {}) {
    const b = WS.contentBounds();
    if (!b) return null;
    const worldW = b.w + padding * 2;
    const worldH = b.h + padding * 2;
    let scale = 2;
    while (worldW * worldH * scale * scale > maxPixels && scale > 0.25) scale /= 2;

    const cw = Math.max(1, Math.round(worldW * scale));
    const ch = Math.max(1, Math.round(worldH * scale));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.fillStyle = background;
    g.fillRect(0, 0, cw, ch);
    g.setTransform(scale, 0, 0, scale, -(b.x - padding) * scale, -(b.y - padding) * scale);

    const nameOf = (targetId) => {
      const n = Store.find(targetId);
      return n ? n.name : null;
    };

    for (const item of WS.getItems()) {
      switch (item.type) {
        case 'stroke': drawStroke(g, item, false); break;
        case 'shape': drawShape(g, item, false); break;
        case 'image': drawImageItem(g, item, false); break;
        case 'text': drawTextItemFlat(g, item); break;
        case 'todo': drawTodoItemFlat(g, item); break;
        case 'link': drawLinkItemFlat(g, item, nameOf); break;
      }
    }
    return c.toDataURL('image/png');
  }

  return {
    resize, schedule, setPreview,
    worldToScreen, screenToWorld, visibleWorldRect, getSize,
    handlePoints, drawMarquee, drawCursorRing,
    drawStroke, drawShape,
    getImage, imageCache,
    setShowGrid, getShowGrid, BACKGROUNDS,
    exportPNG,
    HANDLE_R
  };
})();
