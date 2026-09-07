'use strict';

/* DOM-backed workspace items: text boxes, checklists and workspace links.
   They live in #domlayer, positioned by the same camera as the canvas. */

const Elements = (() => {

  const layer = () => document.getElementById('domlayer');

  const nodes = new Map();     // item id -> root element
  let editingId = null;        // item whose text is being edited
  let committedThisEdit = false;

  /* -------------------------------------------------------------- utils */

  const isDomItem = (t) => t === 'text' || t === 'todo' || t === 'link';

  /* One undo entry per editing session rather than per keystroke. */
  function commitOnce() {
    if (committedThisEdit) return;
    committedThisEdit = true;
    WS.commit();
  }

  function plainPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  /* Records the laid-out size back onto the item so bounds/fit/export work.
     Boxed items own their width; free text is measured in both directions. */
  function measure(item, root) {
    const el = root || nodes.get(item.id);
    if (!el) return;
    const body = el.firstElementChild;
    if (!body) return;
    let changed = false;
    const h = body.offsetHeight;
    if (h && Math.abs(h - (item.h || 0)) > 0.5) { item.h = h; changed = true; }
    if (item.type === 'text' && item.boxed === false) {
      const w = body.offsetWidth;
      if (w && Math.abs(w - (item.w || 0)) > 0.5) { item.w = w; changed = true; }
    }
    if (changed) Render.schedule();
  }

  function measureAll() {
    for (const item of WS.getItems()) {
      if (isDomItem(item.type)) measure(item);
    }
  }

  /* ------------------------------------------------------- drag / select */

  /* Shared pointer handling for a "grab area" that moves the item. */
  function wireDragHandle(handleEl, item, { selectFirst = true } = {}) {
    handleEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (selectFirst) {
        if (e.shiftKey) Tools.toggleSelect(item.id);
        else if (!Tools.isSelected(item.id)) Tools.selectOnly(item.id);
      }
      Tools.beginMoveDrag(e);
    });
  }

  function wireCommon(root, item) {
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!Tools.isSelected(item.id)) Tools.selectOnly(item.id);
      Tools.openSelectionMenu(e.clientX, e.clientY);
    });
    // Alt-drag moves from anywhere on the element.
    root.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!Tools.isSelected(item.id)) Tools.selectOnly(item.id);
        Tools.beginMoveDrag(e);
      }
    }, true);
  }

  /* ---------------------------------------------------------- text node */

  function buildText(item) {
    // Free text has no box at all: it sits directly on the canvas, sizes itself
    // to its content, and is dragged by its body rather than a handle bar.
    const free = item.boxed === false;

    const root = U.el('div', {
      class: 'node textnode' + (free ? ' free' : ''),
      dataset: { id: item.id }
    });
    const body = U.el('div', { class: 'nbody' });
    const bar = free ? null : U.el('div', { class: 'thandlebar' });
    const edit = U.el('div', {
      class: 'textedit',
      contenteditable: free ? 'false' : 'true',
      spellcheck: 'false',
      'data-ph': free ? 'Text…' : 'Type something…'
    });
    edit.textContent = item.text || '';
    if (bar) body.appendChild(bar);
    body.appendChild(edit);
    root.appendChild(body);

    if (bar) wireDragHandle(bar, item);
    wireCommon(root, item);

    if (free) {
      // Click to pick up and move, double-click to start typing.
      root.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.altKey) return;
        if (edit.isContentEditable) return;          // already editing
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) Tools.toggleSelect(item.id);
        else if (!Tools.isSelected(item.id)) Tools.selectOnly(item.id);
        Tools.beginMoveDrag(e);
      });
      root.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        beginFreeEdit(item, root);
      });
    }

    edit.addEventListener('mousedown', (e) => {
      if (free && !edit.isContentEditable) return;   // handled by the root
      e.stopPropagation();
      if (e.altKey) return;
      if (!Tools.isSelected(item.id)) Tools.selectOnly(item.id, { keepFocus: true });
    });
    edit.addEventListener('focus', () => {
      editingId = item.id;
      committedThisEdit = false;
      Tools.selectOnly(item.id, { keepFocus: true });
    });
    edit.addEventListener('blur', () => {
      if (editingId === item.id) editingId = null;
      if (free) edit.setAttribute('contenteditable', 'false');
      const text = edit.innerText.replace(/ /g, ' ');
      if (text !== item.text) { item.text = text; WS.markDirty(); }
      measure(item, root);
      // Empty text left behind is just noise - drop it.
      if (!item.text.trim()) {
        WS.removeIds([item.id]);
        Tools.deselect(item.id);
        App.rebuildAll();
      }
    });
    edit.addEventListener('input', () => {
      commitOnce();
      item.text = edit.innerText.replace(/ /g, ' ');
      WS.markDirty();
      measure(item, root);
    });
    edit.addEventListener('paste', plainPaste);
    edit.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { edit.blur(); }
    });

    applyTextStyle(root, item);
    return root;
  }

  function applyTextStyle(root, item) {
    const body = root.querySelector('.nbody');
    const edit = root.querySelector('.textedit');
    if (item.boxed === false) {
      body.style.width = '';           // width comes from the content
      body.style.maxWidth = '2400px';
    } else {
      body.style.width = item.w + 'px';
      body.style.maxWidth = '';
    }
    edit.style.fontSize = item.size + 'px';
    edit.style.color = item.color;
    edit.style.fontWeight = item.bold ? '650' : '400';
  }

  /* Turns a free-text item into an editable caret and focuses it. */
  function beginFreeEdit(item, root) {
    const node = root || nodes.get(item.id);
    if (!node) return;
    const edit = node.querySelector('.textedit');
    if (!edit) return;
    edit.setAttribute('contenteditable', 'true');
    edit.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(edit);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ---------------------------------------------------------- todo node */

  function checkboxEl(on) {
    const b = U.el('div', { class: 'cbox' + (on ? ' on' : '') });
    b.appendChild(U.icon('check', 11));
    return b;
  }

  function buildTodo(item) {
    const root = U.el('div', { class: 'node todonode', dataset: { id: item.id } });
    const body = U.el('div', { class: 'nbody' });
    const bar = U.el('div', { class: 'nhandle' });
    const title = U.el('div', { class: 'todo-title', contenteditable: 'true', spellcheck: 'false' });
    title.textContent = item.title || '';
    const list = U.el('div', { class: 'todo-list' });
    const add = U.el('div', { class: 'todo-add' });
    add.appendChild(U.icon('plus', 13));
    add.appendChild(U.el('span', { text: 'Add item' }));
    const foot = U.el('div', { class: 'todo-foot' });

    body.append(bar, title, list, add, foot);
    root.appendChild(body);

    wireDragHandle(bar, item);
    wireCommon(root, item);

    title.addEventListener('mousedown', (e) => e.stopPropagation());
    title.addEventListener('focus', () => { editingId = item.id; committedThisEdit = false; Tools.selectOnly(item.id, { keepFocus: true }); });
    title.addEventListener('input', () => {
      commitOnce();
      item.title = title.innerText.replace(/ /g, ' ').replace(/\n/g, ' ');
      WS.markDirty();
      measure(item, root);
    });
    title.addEventListener('blur', () => { if (editingId === item.id) editingId = null; });
    title.addEventListener('paste', plainPaste);
    title.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commitOnce();
        addEntry(item, root, 0, '');
      } else if (e.key === 'Escape') title.blur();
    });

    add.addEventListener('mousedown', (e) => e.stopPropagation());
    add.addEventListener('click', () => {
      WS.commit();
      addEntry(item, root, item.entries.length, '');
    });

    renderTodoBody(root, item);
    applyTodoStyle(root, item);
    return root;
  }

  function applyTodoStyle(root, item) {
    const body = root.querySelector('.nbody');
    body.style.width = item.w + 'px';
    body.style.fontSize = item.size + 'px';
    root.style.setProperty('--accent', item.color);
  }

  function addEntry(item, root, index, text) {
    const entry = { id: U.uid('t'), text: text || '', done: false };
    item.entries.splice(U.clamp(index, 0, item.entries.length), 0, entry);
    WS.markDirty();
    renderTodoBody(root, item);
    measure(item, root);
    focusEntry(root, entry.id, 'end');
  }

  function focusEntry(root, entryId, where) {
    const node = root.querySelector(`.todo-item[data-eid="${entryId}"] .todo-text`);
    if (!node) return;
    node.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(where !== 'start');
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function renderTodoBody(root, item) {
    const list = root.querySelector('.todo-list');
    const foot = root.querySelector('.todo-foot');
    list.innerHTML = '';

    item.entries.forEach((entry, idx) => {
      const row = U.el('div', {
        class: 'todo-item' + (entry.done ? ' done' : ''),
        dataset: { eid: entry.id },
        draggable: 'false'
      });

      const grip = U.el('span', { class: 'grip', title: 'Drag to reorder' });
      grip.appendChild(U.icon('grip', 12));
      grip.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        beginEntryReorder(item, root, entry.id, e);
      });

      const box = checkboxEl(entry.done);
      box.addEventListener('mousedown', (e) => e.stopPropagation());
      box.addEventListener('click', () => {
        WS.commit();
        entry.done = !entry.done;
        WS.markDirty();
        renderTodoBody(root, item);
        measure(item, root);
      });

      const text = U.el('div', { class: 'todo-text', contenteditable: 'true', spellcheck: 'false' });
      text.textContent = entry.text;
      text.addEventListener('mousedown', (e) => e.stopPropagation());
      text.addEventListener('focus', () => { editingId = item.id; committedThisEdit = false; Tools.selectOnly(item.id, { keepFocus: true }); });
      text.addEventListener('blur', () => { if (editingId === item.id) editingId = null; });
      text.addEventListener('paste', plainPaste);
      text.addEventListener('input', () => {
        commitOnce();
        entry.text = text.innerText.replace(/ /g, ' ').replace(/\n/g, ' ');
        WS.markDirty();
        measure(item, root);
      });
      text.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commitOnce();
          addEntry(item, root, idx + 1, '');
        } else if (e.key === 'Backspace' && !text.innerText.length) {
          e.preventDefault();
          commitOnce();
          item.entries.splice(idx, 1);
          WS.markDirty();
          renderTodoBody(root, item);
          measure(item, root);
          const prev = item.entries[idx - 1];
          if (prev) focusEntry(root, prev.id, 'end');
          else root.querySelector('.todo-title').focus();
        } else if (e.key === 'ArrowDown' && item.entries[idx + 1]) {
          e.preventDefault();
          focusEntry(root, item.entries[idx + 1].id, 'end');
        } else if (e.key === 'ArrowUp' && item.entries[idx - 1]) {
          e.preventDefault();
          focusEntry(root, item.entries[idx - 1].id, 'end');
        } else if (e.key === 'Escape') {
          text.blur();
        }
      });

      const del = U.el('button', { class: 'del', title: 'Remove' });
      del.appendChild(U.icon('x', 12));
      del.addEventListener('mousedown', (e) => e.stopPropagation());
      del.addEventListener('click', () => {
        WS.commit();
        item.entries.splice(idx, 1);
        WS.markDirty();
        renderTodoBody(root, item);
        measure(item, root);
      });

      row.append(grip, box, text, del);
      list.appendChild(row);
    });

    const total = item.entries.length;
    const done = item.entries.filter((e) => e.done).length;
    foot.innerHTML = '';
    if (total) {
      const bar = U.el('div', { class: 'todo-bar' }, [
        U.el('i', { style: `width:${Math.round((done / total) * 100)}%;background:${item.color}` })
      ]);
      foot.append(U.el('span', { text: `${done}/${total}` }), bar);
    }
  }

  /* Drag a checklist entry to a new position. */
  function beginEntryReorder(item, root, entryId, downEvent) {
    const list = root.querySelector('.todo-list');
    const rowFor = (id) => list.querySelector(`.todo-item[data-eid="${id}"]`);
    const dragged = rowFor(entryId);
    if (!dragged) return;
    dragged.classList.add('dragging');
    let targetIndex = item.entries.findIndex((e) => e.id === entryId);

    const onMove = (e) => {
      const rows = [...list.querySelectorAll('.todo-item')];
      let idx = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { idx = i; break; }
      }
      targetIndex = idx;
      rows.forEach((r) => r.classList.remove('dropline'));
      if (rows[idx]) rows[idx].classList.add('dropline');
    };
    const onUp = () => {
      removeEventListener('mousemove', onMove);
      removeEventListener('mouseup', onUp);
      const from = item.entries.findIndex((e) => e.id === entryId);
      let to = targetIndex;
      if (from < to) to--;
      if (from !== to && to >= 0) {
        WS.commit();
        const [moved] = item.entries.splice(from, 1);
        item.entries.splice(U.clamp(to, 0, item.entries.length), 0, moved);
        WS.markDirty();
      }
      renderTodoBody(root, item);
      measure(item, root);
    };
    addEventListener('mousemove', onMove);
    addEventListener('mouseup', onUp);
    onMove(downEvent);
  }

  /* ---------------------------------------------------------- link node */

  function buildLink(item) {
    const target = Store.find(item.target);
    const missing = !target || target.type !== 'workspace';
    const label = item.label || (target ? target.name : 'Missing workspace');

    const root = U.el('div', { class: 'node linknode' + (missing ? ' linkmissing' : ''), dataset: { id: item.id } });
    const body = U.el('div', { class: 'nbody' });
    const card = U.el('div', { class: 'linkcard' });
    const ico = U.el('span', { class: 'lico' });
    ico.appendChild(U.icon(missing ? 'x' : 'link', 17));
    const info = U.el('div', { class: 'linkinfo' }, [
      U.el('div', { class: 'linkname', text: label, title: label }),
      U.el('div', { class: 'linkhint', text: missing ? 'Target was deleted' : 'Double-click to open' })
    ]);
    card.append(ico, info);
    body.appendChild(card);
    root.appendChild(body);

    wireCommon(root, item);

    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.altKey) return;
      e.stopPropagation();
      if (e.shiftKey) Tools.toggleSelect(item.id);
      else if (!Tools.isSelected(item.id)) Tools.selectOnly(item.id);
      Tools.beginMoveDrag(e);
    });
    card.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (missing) { U.toast('That workspace no longer exists'); return; }
      App.openWorkspace(item.target);
    });

    const bodyEl = root.querySelector('.nbody');
    bodyEl.style.width = item.w + 'px';
    bodyEl.style.fontSize = item.size + 'px';
    return root;
  }

  /* ------------------------------------------------------------- build */

  function build(item) {
    if (item.type === 'text') return buildText(item);
    if (item.type === 'todo') return buildTodo(item);
    if (item.type === 'link') return buildLink(item);
    return null;
  }

  /* Rebuild every DOM node from scratch (after load / undo / big changes). */
  function rebuild() {
    const host = layer();
    host.innerHTML = '';
    nodes.clear();
    editingId = null;
    if (!WS.isOpen()) return;
    for (const item of WS.getItems()) {
      if (!isDomItem(item.type)) continue;
      const node = build(item);
      if (!node) continue;
      nodes.set(item.id, node);
      host.appendChild(node);
    }
    syncTransforms();
    // Heights are only known once the browser has laid the nodes out.
    requestAnimationFrame(() => { measureAll(); syncTransforms(); });
  }

  /* Add a single new item without rebuilding everything. */
  function addNode(item) {
    if (!isDomItem(item.type)) return null;
    const node = build(item);
    if (!node) return null;
    nodes.set(item.id, node);
    layer().appendChild(node);
    syncOne(item, node);
    requestAnimationFrame(() => { measure(item, node); syncOne(item, node); });
    return node;
  }

  function removeNode(itemId) {
    const n = nodes.get(itemId);
    if (n) n.remove();
    nodes.delete(itemId);
  }

  /* Re-apply size/colour after a properties change. */
  function refreshStyle(item) {
    const node = nodes.get(item.id);
    if (!node) return;
    if (item.type === 'text') applyTextStyle(node, item);
    else if (item.type === 'todo') { applyTodoStyle(node, item); renderTodoBody(node, item); }
    else if (item.type === 'link') {
      const body = node.querySelector('.nbody');
      body.style.width = item.w + 'px';
      body.style.fontSize = item.size + 'px';
    }
    measure(item, node);
    syncOne(item, node);
  }

  function syncOne(item, node) {
    const zoom = WS.getCamera().zoom;
    const [sx, sy] = Render.worldToScreen(item.x, item.y);
    node.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${zoom})`;
    node.classList.toggle('sel', Tools.isSelected(item.id));
    // Cull far-offscreen nodes so huge boards stay responsive.
    const { w: vwid, h: vhei } = Render.getSize();
    const wpx = item.w * zoom, hpx = (item.h || 60) * zoom;
    const off = sx > vwid + 200 || sy > vhei + 200 || sx + wpx < -200 || sy + hpx < -200;
    node.style.visibility = off ? 'hidden' : 'visible';
  }

  function syncTransforms() {
    if (!nodes.size) return;
    for (const item of WS.getItems()) {
      const node = nodes.get(item.id);
      if (node) syncOne(item, node);
    }
  }

  /* Pointer events off while a drawing tool is active, so strokes pass through. */
  function setInteractive(on) {
    layer().classList.toggle('nopick', !on);
  }

  function focusText(itemId, selectAll) {
    const node = nodes.get(itemId);
    if (!node) return;
    const target = node.querySelector('.textedit') || node.querySelector('.todo-title');
    if (!target) return;
    if (!target.isContentEditable) target.setAttribute('contenteditable', 'true');
    target.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(!selectAll);
    if (selectAll) range.selectNodeContents(target);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const isEditing = () => editingId !== null;
  const getNode = (itemId) => nodes.get(itemId) || null;

  function blurEditing() {
    if (!editingId) return;
    const active = document.activeElement;
    if (active && active.blur) active.blur();
    editingId = null;
  }

  return {
    rebuild, addNode, removeNode, refreshStyle, syncTransforms, syncOne,
    setInteractive, focusText, beginFreeEdit, isEditing, blurEditing, getNode, measure, measureAll
  };
})();
