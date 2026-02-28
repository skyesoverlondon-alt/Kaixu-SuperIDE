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
  const useRegex = document.getElementById('search-regex')?.checked;
  const caseSensitive = document.getElementById('search-case')?.checked;
  const wholeWord = document.getElementById('search-word')?.checked;
  const flags = 'g' + (caseSensitive ? '' : 'i');
  let src = useRegex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = '\\b' + src + '\\b';
  try { return new RegExp(src, flags); }
  catch (e) { toast('Invalid regex: ' + e.message, 'error'); return null; }
}

// ─── Run search ────────────────────────────────────────────────────────────
async function runSearch() {
  const raw = document.getElementById('search-input')?.value || '';
  if (!raw) return;
  const pattern = _buildPattern(raw);
  if (!pattern) return;

  const files = await listFiles();
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
  const raw = document.getElementById('search-input')?.value || '';
  const replaceVal = document.getElementById('replace-input')?.value || '';
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

  const raw = document.getElementById('search-input')?.value || '';
  const replaceVal = document.getElementById('replace-input')?.value || '';
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
  document.getElementById('search-close-btn')?.addEventListener('click', closeSearchPanel);
  document.getElementById('search-btn')?.addEventListener('click', runSearch);
  document.getElementById('replace-btn')?.addEventListener('click', replaceAll);
  document.getElementById('replace-file-btn')?.addEventListener('click', replaceInFile);

  // Run on Enter in search input
  document.getElementById('search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
    if (e.key === 'Escape') closeSearchPanel();
  });
}
