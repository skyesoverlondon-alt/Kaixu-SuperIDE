/*
  outline.js — Symbols / Outline panel (Phase 4)
  Parses the active file client-side using regex patterns per language.
  Exposes: initOutline(), updateOutline(content, path)
*/

// ─── Symbol parser per language ───────────────────────────────────────────

function _parseSymbols(content, path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const lines = content.split('\n');
  const symbols = [];

  function addSym(line, col, kind, name) {
    if (name) symbols.push({ line, col, kind, name });
  }

  if (['js', 'mjs', 'ts', 'tsx', 'jsx'].includes(ext)) {
    lines.forEach((l, i) => {
      let m;
      // class Foo / class Foo extends Bar
      if ((m = l.match(/^\s*(?:export\s+)?(?:default\s+)?class\s+([\w$]+)/)))
        addSym(i + 1, m.index, 'class', m[1]);
      // function foo(  / async function foo(
      else if ((m = l.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/)))
        addSym(i + 1, 0, 'function', m[1]);
      // const/let/var foo = (...) => / = function
      else if ((m = l.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:\(|[\w$]+\s*=>|function)/)))
        addSym(i + 1, 0, 'const', m[1]);
      // method inside class: foo( or async foo(
      else if ((m = l.match(/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([\w$]+)\s*\([^)]*\)\s*\{/)))
        if (!['if', 'for', 'while', 'switch', 'catch'].includes(m[1]))
          addSym(i + 1, 0, 'method', m[1]);
    });
  } else if (ext === 'py') {
    lines.forEach((l, i) => {
      let m;
      if ((m = l.match(/^class\s+([\w]+)/))) addSym(i + 1, 0, 'class', m[1]);
      else if ((m = l.match(/^\s*(?:async\s+)?def\s+([\w]+)/))) addSym(i + 1, 0, 'function', m[1]);
    });
  } else if (['css', 'scss', 'less'].includes(ext)) {
    lines.forEach((l, i) => {
      let m;
      // Skip blank/comment
      if (!l.trim() || l.trim().startsWith('//') || l.trim().startsWith('*')) return;
      if ((m = l.match(/^(@[\w-]+(?:\s+[\w-]+)?)/))) addSym(i + 1, 0, 'at-rule', m[1].trim());
      else if (l.trim().endsWith('{')) {
        const sel = l.trim().replace('{', '').trim();
        if (sel) addSym(i + 1, 0, 'selector', sel.length > 40 ? sel.slice(0, 40) + '…' : sel);
      }
    });
  } else if (['html', 'htm'].includes(ext)) {
    lines.forEach((l, i) => {
      let m;
      const rx = /id="([\w-]+)"/g;
      while ((m = rx.exec(l)) !== null) addSym(i + 1, m.index, 'id', '#' + m[1]);
      const landmarks = /<(header|main|footer|nav|article|section|aside|h[1-6])\b/gi;
      let lm;
      while ((lm = landmarks.exec(l)) !== null)
        addSym(i + 1, lm.index, 'landmark', '<' + lm[1].toLowerCase() + '>');
    });
  } else if (['json', 'jsonc'].includes(ext)) {
    // Top-level keys
    lines.forEach((l, i) => {
      const m = l.match(/^\s{0,4}"([\w$-]+)"\s*:/);
      if (m) addSym(i + 1, 0, 'key', m[1]);
    });
  } else if (['md', 'markdown'].includes(ext)) {
    lines.forEach((l, i) => {
      const m = l.match(/^(#{1,6})\s+(.+)/);
      if (m) addSym(i + 1, 0, 'heading' + m[1].length, m[2].trim());
    });
  }

  return symbols;
}

// ─── Kind → icon + colour ─────────────────────────────────────────────────
const _kindMeta = {
  class:    { icon: 'C', color: '#ffd65a' },
  function: { icon: 'ƒ', color: '#a259ff' },
  method:   { icon: 'M', color: '#c084fc' },
  const:    { icon: 'v', color: '#7dd3fc' },
  selector: { icon: '.', color: '#34d399' },
  'at-rule':{ icon: '@', color: '#fb923c' },
  id:       { icon: '#', color: '#f87171' },
  landmark: { icon: '❖', color: '#94a3b8' },
  key:      { icon: 'k', color: '#e2e8f0' },
  heading1: { icon: 'H1', color: '#ffd65a' },
  heading2: { icon: 'H2', color: '#e2e8f0' },
  heading3: { icon: 'H3', color: '#94a3b8' },
  heading4: { icon: 'H4', color: '#64748b' },
  heading5: { icon: 'H5', color: '#475569' },
  heading6: { icon: 'H6', color: '#334155' },
};

// ─── Render ───────────────────────────────────────────────────────────────

function _renderOutlinePanel(symbols, content) {
  const panel = document.getElementById('outline-list') || document.getElementById('outline-pane');
  if (!panel) return;

  if (!symbols.length) {
    panel.innerHTML = '<div class="outline-empty">No symbols found</div>';
    return;
  }

  panel.innerHTML = '';
  const filter = document.getElementById('outline-filter');
  const q = filter ? filter.value.toLowerCase() : '';
  const filtered = q ? symbols.filter(s => s.name.toLowerCase().includes(q)) : symbols;

  filtered.forEach(sym => {
    const meta = _kindMeta[sym.kind] || { icon: '•', color: '#94a3b8' };
    const row = document.createElement('div');
    row.className = 'outline-row';
    row.innerHTML =
      `<span class="outline-icon" style="color:${meta.color}">${meta.icon}</span>` +
      `<span class="outline-name">${sym.name}</span>` +
      `<span class="outline-line">:${sym.line}</span>`;

    row.addEventListener('click', () => {
      // Find the active pane textarea and jump to line
      const tab = (typeof tabs !== 'undefined') && tabs.find(t => t.id === activeTabId);
      if (!tab) return;
      const ta = document.getElementById('editor-' + tab.pane);
      if (!ta) return;
      const lines = ta.value.split('\n');
      let pos = 0;
      for (let i = 0; i < sym.line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos + (lines[sym.line - 1] || '').length);
      // Scroll into view
      const lineH = parseInt(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, (sym.line - 5) * lineH);
      toast(`Jumped to ${sym.kind} "${sym.name}" (line ${sym.line})`);
    });
    panel.appendChild(row);
  });
}

// Public: called by editor.js after loading a file
function updateOutline(content, path) {
  const symbols = _parseSymbols(content || '', path || '');
  _renderOutlinePanel(symbols, content);
  // Store for filter re-renders
  if (typeof window._outlineCache !== 'undefined') {
    window._outlineCache = { symbols, content, path };
  }
  window._outlineCache = { symbols, content, path };
}

// ─── Init ─────────────────────────────────────────────────────────────────
function initOutline() {
  const filterEl = document.getElementById('outline-filter');
  if (filterEl) {
    filterEl.addEventListener('input', () => {
      if (window._outlineCache) {
        _renderOutlinePanel(window._outlineCache.symbols, window._outlineCache.content);
      }
    });
  }

  // Register command — "Open Outline Panel" (no keybinding; Ctrl+Shift+O is Go-to-Symbol in commands.js)
  if (typeof COMMANDS !== 'undefined') {
    COMMANDS.push({
      id: 'open-outline',
      label: 'Open Outline Panel',
      group: 'View',
      kb: '',
      action: () => setActiveTab('outline'),
    });
  }
}
