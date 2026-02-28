/*
  commands.js — Command palette (Ctrl+Shift+P), Go-to-line (Ctrl+G), all keybindings
  Depends on: db.js, ui.js, editor.js, explorer.js, search.js
*/

// ─── Command registry ──────────────────────────────────────────────────────
var COMMANDS = [
  // Editor
  { group: 'Editor', id: 'save',         label: 'Save File',            kb: 'Ctrl+S',       action: () => _cmdSave() },
  { group: 'Editor', id: 'saveAll',      label: 'Save All',             kb: 'Ctrl+Shift+S', action: () => _cmdSaveAll() },
  { group: 'Editor', id: 'closeTab',     label: 'Close Tab',            kb: 'Ctrl+W',       action: () => { if (activeTabId) closeTab(activeTabId); } },
  { group: 'Editor', id: 'gotoLine',     label: 'Go to Line…',          kb: 'Ctrl+G',       action: () => openGotoLine() },
  { group: 'Editor', id: 'splitPane',    label: 'Toggle Split Pane',    kb: 'Ctrl+\\',      action: () => toggleSplit() },
  { group: 'Editor', id: 'focusPane0',   label: 'Focus Left Pane',      kb: 'Ctrl+1',       action: () => _focusPane(0) },
  { group: 'Editor', id: 'focusPane1',   label: 'Focus Right Pane',     kb: 'Ctrl+2',       action: () => _focusPane(1) },
  // Files
  { group: 'File',   id: 'newFile',      label: 'New File',             kb: 'Ctrl+N',       action: () => document.getElementById('new-file')?.click() },
  { group: 'File',   id: 'uploadFiles',  label: 'Upload Files',                             action: () => document.getElementById('file-upload')?.click() },
  { group: 'File',   id: 'uploadFolder', label: 'Upload Folder',                            action: () => document.getElementById('folder-upload')?.click() },
  { group: 'File',   id: 'exportZip',    label: 'Export ZIP',                               action: () => exportWorkspaceZip() },
  // View
  { group: 'View',   id: 'togglePreview',label: 'Toggle Preview',       kb: 'Ctrl+P',       action: () => document.getElementById('preview-toggle')?.click() },
  { group: 'View',   id: 'search',       label: 'Search in Workspace',  kb: 'Ctrl+Shift+F', action: () => openSearchPanel() },
  { group: 'View',   id: 'tabFiles',     label: 'Show Files Tab',                           action: () => typeof setActiveTab === 'function' && setActiveTab('files') },
  { group: 'View',   id: 'tabChat',      label: 'Show Chat Tab',                            action: () => typeof setActiveTab === 'function' && setActiveTab('chat') },
  { group: 'View',   id: 'tabSCM',       label: 'Show Source Control',                      action: () => typeof setActiveTab === 'function' && setActiveTab('scm') },
  // Settings
  { group: 'Settings', id: 'settings',   label: 'Open Settings',                            action: () => openSettings() },
  { group: 'Settings', id: 'shortcuts',  label: 'Keyboard Shortcuts',                       action: () => openSettings() },
];

var _paletteVisible = false;
var _paletteSelected = 0;
var _paletteFiltered = [];

// ─── Open palette ──────────────────────────────────────────────────────────
async function openCommandPalette() {
  const modal = document.getElementById('cmd-palette');
  const input = document.getElementById('cmd-input');
  if (!modal || !input) return;

  modal.classList.remove('hidden');
  input.value = '';
  _paletteSelected = 0;
  _paletteVisible = true;

  // Build list: commands + recent files fast-switch
  const recentFiles = getRecentFiles ? getRecentFiles() : [];
  _paletteFiltered = [
    ...recentFiles.map(p => ({
      group: 'Recent Files',
      id: 'file:' + p,
      label: p,
      kb: '',
      action: () => openFileInEditor(p, activePane)
    })),
    ...COMMANDS
  ];

  _renderPalette('');
  input.focus();
}

function closeCommandPalette() {
  document.getElementById('cmd-palette')?.classList.add('hidden');
  _paletteVisible = false;
}

function _renderPalette(query) {
  const list = document.getElementById('cmd-list');
  if (!list) return;

  const q = query.toLowerCase();
  _paletteFiltered = [
    ...COMMANDS,
    ...(getRecentFiles ? getRecentFiles().map(p => ({
      group: 'Recent Files', id: 'file:' + p, label: p, kb: '',
      action: () => openFileInEditor(p, activePane)
    })) : [])
  ].filter(c => !q || c.label.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q));

  list.innerHTML = '';
  let lastGroup = '';
  _paletteFiltered.forEach((cmd, i) => {
    if (cmd.group !== lastGroup) {
      lastGroup = cmd.group;
      const gh = document.createElement('div');
      gh.className = 'cmd-group-header';
      gh.textContent = lastGroup;
      list.appendChild(gh);
    }
    const el = document.createElement('div');
    el.className = 'cmd-item' + (i === _paletteSelected ? ' selected' : '');
    el.innerHTML = `<span class="cmd-label">${_highlight(cmd.label, q)}</span>${cmd.kb ? `<span class="cmd-kb">${cmd.kb}</span>` : ''}`;
    el.addEventListener('click', () => { closeCommandPalette(); cmd.action(); });
    el.dataset.idx = i;
    list.appendChild(el);
  });
}

function _highlight(text, q) {
  if (!q) return _escHtml2(text);
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return _escHtml2(text);
  return _escHtml2(text.slice(0, idx)) + '<mark style="background:rgba(187,49,255,.3);color:#f5f5f5;border-radius:2px">' + _escHtml2(text.slice(idx, idx + q.length)) + '</mark>' + _escHtml2(text.slice(idx + q.length));
}
function _escHtml2(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _movePaletteSelection(dir) {
  _paletteSelected = Math.max(0, Math.min(_paletteFiltered.length - 1, _paletteSelected + dir));
  document.querySelectorAll('#cmd-list .cmd-item').forEach((el, i) => {
    el.classList.toggle('selected', i === _paletteSelected);
    if (i === _paletteSelected) el.scrollIntoView({ block: 'nearest' });
  });
}

function _executePaletteSelection() {
  const cmd = _paletteFiltered[_paletteSelected];
  if (cmd) { closeCommandPalette(); cmd.action(); }
}

// ─── Go to Line ────────────────────────────────────────────────────────────
function openGotoLine() {
  const modal = document.getElementById('goto-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const input = document.getElementById('goto-input');
  if (input) { input.value = ''; input.focus(); }
}

function closeGotoLine() {
  document.getElementById('goto-modal')?.classList.add('hidden');
}

function executeGotoLine() {
  const val = document.getElementById('goto-input')?.value || '';
  const [lineStr, colStr] = val.split(':');
  const line = parseInt(lineStr);
  const col  = parseInt(colStr) || 1;
  if (!line || isNaN(line)) { toast('Enter a valid line number', 'error'); return; }

  const ta = document.getElementById('editor-' + activePane);
  if (!ta || ta.classList.contains('hidden')) { closeGotoLine(); return; }

  const lines = ta.value.split('\n');
  if (line < 1 || line > lines.length) { toast(`Line ${line} out of range (1–${lines.length})`, 'error'); return; }

  const charPos = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0) + (col - 1);
  ta.focus();
  ta.setSelectionRange(charPos, charPos);
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (line - 5) * lineHeight);
  closeGotoLine();
}

// ─── cmd helpers ───────────────────────────────────────────────────────────
async function _cmdSave() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const ta = document.getElementById('editor-' + tab.pane);
  if (ta && !ta.classList.contains('hidden')) {
    await writeFile(tab.path, ta.value);
    tab.dirty = false;
    _renderTabBar(tab.pane);
    await refreshFileTree();
    toast('Saved ' + tab.path.split('/').pop());
  }
}

async function _cmdSaveAll() {
  for (const tab of tabs) {
    const ta = document.getElementById('editor-' + tab.pane);
    if (ta && !ta.classList.contains('hidden')) {
      await writeFile(tab.path, ta.value);
      tab.dirty = false;
    }
  }
  [0, 1].forEach(p => _renderTabBar(p));
  await refreshFileTree();
  toast('All files saved');
}

function _focusPane(pane) {
  activePane = pane;
  const ta = document.getElementById('editor-' + pane);
  if (ta && !ta.classList.contains('hidden')) ta.focus();
}

// ─── Global keybindings ────────────────────────────────────────────────────
function initCommands() {
  // Command palette bindings
  const input = document.getElementById('cmd-input');
  if (input) {
    input.addEventListener('input', () => _renderPalette(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); _movePaletteSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _movePaletteSelection(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); _executePaletteSelection(); }
      else if (e.key === 'Escape') closeCommandPalette();
    });
  }

  document.getElementById('cmd-palette')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCommandPalette();
  });

  // Go-to-line bindings
  document.getElementById('goto-confirm')?.addEventListener('click', executeGotoLine);
  document.getElementById('goto-cancel')?.addEventListener('click', closeGotoLine);
  document.getElementById('goto-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeGotoLine();
    if (e.key === 'Escape') closeGotoLine();
  });

  // Command palette button
  document.getElementById('cmd-palette-btn')?.addEventListener('click', openCommandPalette);

  // Format button
  document.getElementById('format-btn')?.addEventListener('click', formatDocument);

  // ── Global keyboard shortcuts ──
  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault(); openCommandPalette(); return;
    }
    if (ctrl && e.key.toLowerCase() === 'g') {
      e.preventDefault(); openGotoLine(); return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault(); openSearchPanel(); return;
    }
    if (ctrl && e.key === '\\') {
      e.preventDefault(); toggleSplit(); return;
    }
    if (ctrl && e.key === '1') {
      e.preventDefault(); _focusPane(0); return;
    }
    if (ctrl && e.key === '2') {
      e.preventDefault(); _focusPane(1); return;
    }
    if (ctrl && e.key.toLowerCase() === 's' && !e.shiftKey) {
      e.preventDefault(); _cmdSave(); return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault(); _cmdSaveAll(); return;
    }
    if (ctrl && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'n') {
      e.preventDefault(); document.getElementById('new-file')?.click(); return;
    }
    if (ctrl && e.key.toLowerCase() === 'p' && !e.shiftKey) {
      // Only if command palette not open
      if (!_paletteVisible) { e.preventDefault(); document.getElementById('preview-toggle')?.click(); }
      return;
    }
    if (e.key === 'Escape') {
      if (_paletteVisible) { closeCommandPalette(); return; }
      closeSearchPanel();
      closeGotoLine();
    }
    // Shift+Alt+F — format
    if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault(); formatDocument(); return;
    }
  });
}

// ─── Format document (basic re-indent) ────────────────────────────────────
function formatDocument() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const ta = document.getElementById('editor-' + tab.pane);
  if (!ta || ta.classList.contains('hidden')) return;

  const ext = tab.path.split('.').pop().toLowerCase();
  let text = ta.value;

  if (ext === 'json') {
    try {
      text = JSON.stringify(JSON.parse(text), null, IDE.tabSize);
      ta.value = text;
      tab.dirty = true;
      _renderTabBar(tab.pane);
      toast('Formatted JSON');
    } catch (e) {
      toast('Invalid JSON — cannot format', 'error');
    }
    return;
  }

  // For JS/CSS/HTML: normalize indentation (tabs → spaces, leading whitespace normalized)
  const indent = ' '.repeat(IDE.tabSize);
  const lines = text.split('\n').map(line => {
    const stripped = line.replace(/^\t+/, match => indent.repeat(match.length));
    return stripped;
  });
  ta.value = lines.join('\n');
  tab.dirty = true;
  _renderTabBar(tab.pane);
  toast('Formatted');
}
