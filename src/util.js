'use strict';

/* Small shared helpers: ids, geometry, DOM, icons, and the modal/menu/toast UI. */

const U = (() => {

  const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function uid(prefix) {
    let s = '';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length];
    return (prefix ? prefix + '-' : '') + s;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function debounce(fn, ms) {
    let t = null;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
    wrapped.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
    wrapped.pending = () => t !== null;
    return wrapped;
  }

  /* ---------------------------------------------------------- geometry */

  const normRect = (x1, y1, x2, y2) => ({
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1)
  });

  const rectsOverlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const pointInRect = (px, py, r, pad = 0) =>
    px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;

  const rectContains = (outer, inner) =>
    inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

  function unionRects(rects) {
    if (!rects.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      if (!r) continue;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    if (!isFinite(x0)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* Distance from point to segment - used for hit-testing strokes and lines. */
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /* --------------------------------------------------------------- DOM */

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;      // only ever fed literal icon markup
        else if (k === 'style') n.setAttribute('style', v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (children) for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  /* Icons: 16x16 path data, rendered as inline SVG. */
  const ICON = {
    select:   '<path d="M3 2.2 12.4 7.9 8.4 8.9 6.6 12.8Z" fill="currentColor"/>',
    hand:     '<path d="M5.2 8V4.4a1 1 0 0 1 2 0V7m0-.6V3.4a1 1 0 0 1 2 0V7m0-.4V4.2a1 1 0 0 1 2 0V8m0-1.2a1 1 0 0 1 2 0v3.4c0 2-1.6 3.6-3.6 3.6H8.4c-1 0-1.7-.5-2.3-1.2L3.6 10a1 1 0 0 1 1.5-1.3L6.6 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
    pen:      '<path d="M2.6 13.4 3.3 11 10.7 3.6a1.4 1.4 0 0 1 2 2L5.3 13l-2.7.4Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9.4 4.9 11.7 7.2" stroke="currentColor" stroke-width="1.3"/>',
    marker:   '<path d="M3 13.4h4.1l6.1-6.1a1.7 1.7 0 0 0 0-2.4l-1.4-1.4a1.7 1.7 0 0 0-2.4 0L3.3 9.6 3 13.4Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>',
    eraser:   '<path d="M6.6 13.4H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2.9 10.2 8 5.1a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2l-3.3 3.3H5.5l-2.6-2.6a1 1 0 0 1 0-1.6Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    rect:     '<rect x="2.4" y="3.6" width="11.2" height="8.8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    ellipse:  '<ellipse cx="8" cy="8" rx="5.8" ry="4.6" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    diamond:  '<path d="M8 2.4 13.6 8 8 13.6 2.4 8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    line:     '<path d="M2.8 13.2 13.2 2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    arrow:    '<path d="M2.8 13.2 13.2 2.8M8.4 2.8h4.8v4.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    bucket:   '<path d="M6.2 2.4 12.4 8.6a1 1 0 0 1 0 1.4l-3.5 3.5a1.4 1.4 0 0 1-2 0L3 10.2a1.4 1.4 0 0 1 0-2l3.7-3.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.6 8.8h9.8" stroke="currentColor" stroke-width="1.2"/><path d="M14.2 10.6c.7 1 1 1.6 1 2.1a1.1 1.1 0 0 1-2.2 0c0-.5.4-1.1 1.2-2.1Z" fill="currentColor"/>',
    text:     '<path d="M3.2 4.3V3h9.6v1.3M8 3.2v9.6M6 12.8h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    todo:     '<rect x="2.2" y="2.6" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="m3.4 5.1 1.1 1.1 1.9-2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="2.2" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9 5h5M9 11.5h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    image:    '<rect x="2" y="3" width="12" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.7" cy="6.5" r="1.15" fill="currentColor"/><path d="m2.6 11.6 3.1-3 2.5 2.4 2.4-2.6 2.9 3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    link:     '<path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    folder:   '<path d="M1.8 4.3a1 1 0 0 1 1-1h2.9l1.2 1.4h6.3a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.25"/>',
    folderOpen:'<path d="M1.8 12.8V4.3a1 1 0 0 1 1-1h2.9l1.2 1.4h6.3a1 1 0 0 1 1 1v1.1" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M1.8 12.8 3.6 7.6a1 1 0 0 1 .95-.7h9.7a1 1 0 0 1 .95 1.3l-1.5 4.6z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>',
    board:    '<rect x="1.9" y="2.6" width="12.2" height="10.8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M4.6 9.9c1-2.6 2.6-3.6 4.8-3.6" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
    chevron:  '<path d="M6 3.6 10.4 8 6 12.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    plus:     '<path d="M8 3.4v9.2M3.4 8h9.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    more:     '<circle cx="4" cy="8" r="1.15" fill="currentColor"/><circle cx="8" cy="8" r="1.15" fill="currentColor"/><circle cx="12" cy="8" r="1.15" fill="currentColor"/>',
    trash:    '<path d="M2.9 4.2h10.2M6.3 4.2V2.9h3.4v1.3M4.3 4.2l.6 8.4a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.6-8.4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
    pencil:   '<path d="M2.9 13.1 3.5 11 11 3.5a1.3 1.3 0 0 1 1.9 1.9L5.3 12.9l-2.4.2Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>',
    copy:     '<rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M10.6 5.4V3.7a1.3 1.3 0 0 0-1.3-1.3H3.7a1.3 1.3 0 0 0-1.3 1.3v5.6a1.3 1.3 0 0 0 1.3 1.3h1.7" fill="none" stroke="currentColor" stroke-width="1.25"/>',
    check:    '<path d="m3.4 8.3 3.1 3.1 6.1-6.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    x:        '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    grip:     '<circle cx="6" cy="4" r="1" fill="currentColor"/><circle cx="10" cy="4" r="1" fill="currentColor"/><circle cx="6" cy="8" r="1" fill="currentColor"/><circle cx="10" cy="8" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="10" cy="12" r="1" fill="currentColor"/>',
    front:    '<rect x="2.4" y="2.4" width="7" height="7" rx="1.2" fill="currentColor" opacity=".45"/><rect x="6.6" y="6.6" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    back:     '<rect x="6.6" y="6.6" width="7" height="7" rx="1.2" fill="currentColor" opacity=".45"/><rect x="2.4" y="2.4" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>'
  };

  function icon(name, size = 16) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICON[name] || '';
    return s;
  }

  /* ------------------------------------------------------------- toast */

  let toastTimer = null;
  function toast(msg, ms = 1900) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  /* -------------------------------------------------------- context menu */

  const menuEl = () => document.getElementById('ctxmenu');

  function closeMenu() {
    const m = menuEl();
    m.classList.add('hidden');
    m.innerHTML = '';
  }

  /* items: [{label, icon, key, danger, action} | {sep:true}] */
  function contextMenu(x, y, items) {
    const m = menuEl();
    m.innerHTML = '';
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { m.appendChild(el('div', { class: 'mi-sep' })); continue; }
      const btn = el('button', { class: 'mi' + (it.danger ? ' danger' : '') });
      const ic = el('span', { class: 'mico' });
      if (it.icon) ic.appendChild(icon(it.icon, 15));
      btn.appendChild(ic);
      btn.appendChild(el('span', { text: it.label }));
      if (it.key) btn.appendChild(el('span', { class: 'k', text: it.key }));
      btn.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.action(); });
      m.appendChild(btn);
    }
    m.classList.remove('hidden');
    m.style.left = '0px';
    m.style.top = '0px';
    const r = m.getBoundingClientRect();
    m.style.left = clamp(x, 4, innerWidth - r.width - 4) + 'px';
    m.style.top = clamp(y, 4, innerHeight - r.height - 4) + 'px';
  }

  addEventListener('mousedown', (e) => {
    const m = menuEl();
    if (!m.classList.contains('hidden') && !m.contains(e.target)) closeMenu();
  }, true);
  addEventListener('blur', closeMenu);

  /* ------------------------------------------------------------- modal */

  let modalCleanup = null;

  function closeModal() {
    document.getElementById('modalBack').classList.add('hidden');
    document.getElementById('modal').innerHTML = '';
    if (modalCleanup) { const f = modalCleanup; modalCleanup = null; f(); }
  }

  function openModal(build) {
    const back = document.getElementById('modalBack');
    const box = document.getElementById('modal');
    box.innerHTML = '';
    build(box, closeModal);
    back.classList.remove('hidden');
  }

  function onModalKey(e) {
    const back = document.getElementById('modalBack');
    if (back.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeModal(); }
  }
  addEventListener('keydown', onModalKey, true);
  document.addEventListener('mousedown', (e) => {
    if (e.target && e.target.id === 'modalBack') closeModal();
  });

  /* Ask for a single line of text. Resolves to the string, or null if cancelled. */
  function prompt(title, { value = '', placeholder = '', okLabel = 'OK', hint = '' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
      openModal((box, close) => {
        modalCleanup = () => { if (!done) { done = true; resolve(null); } };
        const input = el('input', { class: 'field', type: 'text', value, placeholder, spellcheck: 'false' });
        box.appendChild(el('h3', { text: title }));
        if (hint) box.appendChild(el('p', { text: hint }));
        box.appendChild(input);
        box.appendChild(el('div', { class: 'actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: () => finish(null) }),
          el('button', { class: 'btn primary', text: okLabel, onclick: () => finish(input.value.trim() || null) })
        ]));
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(input.value.trim() || null);
          if (e.key === 'Escape') finish(null);
        });
        setTimeout(() => { input.focus(); input.select(); }, 0);
      });
    });
  }

  function confirm(title, message, { okLabel = 'Delete', danger = true } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
      openModal((box) => {
        modalCleanup = () => { if (!done) { done = true; resolve(false); } };
        box.appendChild(el('h3', { text: title }));
        box.appendChild(el('p', { text: message }));
        const ok = el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), text: okLabel, onclick: () => finish(true) });
        box.appendChild(el('div', { class: 'actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: () => finish(false) }),
          ok
        ]));
        setTimeout(() => ok.focus(), 0);
      });
    });
  }

  /* ------------------------------------------------------------ images */

  /* Load a data URL, downscale if huge, return {src,w,h}. Keeps note files sane. */
  function loadImageScaled(dataUrl, maxDim = 1800) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = img;
        if (!w || !h) return reject(new Error('empty image'));
        if (Math.max(w, h) <= maxDim) return resolve({ src: dataUrl, w, h });
        const k = maxDim / Math.max(w, h);
        const cw = Math.round(w * k), ch = Math.round(h * k);
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, cw, ch);
        const hasAlpha = /^data:image\/(png|webp|gif)/i.test(dataUrl);
        resolve({ src: c.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.92), w: cw, h: ch });
      };
      img.onerror = () => reject(new Error('bad image'));
      img.src = dataUrl;
    });
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return {
    uid, clamp, dist, debounce,
    normRect, rectsOverlap, pointInRect, rectContains, unionRects, distToSegment,
    el, icon, ICON, toast, contextMenu, closeMenu,
    openModal, closeModal, prompt, confirm,
    loadImageScaled, escapeHtml
  };
})();
