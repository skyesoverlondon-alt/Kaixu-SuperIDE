/*
  search.js — Workspace-wide search/replace panel with results, regex, case, whole-word
  Depends on: db.js, ui.js, editor.js
*/

var _searchResults = []; // [{path, matches:[{line,col,text,matchStart,matchLen}]}]

// ─── Panel toggle ──────────────────────────────────────────────────────────
function openSearchPanel() {
  const panel = document.getElementById('search-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  document.getElementById('search-input')?.focus();
}

function closeSearchPanel() {
  document.getElementById('search-panel')?.classList.add('hidden');
}

// ─── Build regex from inputs ───────────────────────────────────────────────
function _buildPattern(raw) {
  const useRegex = document.getElementById('sp-regex')?.checked;
  const caseSensitive = document.getElementById('sp-case')?.checked;
  const wholeWord = document.getElementById('sp-word')?.checked;
  const flags = 'g' + (caseSensitive ? '' : 'i');
  let src = useRegex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = '\\b' + src + '\\b';
  try { return new RegExp(src, flags); }
  catch (e) { toast('Invalid regex: ' + e.message, 'error'); return null; }
}

// ─── Web worker for background search ─────────────────────────────────────
var _searchWorker = null;
var _searchWorkerResolve = null;

function _getSearchWorker() {
  if (_searchWorker) return _searchWorker;
  try {
    _searchWorker = new Worker('search.worker.js');
    _searchWorker.onmessage = (e) => {
      if (e.data.type === 'results' && _searchWorkerResolve) {
        const resolve = _searchWorkerResolve;
        _searchWorkerResolve = null;
        resolve(e.data.results);
      } else if (e.data.type === 'progress') {
        const container = document.getElementById('search-results');
        if (container && !container.querySelector('.search-summary')) {
          const prog = container.querySelector('.search-progress') ||
            Object.assign(document.createElement('div'), { className: 'search-progress', style: 'color:#888;font-size:11px;padding:4px' });
          prog.textContent = `Searching… ${e.data.done}/${e.data.total} files`;
          if (!prog.parentNode) container.prepend(prog);
        }
      }
    };
    _searchWorker.onerror = () => { _searchWorker = null; };
  } catch {
    _searchWorker = null;
  }
  return _searchWorker;
}

// ─── Run search ────────────────────────────────────────────────────────────
async function runSearch() {
  const raw = document.getElementById('sp-query')?.value || '';
  if (!raw) return;
  const pattern = _buildPattern(raw);
  if (!pattern) return;

  const files = await listFiles();
  const container = document.getElementById('search-results');
  if (container) container.innerHTML = '<div style="color:#888;font-size:12px;padding:4px">Searching…</div>';

  const options = {
    useRegex: document.getElementById('sp-regex')?.checked || false,
    caseSensitive: document.getElementById('sp-case')?.checked || false,
    wholeWord: document.getElementById('sp-word')?.checked || false,
  };

  // Try off-main-thread with web worker first
  const worker = _getSearchWorker();
  if (worker) {
    try {
      const results = await new Promise((resolve, reject) => {
        _searchWorkerResolve = resolve;
        const timer = setTimeout(() => { _searchWorkerResolve = null; reject(new Error('Worker timeout')); }, 10000);
        worker.postMessage({ type: 'search', files: files.map(f => ({ path: f.path, content: f.content || '' })), query: raw, options });
      });
      _searchResults = results;
      _renderSearchResults();
      return;
    } catch {
      // Fall through to synchronous search
    }
  }

  // Synchronous fallback
  _searchResults = [];
  for (const f of files) {
    const content = f.content || '';
    if (content.startsWith('__b64__:')) continue;
    const lines = content.split('\n');
    const fileMatches = [];
    lines.forEach((line, lineIdx) => {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        fileMatches.push({ line: lineIdx + 1, col: m.index + 1, text: line, matchStart: m.index, matchLen: m[0].length });
        if (!pattern.global) break;
      }
    });
    if (fileMatches.length) _searchResults.push({ path: f.path, matches: fileMatches });
  }
  _renderSearchResults();
}

// ─── Render results ────────────────────────────────────────────────────────
function _renderSearchResults() {
  const container = document.getElementById('search-results');
  if (!container) return;

  const total = _searchResults.reduce((s, f) => s + f.matches.length, 0);
  if (!total) {
    container.innerHTML = '<div class="search-summary">No matches found.</div>';
    return;
  }

  container.innerHTML = `<div class="search-summary">${total} match${total !== 1 ? 'es' : ''} in ${_searchResults.length} file${_searchResults.length !== 1 ? 's' : ''}</div>`;

  _searchResults.forEach(({ path, matches }) => {
    const group = document.createElement('div');
    group.className = 'search-file-group';

    const header = document.createElement('div');
    header.className = 'search-file-name';
    header.textContent = `${path} (${matches.length})`;
    header.addEventListener('click', () => openFileInEditor(path, activePane));
    group.appendChild(header);

    matches.forEach(({ line, col, text, matchStart, matchLen }) => {
      const row = document.createElement('div');
      row.className = 'search-match';

      const lineNum = document.createElement('span');
      lineNum.className = 'search-line-num';
      lineNum.textContent = line + ':';

      const preview = document.createElement('span');
      const before = _escHtml(text.slice(0, matchStart));
      const match  = _escHtml(text.slice(matchStart, matchStart + matchLen));
      const after  = _escHtml(text.slice(matchStart + matchLen));
      preview.innerHTML = `${before}<mark>${match}</mark>${after}`;

      row.appendChild(lineNum);
      row.appendChild(preview);
      row.addEventListener('click', async () => {
        await openFileInEditor(path, activePane);
        // Scroll editor to line
        setTimeout(() => {
          const tab = tabs.find(t => t.path === path && t.pane === activePane);
          if (!tab) return;
          const ta = document.getElementById('editor-' + activePane);
          if (!ta) return;
          const lines = ta.value.split('\n');
          let charPos = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
          ta.focus();
          ta.setSelectionRange(charPos + matchStart, charPos + matchStart + matchLen);
          // Rough scroll to line
          const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
          ta.scrollTop = Math.max(0, (line - 5) * lineHeight);
        }, 100);
      });

      group.appendChild(row);
    });

    container.appendChild(group);
  });
}

function _escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Replace all in workspace ──────────────────────────────────────────────
async function replaceAll() {
  const raw = document.getElementById('sp-query')?.value || '';
  const replaceVal = document.getElementById('sp-replace')?.value || '';
  if (!raw) return;
  const pattern = _buildPattern(raw);
  if (!pattern) return;

  const files = await listFiles();
  let count = 0;
  for (const f of files) {
    const content = f.content || '';
    if (content.startsWith('__b64__:')) continue;
    const newContent = content.replace(pattern, replaceVal);
    if (newContent !== content) {
      await writeFile(f.path, newContent);
      count++;
      // If this file is open in a tab, update the textarea
      tabs.filter(t => t.path === f.path).forEach(t => {
        const ta = document.getElementById('editor-' + t.pane);
        if (ta && !ta.classList.contains('hidden')) ta.value = newContent;
      });
    }
    pattern.lastIndex = 0;
  }

  await refreshFileTree();
  toast(`Replaced in ${count} file${count !== 1 ? 's' : ''}`);
  await runSearch();
}

// ─── Replace in active file only ───────────────────────────────────────────
async function replaceInFile() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) { toast('No file active', 'error'); return; }

  const raw = document.getElementById('sp-query')?.value || '';
  const replaceVal = document.getElementById('sp-replace')?.value || '';
  if (!raw) return;
  const pattern = _buildPattern(raw);
  if (!pattern) return;

  const ta = document.getElementById('editor-' + tab.pane);
  if (!ta) return;
  const original = ta.value;
  const replaced = original.replace(pattern, replaceVal);
  ta.value = replaced;
  await writeFile(tab.path, replaced);
  tab.dirty = false;
  _renderTabBar(tab.pane);
  toast(`Replaced in ${tab.path}`);
  await runSearch();
}

// ─── Init ──────────────────────────────────────────────────────────────────
function initSearch() {
  document.getElementById('search-panel-btn')?.addEventListener('click', openSearchPanel);
  document.getElementById('sp-close')?.addEventListener('click', closeSearchPanel);
  document.getElementById('sp-search')?.addEventListener('click', runSearch);
  document.getElementById('sp-replace-all')?.addEventListener('click', replaceAll);

  // Run on Enter in search input
  document.getElementById('sp-query')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
    if (e.key === 'Escape') closeSearchPanel();
  });
}
