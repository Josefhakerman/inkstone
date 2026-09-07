'use strict';

/* The workspace tree (folders + workspaces) and its on-disk persistence. */

const Store = (() => {

  const TREE_VERSION = 1;

  let tree = null;          // { version, root, lastOpen }
  const listeners = new Set();

  function defaultTree() {
    return {
      version: TREE_VERSION,
      lastOpen: null,
      root: { id: 'root', type: 'folder', name: 'All workspaces', expanded: true, children: [] }
    };
  }

  /* ------------------------------------------------------------- access */

  const getTree = () => tree;
  const getRoot = () => tree.root;

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { for (const fn of listeners) fn(); }

  /* Depth-first walk. cb(node, parent, depth); return false to skip children. */
  function walk(node, cb, parent = null, depth = 0) {
    const keepGoing = cb(node, parent, depth);
    if (keepGoing === false) return;
    if (node.children) for (const c of node.children.slice()) walk(c, cb, node, depth + 1);
  }

  function find(id, node = tree.root) {
    if (node.id === id) return node;
    if (node.children) {
      for (const c of node.children) {
        const hit = find(id, c);
        if (hit) return hit;
      }
    }
    return null;
  }

  function findParent(id, node = tree.root) {
    if (!node.children) return null;
    for (const c of node.children) {
      if (c.id === id) return node;
      const hit = findParent(id, c);
      if (hit) return hit;
    }
    return null;
  }

  /* Folder names from root down to (but excluding) the node itself. */
  function pathOf(id) {
    const parts = [];
    let p = findParent(id);
    while (p && p.id !== 'root') { parts.unshift(p.name); p = findParent(p.id); }
    return parts;
  }

  function isDescendant(ancestorId, id) {
    let p = findParent(id);
    while (p) {
      if (p.id === ancestorId) return true;
      p = findParent(p.id);
    }
    return false;
  }

  function allWorkspaces() {
    const out = [];
    walk(tree.root, (n) => {
      if (n.type === 'workspace') out.push({ id: n.id, name: n.name, path: pathOf(n.id) });
    });
    return out;
  }

  function workspaceCount(node) {
    let n = 0;
    walk(node, (x) => { if (x.type === 'workspace') n++; });
    return n;
  }

  /* -------------------------------------------------------- mutations */

  /* Where new items land: inside `refId` if it is a folder, else beside it. */
  function resolveParent(refId) {
    if (!refId) return tree.root;
    const node = find(refId);
    if (!node) return tree.root;
    if (node.type === 'folder') return node;
    return findParent(refId) || tree.root;
  }

  function createFolder(refId, name) {
    const parent = resolveParent(refId);
    const node = { id: U.uid('f'), type: 'folder', name: name || 'New folder', expanded: true, children: [] };
    parent.children.push(node);
    parent.expanded = true;
    save();
    return node;
  }

  function createWorkspace(refId, name) {
    const parent = resolveParent(refId);
    const node = { id: U.uid('w'), type: 'workspace', name: name || 'Untitled workspace' };
    parent.children.push(node);
    parent.expanded = true;
    save();
    return node;
  }

  function rename(id, name) {
    const n = find(id);
    if (!n || !name) return false;
    n.name = name;
    save();
    return true;
  }

  function setExpanded(id, open) {
    const n = find(id);
    if (!n || n.type !== 'folder') return;
    n.expanded = !!open;
    save();
  }

  /* Removes a subtree; returns the workspace ids that went with it. */
  function remove(id) {
    if (id === 'root') return [];
    const parent = findParent(id);
    const node = find(id);
    if (!parent || !node) return [];
    const removed = [];
    walk(node, (n) => { if (n.type === 'workspace') removed.push(n.id); });
    parent.children = parent.children.filter((c) => c.id !== id);
    if (tree.lastOpen && removed.includes(tree.lastOpen)) tree.lastOpen = null;
    save();
    return removed;
  }

  /* Move `id` into `targetParentId` at `index` (index null = append). */
  function move(id, targetParentId, index = null) {
    if (id === 'root' || id === targetParentId) return false;
    if (isDescendant(id, targetParentId)) return false;   // no moving a folder into itself
    const node = find(id);
    const target = find(targetParentId);
    if (!node || !target || target.type !== 'folder') return false;

    const oldParent = findParent(id);
    if (!oldParent) return false;
    const oldIndex = oldParent.children.indexOf(node);
    oldParent.children.splice(oldIndex, 1);

    let at = index === null ? target.children.length : index;
    if (oldParent === target && oldIndex < at) at--;
    at = U.clamp(at, 0, target.children.length);
    target.children.splice(at, 0, node);
    target.expanded = true;
    save();
    return true;
  }

  function duplicateEntry(node, parent, index) {
    parent.children.splice(index, 0, node);
    save();
  }

  function setLastOpen(id) {
    if (tree.lastOpen === id) return;
    tree.lastOpen = id;
    save();
  }

  /* ------------------------------------------------------ persistence */

  const saveNow = async () => {
    try { await window.api.saveTree(tree); }
    catch (err) { console.error('tree save failed', err); U.toast('Could not save the workspace list'); }
  };
  const saveDebounced = U.debounce(() => { saveNow(); }, 250);

  function save() {
    emit();
    saveDebounced();
  }

  function flush() { saveDebounced.flush(); }

  /* Repairs anything odd in a loaded file so a bad edit can't brick the app. */
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || !raw.root) return defaultTree();
    const seen = new Set();
    const fixNode = (n, isRoot) => {
      if (!n || typeof n !== 'object') return null;
      const type = n.type === 'workspace' ? 'workspace' : 'folder';
      let id = typeof n.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(n.id) ? n.id : null;
      if (isRoot) id = 'root';
      if (!id || seen.has(id)) id = U.uid(type === 'workspace' ? 'w' : 'f');
      seen.add(id);
      const node = { id, type, name: typeof n.name === 'string' && n.name ? n.name : 'Untitled' };
      if (type === 'folder') {
        node.expanded = n.expanded !== false;
        node.children = Array.isArray(n.children)
          ? n.children.map((c) => fixNode(c, false)).filter(Boolean)
          : [];
      }
      return node;
    };
    const root = fixNode(raw.root, true);
    root.type = 'folder';
    if (!root.children) root.children = [];
    return {
      version: TREE_VERSION,
      lastOpen: typeof raw.lastOpen === 'string' ? raw.lastOpen : null,
      root
    };
  }

  async function load() {
    let raw = null;
    try { raw = await window.api.loadTree(); }
    catch (err) { console.error('tree load failed', err); }
    tree = sanitize(raw);
    if (!raw) {
      // First run: give the user somewhere to land instead of a blank slate.
      const ws = { id: U.uid('w'), type: 'workspace', name: 'My first workspace' };
      tree.root.children.push(ws);
      tree.lastOpen = ws.id;
      await saveNow();
    }
    emit();
    return tree;
  }

  return {
    load, save, flush, onChange,
    getTree, getRoot, find, findParent, pathOf, isDescendant,
    allWorkspaces, workspaceCount, walk,
    createFolder, createWorkspace, rename, remove, move, setExpanded, setLastOpen, duplicateEntry
  };
})();
