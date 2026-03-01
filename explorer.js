/*
  explorer.js — File tree, context menu (rename/duplicate/delete/move), breadcrumbs, drag-and-drop
  Depends on: db.js, ui.js, editor.js
*/

// ─── Drag-and-drop state ───────────────────────────────────────────────────
var _dragSrcPath = null;       // path being dragged
var _dragOverEl  = null;       // last element receiving dragover (for cleanup)

// ─── Build tree structure ──────────────────────────────────────────────────
function buildFileTree(files) {
  const root = {};
  files.forEach(({ path }) => {
    const parts = path.split('/');
    let node = root;
    parts.forEach((part, idx) => {
      if (!node[part]) node[part] = { __children: {} };
      if (idx === parts.length - 1) node[part].__file = path;
      node = node[part].__children;
    });
  });
  return root;
}

// ─── Render tree ───────────────────────────────────────────────────────────
function renderFileTree(treeData, container) {
  container.innerHTML = '';
  const ul = document.createElement('ul');

  function renderNode(node, parentUl, depth, folderPath) {
    const sortedKeys = Object.keys(node).sort((a, b) => {
      const aIsFolder = !node[a].__file && Object.keys(node[a].__children).length > 0;
      const bIsFolder = !node[b].__file && Object.keys(node[b].__children).length > 0;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.localeCompare(b);
    });

    sortedKeys.forEach((key) => {
      const entry = node[key];
      const li = document.createElement('li');
      li.style.paddingLeft = (depth * 12) + 'px';

      if (entry.__file) {
        // ── File entry ──
        const row = document.createElement('div');
        row.className = 'tree-row';
        row.dataset.path = entry.__file;

        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = _fileIcon(entry.__file);

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'tree-cb';
        cb.checked = selectedPaths && selectedPaths.has(entry.__file);
        cb.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!window.selectedPaths) window.selectedPaths = new Set();
          if (cb.checked) window.selectedPaths.add(entry.__file);
          else window.selectedPaths.delete(entry.__file);
        });

        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = key;
        name.title = entry.__file;

        row.appendChild(cb);
        row.appendChild(icon);
        row.appendChild(name);
        li.appendChild(row);
        li.dataset.path = entry.__file;

        // Click → open
        row.addEventListener('click', (e) => {
          if (e.target === cb) return;
          openFileInEditor(entry.__file, activePane);
          _highlightActive(entry.__file);
        });

        // Right-click → context menu
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          _showFileContextMenu(entry.__file, e.clientX, e.clientY);
        });

        // ── Drag-and-drop ──
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          _dragSrcPath = entry.__file;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', entry.__file);
          row.classList.add('tree-dragging');
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('tree-dragging');
          _clearDropIndicators();
          _dragSrcPath = null;
        });
        row.addEventListener('dragover', (e) => {
          if (!_dragSrcPath || _dragSrcPath === entry.__file) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          _clearDropIndicators();
          _dragOverEl = row;
          // Determine above/below by cursor position
          const rect = row.getBoundingClientRect();
          const half = rect.top + rect.height / 2;
          if (e.clientY < half) {
            row.classList.add('tree-drop-above');
          } else {
            row.classList.add('tree-drop-below');
          }
        });
        row.addEventListener('dragleave', () => {
          row.classList.remove('tree-drop-above', 'tree-drop-below');
          if (_dragOverEl === row) _dragOverEl = null;
        });
        row.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          _clearDropIndicators();
          const src = _dragSrcPath;
          _dragSrcPath = null;
          if (!src || src === entry.__file) return;
          // Move dragged file into same folder as target file
          const destFolder = entry.__file.includes('/')
            ? entry.__file.slice(0, entry.__file.lastIndexOf('/'))
            : '';
          const srcName = src.split('/').pop();
          const destPath = destFolder ? destFolder + '/' + srcName : srcName;
          if (destPath === src) return;
          await _moveFileTo(src, destPath);
        });

      } else {
        // ── Folder entry ──
        const row = document.createElement('div');
        row.className = 'tree-row tree-folder';
        const fp = folderPath ? folderPath + '/' + key : key;

        const arrow = document.createElement('span');
        arrow.className = 'tree-arrow';
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = '📁';
        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = key;

        row.appendChild(arrow);
        row.appendChild(icon);
        row.appendChild(name);
        li.appendChild(row);

        const childUl = document.createElement('ul');
        renderNode(entry.__children, childUl, depth + 1, fp);
        li.appendChild(childUl);

        // Toggle collapse
        let collapsed = false;
        arrow.textContent = '▾';
        row.addEventListener('click', () => {
          collapsed = !collapsed;
          childUl.style.display = collapsed ? 'none' : '';
          arrow.textContent = collapsed ? '▸' : '▾';
        });

        // Right-click folder → folder context menu
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          _showFolderContextMenu(fp, e.clientX, e.clientY);
        });

        // ── Folder drag target ──
        row.addEventListener('dragover', (e) => {
          if (!_dragSrcPath) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          _clearDropIndicators();
          _dragOverEl = row;
          row.classList.add('tree-drop-folder');
        });
        row.addEventListener('dragleave', () => {
          row.classList.remove('tree-drop-folder');
          if (_dragOverEl === row) _dragOverEl = null;
        });
        row.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          _clearDropIndicators();
          const src = _dragSrcPath;
          _dragSrcPath = null;
          if (!src) return;
          const srcName = src.split('/').pop();
          const destPath = fp + '/' + srcName;
          if (destPath === src) return;
          await _moveFileTo(src, destPath);
        });
      }

      parentUl.appendChild(li);
    });
  }

  renderNode(treeData, ul, 0, '');
  container.appendChild(ul);
  _highlightActive(window.currentFile);
}

async function refreshFileTree() {
  const files = await listFiles();
  const tree = buildFileTree(files);
  const container = document.getElementById('file-tree');
  if (container) renderFileTree(tree, container);
}

function _highlightActive(path) {
  document.querySelectorAll('#file-tree .tree-row').forEach((row) => {
    row.classList.toggle('selected', !!path && row.dataset.path === path);
  });
}

// ─── Drag helper: clear all visual drop indicators ─────────────────────────
function _clearDropIndicators() {
  document.querySelectorAll('#file-tree .tree-drop-above, #file-tree .tree-drop-below, #file-tree .tree-drop-folder').forEach(el => {
    el.classList.remove('tree-drop-above', 'tree-drop-below', 'tree-drop-folder');
  });
  _dragOverEl = null;
}

// ─── Drag helper: move file and refresh ────────────────────────────────────
async function _moveFileTo(srcPath, destPath) {
  if (!srcPath || !destPath || srcPath === destPath) return;
  await renameFile(srcPath, destPath);
  // Update any open tabs
  tabs.forEach(t => { if (t.path === srcPath) t.path = destPath; });
  [0, 1].forEach(p => _renderTabBar(p));
  await refreshFileTree();
  toast(`Moved → ${destPath}`);
}

// ─── File icons ────────────────────────────────────────────────────────────
function _fileIcon(path) {
  const ext = path.split('.').pop().toLowerCase();
  const icons = {
    js: '🟨', ts: '🔷', html: '🟧', css: '🎨', json: '🔵',
    md: '📝', svg: '🖼', png: '🖼', jpg: '🖼', jpeg: '🖼',
    gif: '🖼', webp: '🖼', pdf: '📄', csv: '📊', txt: '📄',
    zip: '🗜', sh: '⚙', py: '🐍', xml: '📋',
  };
  return icons[ext] || '📄';
}

// ─── File context menu ─────────────────────────────────────────────────────
function _showFileContextMenu(path, x, y) {
  showContextMenu(x, y, [
    { icon: '✏️', label: 'Rename', action: () => _renameFilePrompt(path) },
    { icon: '📋', label: 'Duplicate', action: () => _duplicateFileAction(path) },
    'sep',
    { icon: '📂', label: 'Move to…', action: () => _moveFilePrompt(path) },
    'sep',
    { icon: '⬛', label: 'Open in split pane', action: () => { toggleSplit(true); openFileInEditor(path, 1); } },
    'sep',
    { icon: '⬇️', label: 'Download', action: () => _downloadFile(path) },
    'sep',
    { icon: '🗑', label: 'Delete', action: () => _deleteFileAction(path) },
  ]);
}

function _showFolderContextMenu(folderPath, x, y) {
  showContextMenu(x, y, [
    { icon: '📄', label: 'New file here', action: () => _newFileInFolder(folderPath) },
  ]);
}

// ─── Rename ────────────────────────────────────────────────────────────────
async function _renameFilePrompt(path) {
  const newName = prompt('Rename to:', path);
  if (!newName || newName === path) return;
  const newPath = newName.trim();
  if (!newPath) return;
  await renameFile(path, newPath);

  // Update any open tabs pointing at old path
  tabs.forEach(t => { if (t.path === path) t.path = newPath; });
  // Re-render tab bars
  [0, 1].forEach(p => _renderTabBar(p));

  await refreshFileTree();
  toast(`Renamed → ${newPath}`);
}

async function _duplicateFileAction(path) {
  const newPath = await duplicateFile(path);
  await refreshFileTree();
  await openFileInEditor(newPath, activePane);
  toast(`Duplicated → ${newPath}`);
}

async function _deleteFileAction(path) {
  if (!confirm(`Delete "${path}"? This cannot be undone.`)) return;
  // Close open tabs for this file
  tabs.filter(t => t.path === path).forEach(t => closeTab(t.id, true));
  await deleteFile(path);
  await refreshFileTree();
  toast(`Deleted ${path}`, 'error');
}

async function _moveFilePrompt(path) {
  const dest = prompt('Move to path (full path):', path);
  if (!dest || dest === path) return;
  await renameFile(path, dest.trim());
  tabs.forEach(t => { if (t.path === path) t.path = dest.trim(); });
  [0, 1].forEach(p => _renderTabBar(p));
  await refreshFileTree();
  toast(`Moved → ${dest.trim()}`);
}

async function _downloadFile(path) {
  const content = await readFile(path);
  let blob, filename = path.split('/').pop();
  if (content.startsWith('__b64__:')) {
    const bin = Uint8Array.from(atob(content.slice(8)), c => c.charCodeAt(0));
    blob = new Blob([bin]);
  } else {
    blob = new Blob([content], { type: 'text/plain' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function _newFileInFolder(folderPath) {
  const name = prompt('New file name:');
  if (!name) return;
  const fullPath = folderPath ? folderPath + '/' + name.trim() : name.trim();
  await writeFile(fullPath, '');
  await refreshFileTree();
  await openFileInEditor(fullPath, activePane);
}

// ─── Init ──────────────────────────────────────────────────────────────────
function initExplorer() {
  refreshFileTree();
}
