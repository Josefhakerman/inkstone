'use strict';

/* Sidebar file tree: folders + workspaces, with rename, drag-to-move and search. */

const Tree = (() => {

  const elTree = () => document.getElementById('tree');

  let activeId = null;      // workspace currently open on the canvas
  let selectedId = null;    // row with keyboard focus
  let renamingId = null;
  let filter = '';
  let onOpen = () => {};
  let onDeleted = () => {};

  let dragId = null;        // node being dragged

  /* --------------------------------------------------------- filtering */

  /* A node survives the filter if it matches, or any descendant does. */
  function matches(node) {
    if (!filter) return true;
    if (node.name.toLowerCase().includes(filter)) return true;
    if (node.children) return node.children.some(matches);
    return false;
  }

  /* ----------------------------------------------------------- render */

  function render() {
    const host = elTree();
    const scroll = host.scrollTop;
    host.innerHTML = '';

    const root = Store.getRoot();
    const visible = root.children.filter(matches);

    if (!visible.length) {
      host.appendChild(U.el('div', {
        class: 'tree-empty',
        text: filter
          ? 'Nothing matches that search.'
          : 'No workspaces yet. Use the + buttons above to create a folder or a workspace.'
      }));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const child of visible) renderNode(child, frag, 0);
    host.appendChild(frag);
    host.scrollTop = scroll;
  }

  function renderNode(node, parentEl, depth) {
    const row = buildRow(node, depth);
    parentEl.appendChild(row);

    if (node.type === 'folder') {
      // While searching, force folders open so hits are actually visible.
      const open = filter ? true : node.expanded !== false;
      if (open) {
        for (const c of node.children.filter(matches)) renderNode(c, parentEl, depth + 1);
      }
    }
  }

  function buildRow(node, depth) {
    const isFolder = node.type === 'folder';
    const open = filter ? true : node.expanded !== false;

    const row = U.el('div', {
      class: 'row' +
        (node.id === activeId ? ' active' : '') +
        (node.id === selectedId && node.id !== activeId ? ' selected' : ''),
      draggable: renamingId ? 'false' : 'true',
      style: `padding-left:${6 + depth * 13}px`,
      dataset: { id: node.id, type: node.type }
    });

    // twisty
    const tw = U.el('button', { class: 'twisty' + (isFolder ? (open ? ' open' : '') : ' leaf') });
    tw.appendChild(U.icon('chevron', 13));
    if (isFolder) {
      tw.addEventListener('click', (e) => {
        e.stopPropagation();
        if (filter) return;
        Store.setExpanded(node.id, !open);
      });
    }
    row.appendChild(tw);

    // icon
    const ic = U.el('span', { class: 'ico' });
    ic.appendChild(U.icon(isFolder ? (open ? 'folderOpen' : 'folder') : 'board', 15));
    row.appendChild(ic);

    // name (or rename input)
    if (renamingId === node.id) {
      const input = U.el('input', { class: 'rename', type: 'text', value: node.name, spellcheck: 'false' });
      const commit = (ok) => {
        if (renamingId !== node.id) return;
        renamingId = null;
        const v = input.value.trim();
        if (ok && v && v !== node.name) Store.rename(node.id, v);
        else render();
        if (node.id === activeId) App.refreshTitle();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit(true);
        else if (e.key === 'Escape') commit(false);
      });
      input.addEventListener('blur', () => commit(true));
      input.addEventListener('mousedown', (e) => e.stopPropagation());
      row.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      row.appendChild(U.el('span', { class: 'name', text: node.name, title: node.name }));
      if (isFolder) {
        const n = Store.workspaceCount(node);
        if (n) row.appendChild(U.el('span', { class: 'count', text: String(n) }));
      }
      const more = U.el('button', { class: 'rowbtn', title: 'More' });
      more.appendChild(U.icon('more', 14));
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = more.getBoundingClientRect();
        openMenu(node, r.left, r.bottom + 4);
      });
      row.appendChild(more);
    }

    /* ------------------------------------------------------ row events */

    // Update the highlight in place - a full re-render here would replace this
    // row before mouseup, and the browser would never deliver the click.
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (selectedId === node.id) return;
      selectedId = node.id;
      for (const r of elTree().querySelectorAll('.row.selected')) r.classList.remove('selected');
      if (node.id !== activeId) row.classList.add('selected');
    });

    row.addEventListener('click', () => {
      if (renamingId) return;
      if (isFolder) {
        if (!filter) Store.setExpanded(node.id, !open);
      } else if (node.id !== activeId) {
        onOpen(node.id);
      }
    });

    row.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(node.id);
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedId = node.id;
      openMenu(node, e.clientX, e.clientY);
    });

    /* -------------------------------------------------------- drag/drop */

    row.addEventListener('dragstart', (e) => {
      dragId = node.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
    });
    row.addEventListener('dragend', () => {
      dragId = null;
      clearDropMarks();
    });

    row.addEventListener('dragover', (e) => {
      if (!dragId || dragId === node.id) return;
      if (Store.isDescendant(dragId, node.id)) return;   // can't drop a folder into its own subtree
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      const r = row.getBoundingClientRect();
      const rel = (e.clientY - r.top) / r.height;
      // Folders get a middle band that means "drop inside".
      if (isFolder && rel > 0.28 && rel < 0.72) row.classList.add('droptarget');
      else if (rel < 0.5) row.classList.add('dropbefore');
      else row.classList.add('dropafter');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('droptarget', 'dropbefore', 'dropafter');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const inside = row.classList.contains('droptarget');
      const before = row.classList.contains('dropbefore');
      clearDropMarks();
      const id = dragId;
      dragId = null;
      if (!id || id === node.id) return;

      if (inside && isFolder) {
        Store.move(id, node.id, null);
      } else {
        const parent = Store.findParent(node.id) || Store.getRoot();
        const idx = parent.children.findIndex((c) => c.id === node.id);
        Store.move(id, parent.id, before ? idx : idx + 1);
      }
    });

    return row;
  }

  function clearDropMarks() {
    for (const r of elTree().querySelectorAll('.row')) {
      r.classList.remove('droptarget', 'dropbefore', 'dropafter');
    }
  }

  /* Dropping on empty sidebar space moves to the root. */
  function wireRootDrop() {
    const host = elTree();
    host.addEventListener('dragover', (e) => {
      if (!dragId) return;
      if (e.target.closest && e.target.closest('.row')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    host.addEventListener('drop', (e) => {
      if (!dragId) return;
      if (e.target.closest && e.target.closest('.row')) return;
      e.preventDefault();
      const id = dragId;
      dragId = null;
      clearDropMarks();
      Store.move(id, 'root', null);
    });
    host.addEventListener('contextmenu', (e) => {
      if (e.target.closest && e.target.closest('.row')) return;
      e.preventDefault();
      U.contextMenu(e.clientX, e.clientY, [
        { label: 'New workspace', icon: 'board', action: () => newWorkspace('root') },
        { label: 'New folder', icon: 'folder', action: () => newFolder('root') }
      ]);
    });
  }

  /* ------------------------------------------------------------ actions */

  function startRename(id) {
    renamingId = id;
    render();
  }

  async function newFolder(refId) {
    const name = await U.prompt('New folder', { placeholder: 'Folder name', okLabel: 'Create', value: 'New folder' });
    if (!name) return;
    const n = Store.createFolder(refId ?? selectedId, name);
    selectedId = n.id;
    render();
  }

  async function newWorkspace(refId) {
    const name = await U.prompt('New workspace', { placeholder: 'Workspace name', okLabel: 'Create', value: 'Untitled workspace' });
    if (!name) return;
    const n = Store.createWorkspace(refId ?? selectedId, name);
    selectedId = n.id;
    render();
    onOpen(n.id);
  }

  async function deleteNode(node) {
    const isFolder = node.type === 'folder';
    const count = isFolder ? Store.workspaceCount(node) : 0;
    const msg = isFolder
      ? (count
        ? `"${node.name}" and the ${count} workspace${count === 1 ? '' : 's'} inside it will be permanently deleted.`
        : `"${node.name}" will be permanently deleted.`)
      : `"${node.name}" and everything drawn on it will be permanently deleted.`;
    const ok = await U.confirm(isFolder ? 'Delete folder?' : 'Delete workspace?', msg);
    if (!ok) return;
    const removed = Store.remove(node.id);
    for (const id of removed) {
      try { await window.api.deleteWorkspace(id); }
      catch (err) { console.error('workspace delete failed', id, err); }
    }
    if (selectedId === node.id) selectedId = null;
    onDeleted(removed);
    render();
  }

  function openMenu(node, x, y) {
    const isFolder = node.type === 'folder';
    U.contextMenu(x, y, [
      !isFolder && { label: 'Open', icon: 'board', action: () => onOpen(node.id) },
      isFolder && { label: 'New workspace here', icon: 'board', action: () => newWorkspace(node.id) },
      isFolder && { label: 'New folder here', icon: 'folder', action: () => newFolder(node.id) },
      { sep: true },
      { label: 'Rename', icon: 'pencil', key: 'F2', action: () => startRename(node.id) },
      !isFolder && { label: 'Duplicate', icon: 'copy', action: () => duplicate(node) },
      !isFolder && { label: 'Copy link to this', icon: 'link', action: () => App.copyLinkTarget(node.id) },
      { sep: true },
      { label: 'Delete', icon: 'trash', danger: true, key: 'Del', action: () => deleteNode(node) }
    ].filter(Boolean));
  }

  async function duplicate(node) {
    const parent = Store.findParent(node.id) || Store.getRoot();
    const idx = parent.children.findIndex((c) => c.id === node.id);
    const copy = { id: U.uid('w'), type: 'workspace', name: node.name + ' copy' };
    let data = null;
    try { data = await window.api.loadWorkspace(node.id); } catch (err) { console.error(err); }
    Store.duplicateEntry(copy, parent, idx + 1);
    if (data) {
      const clone = JSON.parse(JSON.stringify(data));
      clone.id = copy.id;
      clone.name = copy.name;
      try { await window.api.saveWorkspace(copy.id, clone); } catch (err) { console.error(err); }
    }
    selectedId = copy.id;
    render();
    U.toast('Workspace duplicated');
  }

  /* --------------------------------------------------------- keyboard */

  function handleKey(e) {
    if (renamingId) return false;
    const node = selectedId ? Store.find(selectedId) : null;
    if (e.key === 'F2' && node) { startRename(node.id); return true; }
    if (e.key === 'Delete' && node && document.activeElement === elTree()) { deleteNode(node); return true; }
    return false;
  }

  /* ------------------------------------------------------------- setup */

  function init(opts) {
    onOpen = opts.onOpen || onOpen;
    onDeleted = opts.onDeleted || onDeleted;

    Store.onChange(render);
    wireRootDrop();

    document.getElementById('btnNewFolder').addEventListener('click', () => newFolder(null));
    document.getElementById('btnNewWorkspace').addEventListener('click', () => newWorkspace(null));

    const search = document.getElementById('searchInput');
    search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); render(); });
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { search.value = ''; filter = ''; render(); search.blur(); }
    });

    // Sidebar width drag.
    const resizer = document.getElementById('sideResizer');
    const sidebar = document.getElementById('sidebar');
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebar.getBoundingClientRect().width;
      const onMove = (ev) => {
        sidebar.style.width = U.clamp(startW + (ev.clientX - startX), 170, 520) + 'px';
        App.resizeCanvas();
      };
      const onUp = () => {
        removeEventListener('mousemove', onMove);
        removeEventListener('mouseup', onUp);
        try { localStorage.setItem('sidebarWidth', sidebar.style.width); } catch (_) {}
      };
      addEventListener('mousemove', onMove);
      addEventListener('mouseup', onUp);
    });
    try {
      const w = localStorage.getItem('sidebarWidth');
      if (w) sidebar.style.width = w;
    } catch (_) {}
  }

  function setActive(id) {
    activeId = id;
    selectedId = id || selectedId;
    render();
  }

  return { init, render, setActive, newFolder, newWorkspace, startRename, handleKey };
})();
