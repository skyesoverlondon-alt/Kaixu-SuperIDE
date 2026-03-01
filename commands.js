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
  { group: 'Settings', id: 'shortcuts',  label: 'Keyboard Shortcuts',   kb: 'Ctrl+Shift+K', action: () => openShortcutsModal() },
  // Navigate
  { group: 'Navigate', id: 'gotoSymbol', label: 'Go to Symbol…',        kb: 'Ctrl+Shift+O', action: () => openGotoSymbol() },
  // GitHub
  { group: 'GitHub',   id: 'ghPush',     label: 'Push to GitHub',       kb: 'Ctrl+Shift+G', action: () => typeof ghPush === 'function' && ghPush() },
  // AI / RAG
  { group: 'AI',       id: 'syncEmbed',      label: 'Index Codebase for AI (RAG)',      action: () => typeof syncEmbeddings === 'function' && syncEmbeddings() },
  { group: 'AI',       id: 'billing',        label: 'Plans & Billing',                  action: () => typeof openBillingModal === 'function' && openBillingModal() },
  { group: 'AI',       id: 'invoices',       label: 'View Invoice History',             action: () => { if (typeof openBillingModal === 'function') openBillingModal(); } },
  // File
  { group: 'File',     id: 'clientBundle',   label: 'Export Client Bundle (ZIP + Report)', action: () => typeof exportClientBundle === 'function' && exportClientBundle() },
  // Admin
  { group: 'Admin',    id: 'soc2Export',     label: 'Export SOC 2 Evidence Pack',       action: () => typeof adminExportSoc2 === 'function' && adminExportSoc2() },
];

var _paletteVisible = false;
var _paletteSelected = 0;
var _paletteFiltered = [];

// ─── Keybinding conflict detection ────────────────────────────────────────
function _normalizeKb(kb) {
  return String(kb || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/control/g, 'ctrl')
    .replace(/command/g, 'ctrl')
    .replace(/meta/g, 'ctrl')
    .replace(/option/g, 'alt');
}

function checkKeybindingConflicts() {
  const byKb = new Map();
  for (const cmd of COMMANDS) {
    const raw = cmd.kb || cmd.keybinding || '';
    if (!raw) continue;
    const norm = _normalizeKb(raw);
    if (!norm) continue;
    if (!byKb.has(norm)) byKb.set(norm, []);
    byKb.get(norm).push(cmd);
  }

  const conflicts = Array.from(byKb.entries()).filter(([, arr]) => arr.length > 1);
  if (!conflicts.length) return [];

  conflicts.forEach(([kb, arr]) => {
    const labels = arr.map(c => c.label || c.id).join(' | ');
    console.warn(`[kAIxU] Keybinding conflict on "${kb}": ${labels}`);
  });

  if (typeof toast === 'function') {
    toast(`Keybinding conflicts detected (${conflicts.length}) — check console`, 'error');
  }
  return conflicts;
}

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

// ─── Go-to-Symbol modal ────────────────────────────────────────────────────
var _gotoSymSelected = 0;
var _gotoSymFiltered = [];

function openGotoSymbol() {
  const modal = document.getElementById('goto-symbol-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const input = document.getElementById('goto-symbol-input');
  if (input) { input.value = ''; input.focus(); }
  _gotoSymSelected = 0;
  _renderGotoSymbolList('');
}

function closeGotoSymbol() {
  document.getElementById('goto-symbol-modal')?.classList.add('hidden');
}

function _renderGotoSymbolList(query) {
  const symbols = (window._outlineCache?.symbols) || [];
  const q = query.toLowerCase();
  _gotoSymFiltered = q
    ? symbols.filter(s => s.name.toLowerCase().includes(q))
    : symbols;

  const list = document.getElementById('goto-symbol-list');
  if (!list) return;
  list.innerHTML = '';

  if (!_gotoSymFiltered.length) {
    list.innerHTML = '<div class="goto-sym-empty">No symbols found in current file</div>';
    return;
  }

  _gotoSymFiltered.forEach((sym, i) => {
    const kindIcons = { class:'C', function:'ƒ', method:'M', const:'v', selector:'.', 'at-rule':'@', id:'#', landmark:'❖', key:'k', heading1:'H1', heading2:'H2', heading3:'H3', heading4:'H4', heading5:'H5', heading6:'H6' };
    const row = document.createElement('div');
    row.className = 'goto-sym-row' + (i === _gotoSymSelected ? ' selected' : '');
    row.innerHTML =
      `<span class="goto-sym-kind">${kindIcons[sym.kind] || '•'}</span>` +
      `<span class="goto-sym-name">${_escHtml2(sym.name)}</span>` +
      `<span class="goto-sym-line">:${sym.line}</span>`;
    row.addEventListener('click', () => { _gotoSymSelected = i; _executeGotoSymbol(); });
    list.appendChild(row);
  });
}

function _moveGotoSymSelection(dir) {
  _gotoSymSelected = Math.max(0, Math.min(_gotoSymFiltered.length - 1, _gotoSymSelected + dir));
  document.querySelectorAll('#goto-symbol-list .goto-sym-row').forEach((el, i) => {
    el.classList.toggle('selected', i === _gotoSymSelected);
    if (i === _gotoSymSelected) el.scrollIntoView({ block: 'nearest' });
  });
}

function _executeGotoSymbol() {
  const sym = _gotoSymFiltered[_gotoSymSelected];
  if (!sym) return;
  closeGotoSymbol();
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const ta = document.getElementById('editor-' + tab.pane);
  if (!ta || ta.classList.contains('hidden')) return;
  const lines = ta.value.split('\n');
  let pos = 0;
  for (let i = 0; i < sym.line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(pos, pos + (lines[sym.line - 1] || '').length);
  const lineH = parseInt(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (sym.line - 5) * lineH);
  toast(`Jumped to ${sym.kind} "${sym.name}" (line ${sym.line})`);
}

// ─── Keyboard Shortcuts modal ──────────────────────────────────────────────
function openShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const filterEl = document.getElementById('shortcuts-filter');
  if (filterEl) { filterEl.value = ''; filterEl.focus(); }
  _renderShortcutsTable('');
}

function closeShortcutsModal() {
  document.getElementById('shortcuts-modal')?.classList.add('hidden');
}

function _renderShortcutsTable(query) {
  const tbody = document.getElementById('shortcuts-tbody');
  if (!tbody) return;
  const q = query.toLowerCase();

  // Gather all commands that have a keybinding
  const rows = COMMANDS.filter(c => c.kb && (!q || c.label.toLowerCase().includes(q) || c.kb.toLowerCase().includes(q)));

  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="2" style="opacity:.5;text-align:center;padding:12px">No matches</td></tr>';
    return;
  }
  rows.forEach(cmd => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><kbd>${_escHtml2(cmd.kb)}</kbd></td><td>${_escHtml2(cmd.label)}</td>`;
    tbody.appendChild(tr);
  });
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

  // Go-to-Symbol bindings
  const gotoSymInput = document.getElementById('goto-symbol-input');
  if (gotoSymInput) {
    gotoSymInput.addEventListener('input', () => {
      _gotoSymSelected = 0;
      _renderGotoSymbolList(gotoSymInput.value);
    });
    gotoSymInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); _moveGotoSymSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _moveGotoSymSelection(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); _executeGotoSymbol(); }
      else if (e.key === 'Escape') closeGotoSymbol();
    });
  }
  document.getElementById('goto-symbol-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeGotoSymbol();
  });

  // Keyboard Shortcuts modal bindings
  const shortcutsFilter = document.getElementById('shortcuts-filter');
  if (shortcutsFilter) {
    shortcutsFilter.addEventListener('input', () => _renderShortcutsTable(shortcutsFilter.value));
    shortcutsFilter.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShortcutsModal(); });
  }
  document.getElementById('shortcuts-close')?.addEventListener('click', closeShortcutsModal);
  document.getElementById('shortcuts-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeShortcutsModal();
  });

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
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault(); openGotoSymbol(); return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault(); openShortcutsModal(); return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'v') {
      if (typeof openPasteModal === 'function') {
        e.preventDefault(); openPasteModal();
      }
      return;
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
      closeGotoSymbol();
      closeShortcutsModal();
    }
    // Shift+Alt+F — format
    if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault(); formatDocument(); return;
    }
  });

  // Run once now; app.js runs it again after all modules finish registering commands.
  checkKeybindingConflicts();
}

// ─── Format document ──────────────────────────────────────────────────────
function formatDocument(silent) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const ta = document.getElementById('editor-' + tab.pane);
  if (!ta || ta.classList.contains('hidden')) return;

  const ext = tab.path.split('.').pop().toLowerCase();
  let text = ta.value;
  let formatted = text;

  try {
    if (ext === 'json') {
      formatted = JSON.stringify(JSON.parse(text), null, IDE.tabSize);
    } else if (['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'].includes(ext)) {
      formatted = _formatJS(text, IDE.tabSize);
    } else if (['css', 'scss', 'less'].includes(ext)) {
      formatted = _formatCSS(text, IDE.tabSize);
    } else if (['html', 'htm'].includes(ext)) {
      formatted = _formatHTML(text, IDE.tabSize);
    } else if (['md', 'markdown'].includes(ext)) {
      formatted = _formatMarkdown(text);
    } else {
      // Generic: normalize tabs → spaces + strip trailing whitespace
      const ind = ' '.repeat(IDE.tabSize);
      formatted = text.split('\n').map(l =>
        l.replace(/^\t+/, m => ind.repeat(m.length)).replace(/\s+$/, '')
      ).join('\n');
    }
  } catch (e) {
    if (!silent) toast('Format error: ' + e.message, 'error');
    return;
  }

  if (formatted === text) { if (!silent) toast('Already formatted'); return; }
  // Preserve scroll position
  const scroll = ta.scrollTop;
  ta.value = formatted;
  ta.scrollTop = scroll;
  tab.dirty = true;
  _renderTabBar(tab.pane);
  if (!silent) toast('Formatted');
}

// ─── JS / TS formatter (brace-depth re-indenter) ──────────────────────────
function _formatJS(src, tabSize) {
  const ind = ' '.repeat(tabSize);
  // Tokenize to track string/comment regions so we don't count braces inside them
  const tokens = []; // {start,end,type:'str'|'comment'|'blockcomment'|'regex'}
  let i = 0, n = src.length;
  while (i < n) {
    const c = src[i];
    if ((c === '"' || c === "'") && src[i - 1] !== '\\') {
      const q = c, start = i++;
      while (i < n && (src[i] !== q || src[i - 1] === '\\')) i++;
      tokens.push({ start, end: i + 1, type: 'str' });
    } else if (c === '`') {
      const start = i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') i++;
        i++;
      }
      tokens.push({ start, end: i + 1, type: 'str' });
    } else if (src.slice(i, i + 2) === '//') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      tokens.push({ start, end: i, type: 'comment' });
    } else if (src.slice(i, i + 2) === '/*') {
      const start = i;
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      tokens.push({ start, end: i, type: 'blockcomment' });
    }
    i++;
  }
  function inToken(pos) { return tokens.some(t => pos >= t.start && pos < t.end); }

  // Count brace depth per line
  const lines = src.split('\n');
  const result = [];
  let depth = 0;
  let charPos = 0;
  for (const rawLine of lines) {
    const trimmed = rawLine.trimStart();
    // Count how many closing braces start this line before any opener  
    let closeLeading = 0;
    for (let k = 0; k < trimmed.length; k++) {
      const ch = trimmed[k];
      if (ch === '}' || ch === ')' || ch === ']') { if (!inToken(charPos + rawLine.indexOf(trimmed[k]))) closeLeading++; else break; }
      else break;
    }
    const effectiveDepth = Math.max(0, depth - closeLeading);
    result.push(trimmed.length ? ind.repeat(effectiveDepth) + trimmed.replace(/\s+$/, '') : '');
    // Count net braces in this line
    for (let k = 0; k < rawLine.length; k++) {
      const p = charPos + k;
      if (inToken(p)) continue;
      const ch = rawLine[k];
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    }
    charPos += rawLine.length + 1; // +1 for \n
  }
  return result.join('\n');
}

// ─── CSS formatter ────────────────────────────────────────────────────────
function _formatCSS(src, tabSize) {
  const ind = ' '.repeat(tabSize);
  // Tokenize into: selector { props } blocks, at-rules, comments
  const out = [];
  let i = 0, n = src.length;
  function skip() { while (i < n && /\s/.test(src[i])) i++; }
  function readBlock() {
    // reads from current pos (after opening {) to matching }
    let depth = 1, buf = '';
    while (i < n && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { if (--depth === 0) { i++; break; } }
      buf += src[i++];
    }
    return buf;
  }
  function readUntil(chars) {
    let buf = '';
    while (i < n && !chars.includes(src[i])) buf += src[i++];
    return buf.trim();
  }

  while (i < n) {
    skip();
    if (i >= n) break;
    // Comment
    if (src.slice(i, i + 2) === '/*') {
      const end = src.indexOf('*/', i + 2);
      const comment = src.slice(i, end + 2);
      out.push(comment.trim());
      i = end + 2;
      continue;
    }
    // Read selector / at-rule up to { or ;
    const sel = readUntil(['{', ';']);
    if (!sel) { i++; continue; }
    if (i < n && src[i] === ';') {
      // Standalone at-rule like @import
      out.push(sel + ';');
      i++;
    } else if (i < n && src[i] === '{') {
      i++; // consume {
      const body = readBlock();
      // Check if nested (has { inside) → at-rule with nested rules
      if (body.includes('{')) {
        out.push(sel.trim() + ' {');
        const nested = _formatCSS(body, tabSize).split('\n').map(l => ind + l);
        out.push(...nested);
        out.push('}');
      } else {
        // Regular rule
        out.push(sel.trim() + ' {');
        body.split(';').forEach(prop => {
          const p = prop.trim();
          if (p) out.push(ind + p + ';');
        });
        out.push('}');
      }
      out.push(''); // blank line between rules
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── HTML formatter ───────────────────────────────────────────────────────
function _formatHTML(src, tabSize) {
  const ind = ' '.repeat(tabSize);
  const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const INLINE = new Set(['a','abbr','acronym','b','bdo','big','br','cite','code','dfn','em','i','img','input','kbd','label','map','object','output','q','samp','select','small','span','strong','sub','sup','textarea','time','tt','var']);
  const PRESERVE = new Set(['script','style','pre','textarea']);
  const out = [];
  let depth = 0;
  const tagRe = /(<\/?[a-z][a-z0-9]*[^>]*\/?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)/gi;
  let last = 0;
  let preserveStack = [];
  for (const m of src.matchAll(tagRe)) {
    const text = src.slice(last, m.index).trim();
    if (text && preserveStack.length === 0) {
      out.push(ind.repeat(depth) + text.replace(/\s+/g, ' '));
    }
    last = m.index + m[0].length;
    const tag = m[0];
    const tagName = (tag.match(/^<\/?([a-z][a-z0-9]*)/i)?.[1] || '').toLowerCase();
    if (tag.startsWith('</')) {
      if (preserveStack.length && preserveStack[preserveStack.length - 1] === tagName) {
        preserveStack.pop();
        out.push(ind.repeat(--depth) + tag);
      } else if (!INLINE.has(tagName)) {
        depth = Math.max(0, depth - 1);
        out.push(ind.repeat(depth) + tag);
      } else {
        const prev = out[out.length - 1];
        if (prev) out[out.length - 1] = prev + tag;
        else out.push(ind.repeat(depth) + tag);
      }
    } else if (tag.startsWith('<!--') || tag.startsWith('<!')) {
      out.push(ind.repeat(depth) + tag);
    } else if (VOID.has(tagName) || tag.endsWith('/>')) {
      out.push(ind.repeat(depth) + tag);
    } else if (INLINE.has(tagName)) {
      const remaining = src.slice(last);
      const closeMatch = remaining.match(new RegExp(`^([^<]*)</${tagName}>`, 'i'));
      if (closeMatch) {
        out.push(ind.repeat(depth) + tag + closeMatch[1].trim() + `</${tagName}>`);
        last += closeMatch[0].length;
      } else {
        out.push(ind.repeat(depth) + tag);
        depth++;
      }
    } else {
      if (PRESERVE.has(tagName)) {
        preserveStack.push(tagName);
        out.push(ind.repeat(depth++) + tag);
      } else {
        out.push(ind.repeat(depth++) + tag);
      }
    }
  }
  const remainder = src.slice(last).trim();
  if (remainder) out.push(ind.repeat(Math.max(0, depth)) + remainder);
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ─── Markdown formatter ───────────────────────────────────────────────────
function _formatMarkdown(src) {
  return src
    .split('\n')
    .map(l => {
      // Ensure space after # heading markers
      const hMatch = l.match(/^(#{1,6})([^ #])/);
      if (hMatch) return hMatch[1] + ' ' + l.slice(hMatch[1].length);
      // Trim trailing whitespace (but not leading)
      return l.replace(/\s+$/, '');
    })
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n') // max 2 blank lines
    .trim();
}
