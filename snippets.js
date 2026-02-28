/*
  snippets.js — Snippet manager: built-in + user snippets, Tab expansion, CRUD modal
  Depends on: db.js, ui.js
  Exposes: initSnippets(), openSnippetsModal(), expandSnippetAtCursor(ta, ext)
*/

// ─── Built-in snippets ────────────────────────────────────────────────────
var BUILT_IN_SNIPPETS = [
  // JavaScript / TypeScript
  { id: 'b-cl',       prefix: 'cl',       language: 'js',     name: 'console.log',      body: 'console.log($1);$0',                                      description: 'console.log(…)' },
  { id: 'b-fn',       prefix: 'fn',        language: 'js',     name: 'function',          body: 'function $1($2) {\n\t$0\n}',                              description: 'Named function' },
  { id: 'b-afn',      prefix: 'afn',       language: 'js',     name: 'Arrow function',    body: 'const $1 = ($2) => {\n\t$0\n};',                          description: 'Arrow function' },
  { id: 'b-asyncfn',  prefix: 'asyncfn',   language: 'js',     name: 'Async function',    body: 'async function $1($2) {\n\t$0\n}',                        description: 'Async function' },
  { id: 'b-iife',     prefix: 'iife',      language: 'js',     name: 'IIFE',              body: '(function () {\n\t$0\n})();',                             description: 'Immediately invoked fn' },
  { id: 'b-cls',      prefix: 'cls',       language: 'js',     name: 'class',             body: 'class $1 {\n\tconstructor($2) {\n\t\t$0\n\t}\n}',         description: 'ES6 class' },
  { id: 'b-imp',      prefix: 'imp',       language: 'js',     name: 'import',            body: "import $1 from '$2';$0",                                 description: 'ES module import' },
  { id: 'b-fori',     prefix: 'fori',      language: 'js',     name: 'for index loop',    body: 'for (let $1i = 0; $1i < $2arr.length; $1i++) {\n\t$0\n}', description: 'for (i) loop' },
  { id: 'b-fore',     prefix: 'fore',      language: 'js',     name: 'for..of',           body: 'for (const $1item of $2arr) {\n\t$0\n}',                 description: 'for..of loop' },
  { id: 'b-tc',       prefix: 'tc',        language: 'js',     name: 'try/catch',         body: 'try {\n\t$1\n} catch ($2e) {\n\t$0\n}',                  description: 'try / catch block' },
  { id: 'b-prom',     prefix: 'prom',      language: 'js',     name: 'Promise',           body: 'new Promise((resolve, reject) => {\n\t$0\n});',           description: 'new Promise' },
  { id: 'b-ael',      prefix: 'ael',       language: 'js',     name: 'addEventListener',  body: "$1el.addEventListener('$2click', ($3e) => {\n\t$0\n});",  description: 'addEventListener' },
  { id: 'b-fetch',    prefix: 'fet',       language: 'js',     name: 'fetch + await',     body: "const res = await fetch('$1');\nconst data = await res.json();\n$0", description: 'fetch JSON' },
  { id: 'b-qs',       prefix: 'qs',        language: 'js',     name: 'querySelector',     body: "document.querySelector('$1')",                            description: 'document.querySelector' },
  { id: 'b-qsa',      prefix: 'qsa',       language: 'js',     name: 'querySelectorAll',  body: "document.querySelectorAll('$1')",                         description: 'document.querySelectorAll' },
  { id: 'b-sw',       prefix: 'sw',        language: 'js',     name: 'switch',            body: 'switch ($1) {\n\tcase $2:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}', description: 'switch / case' },
  { id: 'b-dest',     prefix: 'dest',      language: 'js',     name: 'destructure',       body: 'const { $1 } = $2;$0',                                   description: 'Object destructure' },
  { id: 'b-spread',   prefix: 'spr',       language: 'js',     name: 'spread merge',      body: 'const $1 = { ...$2, $0 };',                              description: 'Spread object merge' },
  { id: 'b-log',      prefix: 'log',       language: 'js',     name: 'console.log (log)', body: 'console.log($1);$0',                                     description: 'console.log alias' },
  // HTML
  { id: 'b-html5',    prefix: 'html5',     language: 'html',   name: 'HTML5 boilerplate', body: '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="utf-8" />\n\t<title>$1</title>\n</head>\n<body>\n\t$0\n</body>\n</html>', description: 'HTML5 document' },
  { id: 'b-div',      prefix: 'div',       language: 'html',   name: 'div',               body: '<div class="$1">$0</div>',                               description: '<div> tag' },
  { id: 'b-link',     prefix: 'link',      language: 'html',   name: 'link stylesheet',   body: '<link rel="stylesheet" href="$1" />$0',                  description: '<link> CSS' },
  { id: 'b-scrtag',   prefix: 'script',    language: 'html',   name: 'script tag',        body: '<script src="$1"></script>$0',                           description: '<script> tag' },
  { id: 'b-img',      prefix: 'img',       language: 'html',   name: 'img',               body: '<img src="$1" alt="$2" />$0',                           description: '<img> tag' },
  { id: 'b-a',        prefix: 'a',         language: 'html',   name: 'anchor',            body: '<a href="$1">$2</a>$0',                                  description: '<a> tag' },
  { id: 'b-inp',      prefix: 'inp',       language: 'html',   name: 'input',             body: '<input type="$1text" id="$2" name="$2" />$0',            description: '<input> tag' },
  { id: 'b-btn',      prefix: 'btn',       language: 'html',   name: 'button',            body: '<button id="$1" type="button">$2</button>$0',            description: '<button> tag' },
  { id: 'b-form',     prefix: 'form',      language: 'html',   name: 'form',              body: '<form id="$1" action="$2" method="$3post">\n\t$0\n</form>', description: '<form> element' },
  { id: 'b-meta',     prefix: 'meta',      language: 'html',   name: 'meta tag',          body: '<meta name="$1" content="$2" />$0',                      description: '<meta> tag' },
  // CSS
  { id: 'b-flex',     prefix: 'flex',      language: 'css',    name: 'flexbox',           body: 'display: flex;\nalign-items: $1center;\njustify-content: $2center;\n$0', description: 'Flexbox' },
  { id: 'b-grid',     prefix: 'grid',      language: 'css',    name: 'grid',              body: 'display: grid;\ngrid-template-columns: $1;\ngap: $2;\n$0', description: 'CSS Grid' },
  { id: 'b-media',    prefix: 'media',     language: 'css',    name: '@media',            body: '@media ($1) {\n\t$0\n}',                                 description: 'Media query' },
  { id: 'b-cssvar',   prefix: 'var',       language: 'css',    name: 'CSS variable',      body: 'var(--$1)$0',                                            description: 'var(--custom)' },
  { id: 'b-kf',       prefix: 'kf',        language: 'css',    name: '@keyframes',        body: '@keyframes $1 {\n\tfrom { $2 }\n\tto { $0 }\n}',        description: 'Keyframe animation' },
  { id: 'b-tr',       prefix: 'tr',        language: 'css',    name: 'transition',        body: 'transition: $1all $2.3s ease;$0',                       description: 'transition' },
  { id: 'b-shadow',   prefix: 'shadow',    language: 'css',    name: 'box-shadow',        body: 'box-shadow: $10 $24px $316px rgba(0,0,0,.2);$0',        description: 'box-shadow' },
  { id: 'b-reset',    prefix: 'reset',     language: 'css',    name: 'CSS reset',         body: '*, *::before, *::after {\n\tbox-sizing: border-box;\n}\nbody {\n\tmargin: 0;\n\t$0\n}', description: 'Box-sizing reset' },
  // Python
  { id: 'b-pydef',    prefix: 'def',       language: 'python', name: 'function def',      body: 'def $1($2):\n    $0',                                    description: 'Python function' },
  { id: 'b-pycls',    prefix: 'class',     language: 'python', name: 'class',             body: 'class $1:\n    def __init__(self$2):\n        $0',        description: 'Python class' },
  { id: 'b-pyifmain', prefix: 'ifmain',    language: 'python', name: 'if __main__',       body: "if __name__ == '__main__':\n    $0",                     description: 'if __main__ guard' },
  { id: 'b-pyfor',    prefix: 'for',       language: 'python', name: 'for loop',          body: 'for $1item in $2items:\n    $0',                         description: 'Python for loop' },
  { id: 'b-pytry',    prefix: 'try',       language: 'python', name: 'try/except',        body: 'try:\n    $1\nexcept $2Exception as e:\n    $0',          description: 'try / except' },
  { id: 'b-pylist',   prefix: 'lc',        language: 'python', name: 'list comprehension',body: '[$1 for $2 in $3]$0',                                    description: 'List comprehension' },
  { id: 'b-pyfstr',   prefix: 'fs',        language: 'python', name: 'f-string',          body: "f'$1{$2}$3'$0",                                          description: 'f-string' },
];

// ─── Storage ──────────────────────────────────────────────────────────────
var _userSnippets = []; // loaded from IndexedDB

async function _loadUserSnippets() {
  _userSnippets = (await getMeta('userSnippets', [])) || [];
}

async function _saveUserSnippets() {
  await setMeta('userSnippets', _userSnippets);
}

function _allSnippets() {
  return [...BUILT_IN_SNIPPETS, ..._userSnippets];
}

// ─── Language resolution ───────────────────────────────────────────────────
function _extToLang(ext) {
  const map = {
    js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
    html: 'html', htm: 'html', svg: 'html',
    css: 'css', scss: 'css', sass: 'css', less: 'css',
    py: 'python',
    md: 'md', markdown: 'md',
  };
  return map[ext] || ext;
}

// ─── Tab-stop body parser ─────────────────────────────────────────────────
/*
  Parses a snippet body with $N and ${N:placeholder} markers.
  Returns: { text: string, stops: [{num, start, end}] sorted by num }
  - $0 is the final cursor position (no selection)
  - $N becomes empty string in text; ${N:ph} becomes ph
*/
function _parseBody(body) {
  // Replace \t with actual tab (will be converted based on settings later)
  let text = body;
  const stops = [];

  // Process ${N:placeholder} first (greedy match)
  text = text.replace(/\$\{(\d+):([^}]*)\}/g, (_, n, ph) => {
    const num = parseInt(n);
    stops.push({ num, ph: ph || '' });
    return '\x01' + num + '\x01'; // sentinel
  });
  // Then $N bare
  text = text.replace(/\$(\d+)/g, (_, n) => {
    const num = parseInt(n);
    if (!stops.find(s => s.num === num)) stops.push({ num, ph: '' });
    return '\x01' + num + '\x01';
  });

  // Now rebuild text, replacing sentinels with placeholders and recording positions
  const result_stops = [];
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\x01') {
      // Find matching close sentinel
      const end = text.indexOf('\x01', i + 1);
      if (end === -1) { out += text[i]; i++; continue; }
      const num = parseInt(text.slice(i + 1, end));
      const stop = stops.find(s => s.num === num);
      const ph = stop ? stop.ph : '';
      const startPos = out.length;
      out += ph;
      const endPos = out.length;
      // Only record the first occurrence of each stop number
      if (!result_stops.find(s => s.num === num)) {
        result_stops.push({ num, start: startPos, end: endPos });
      }
      i = end + 1;
    } else {
      out += text[i];
      i++;
    }
  }
  result_stops.sort((a, b) => a.num - b.num);
  return { text: out, stops: result_stops };
}

// ─── Tab-stop navigation state ─────────────────────────────────────────────
var _tabStopState = null;
// { ta, stops: [{num, start, end}], stopIdx: 0, snippetStart: N, snippetLength: N }

// ─── Snippet expansion ─────────────────────────────────────────────────────
function expandSnippetAtCursor(ta, ext) {
  const lang = _extToLang(ext || '');
  const all = _allSnippets();

  // Get word before cursor
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const wordMatch = before.match(/(\S+)$/);
  if (!wordMatch) return false;
  const word = wordMatch[1];

  // Find matching snippet
  const snip = all.find(s => {
    const sLang = s.language;
    return s.prefix === word && (sLang === lang || sLang === 'js' && ['js','jsx','ts','tsx'].includes(lang) || lang.startsWith(sLang));
  }) || all.find(s => s.prefix === word); // fallback: any language

  if (!snip) return false;

  // Expand
  const indent = IDE.tabSize > 0 ? ' '.repeat(IDE.tabSize) : '\t';
  const raw = snip.body.replace(/\t/g, indent);
  const { text, stops } = _parseBody(raw);

  // Detect current line indentation for multi-line bodies
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineIndent = before.slice(lineStart).match(/^(\s*)/)[1];
  // Add line indentation to continuation lines
  const indentedText = text.split('\n').map((ln, i) => i === 0 ? ln : lineIndent + ln).join('\n');

  // Replace word with expanded snippet
  const snippetStart = pos - word.length;
  const after = ta.value.slice(pos);
  ta.value = ta.value.slice(0, snippetStart) + indentedText + after;

  // Set up tab stop state
  const nonZeroStops = stops.filter(s => s.num !== 0);
  const zeroStop = stops.find(s => s.num === 0);

  _tabStopState = {
    ta,
    stops: nonZeroStops,
    stopIdx: 0,
    snippetStart,
    snippetLength: indentedText.length,
    zeroPos: zeroStop ? snippetStart + zeroStop.start : snippetStart + indentedText.length,
  };

  // Mark tab dirty
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) { tab.dirty = true; if (typeof _renderTabBar === 'function') _renderTabBar(tab.pane); }

  // Focus first stop
  if (nonZeroStops.length > 0) {
    _jumpToStop(0);
  } else {
    const finalPos = _tabStopState.zeroPos;
    ta.setSelectionRange(finalPos, finalPos);
    _tabStopState = null;
  }
  return true;
}

function _jumpToStop(idx) {
  if (!_tabStopState) return;
  const { ta, stops, snippetStart } = _tabStopState;
  const stop = stops[idx];
  if (!stop) {
    // Done — jump to $0
    const pos = _tabStopState.zeroPos;
    ta.setSelectionRange(pos, pos);
    _tabStopState = null;
    return;
  }
  _tabStopState.stopIdx = idx;
  const start = snippetStart + stop.start;
  const end = snippetStart + stop.end;
  ta.setSelectionRange(start, end);
}

function _advanceTabStop(ta) {
  if (!_tabStopState || _tabStopState.ta !== ta) return false;
  const { stops, stopIdx } = _tabStopState;
  const next = stopIdx + 1;
  if (next >= stops.length) {
    // Jump to $0
    const pos = _tabStopState.zeroPos;
    ta.setSelectionRange(pos, pos);
    _tabStopState = null;
  } else {
    // Recalculate: how much text was typed in the current stop?
    const curStop = stops[stopIdx];
    const curStart = _tabStopState.snippetStart + curStop.start;
    const curEnd = ta.selectionStart; // current cursor position after typing
    const typed = curEnd - curStart;
    // Shift all subsequent stops by delta
    const delta = typed - (curStop.end - curStop.start);
    for (let i = next; i < stops.length; i++) {
      stops[i].start += delta;
      stops[i].end += delta;
    }
    curStop.end = curStop.start + typed;
    _tabStopState.zeroPos += delta;
    _jumpToStop(next);
  }
  return true;
}

// ─── Snippet CRUD modal ────────────────────────────────────────────────────
var _editingSnippetId = null;

function openSnippetsModal() {
  const modal = document.getElementById('snippets-modal');
  if (modal) {
    modal.classList.remove('hidden');
    _renderSnippetsList('');
    _clearSnippetForm();
  }
}

function closeSnippetsModal() {
  document.getElementById('snippets-modal')?.classList.add('hidden');
}

function _renderSnippetsList(q) {
  const ul = document.getElementById('snippets-list');
  if (!ul) return;
  const query = (q || '').toLowerCase();
  const all = _allSnippets().filter(s =>
    !query ||
    s.prefix.toLowerCase().includes(query) ||
    s.name.toLowerCase().includes(query) ||
    s.language.includes(query)
  );
  ul.innerHTML = '';
  all.forEach(snip => {
    const li = document.createElement('div');
    li.className = 'snippet-row' + (snip.id.startsWith('b-') ? ' builtin' : '');
    li.innerHTML =
      `<span class="snip-prefix">${snip.prefix}</span>` +
      `<span class="snip-lang">${snip.language}</span>` +
      `<span class="snip-name">${snip.name}</span>` +
      (!snip.id.startsWith('b-') ? `<button class="snip-edit-btn" data-id="${snip.id}">Edit</button><button class="snip-del-btn" data-id="${snip.id}">✕</button>` : '');
    li.querySelector('.snip-edit-btn')?.addEventListener('click', () => _editSnippet(snip.id));
    li.querySelector('.snip-del-btn')?.addEventListener('click', async () => {
      _userSnippets = _userSnippets.filter(s => s.id !== snip.id);
      await _saveUserSnippets();
      _renderSnippetsList(document.getElementById('snippets-search')?.value || '');
    });
    ul.appendChild(li);
  });
}

function _editSnippet(id) {
  const snip = _userSnippets.find(s => s.id === id);
  if (!snip) return;
  _editingSnippetId = id;
  document.getElementById('snip-name').value = snip.name || '';
  document.getElementById('snip-prefix').value = snip.prefix || '';
  document.getElementById('snip-lang').value = snip.language || 'js';
  document.getElementById('snip-desc').value = snip.description || '';
  document.getElementById('snip-body').value = snip.body || '';
}

function _clearSnippetForm() {
  _editingSnippetId = null;
  ['snip-name', 'snip-prefix', 'snip-desc', 'snip-body'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const lang = document.getElementById('snip-lang');
  if (lang) lang.value = 'js';
}

async function _saveSnippetForm() {
  const name   = document.getElementById('snip-name')?.value.trim();
  const prefix = document.getElementById('snip-prefix')?.value.trim();
  const lang   = document.getElementById('snip-lang')?.value || 'js';
  const desc   = document.getElementById('snip-desc')?.value.trim();
  const body   = document.getElementById('snip-body')?.value;

  if (!prefix || !body) { toast('Prefix and body are required', 'error'); return; }

  if (_editingSnippetId) {
    const snip = _userSnippets.find(s => s.id === _editingSnippetId);
    if (snip) { snip.name = name; snip.prefix = prefix; snip.language = lang; snip.description = desc; snip.body = body; }
  } else {
    _userSnippets.push({
      id: 'u-' + Date.now(),
      name: name || prefix,
      prefix, language: lang, description: desc, body,
    });
  }
  await _saveUserSnippets();
  _clearSnippetForm();
  _renderSnippetsList(document.getElementById('snippets-search')?.value || '');
  toast('Snippet saved', 'success');
}

async function exportSnippetsJSON() {
  const data = JSON.stringify(_userSnippets, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'kaixu-snippets.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Snippets exported');
}

async function importSnippetsJSON(file) {
  try {
    const text = await file.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('Expected array');
    // Merge: avoid duplicates by id
    arr.forEach(s => {
      if (!_userSnippets.find(u => u.id === s.id)) _userSnippets.push(s);
    });
    await _saveUserSnippets();
    _renderSnippetsList('');
    toast(`Imported ${arr.length} snippet(s)`, 'success');
  } catch (e) {
    toast('Import failed: ' + e.message, 'error');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────
function initSnippets() {
  _loadUserSnippets();

  // Tab key handler on all editor textareas
  document.querySelectorAll('.editor-area').forEach(ta => _bindTabKey(ta));

  // Also bind on dynamic pane creation (handled via delegation on editor-container)
  document.getElementById('editor-container')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const ta = e.target;
    if (!ta.classList.contains('editor-area')) return;
    // If in snippet tab-stop nav, advance
    if (_tabStopState && _tabStopState.ta === ta) {
      e.preventDefault();
      _advanceTabStop(ta);
      return;
    }
    // Try expansion
    const tab = tabs.find(t => t.id === activeTabId);
    const ext = tab ? tab.path.split('.').pop().toLowerCase() : '';
    const expanded = expandSnippetAtCursor(ta, ext);
    if (expanded) {
      e.preventDefault();
    } else {
      // Default: insert tab/spaces
      e.preventDefault();
      const indent = ' '.repeat(IDE.tabSize);
      const start = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + indent + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + indent.length;
      // Mark dirty
      if (tab) { tab.dirty = true; if (typeof _renderTabBar === 'function') _renderTabBar(tab.pane); }
    }
  }, true); // capture so it fires before other keydown handlers

  // Modal bindings
  document.getElementById('snippets-close')?.addEventListener('click', closeSnippetsModal);
  document.getElementById('snippets-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'snippets-modal') closeSnippetsModal();
  });
  document.getElementById('snippets-search')?.addEventListener('input', (e) => {
    _renderSnippetsList(e.target.value);
  });
  document.getElementById('snip-save-btn')?.addEventListener('click', _saveSnippetForm);
  document.getElementById('snip-clear-btn')?.addEventListener('click', _clearSnippetForm);
  document.getElementById('snip-export-btn')?.addEventListener('click', exportSnippetsJSON);
  document.getElementById('snip-import-btn')?.addEventListener('click', () => {
    document.getElementById('snip-import-file')?.click();
  });
  document.getElementById('snip-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await importSnippetsJSON(file);
    e.target.value = '';
  });

  // Command palette entry
  if (typeof COMMANDS !== 'undefined') {
    COMMANDS.push({
      group: 'Settings', id: 'snippets', label: 'Manage Snippets…', kb: '',
      action: openSnippetsModal,
    });
  }
}

function _bindTabKey(ta) {
  // This is now handled via delegation above; just a no-op placeholder
  // kept for clarity that per-element binding is not needed
}
