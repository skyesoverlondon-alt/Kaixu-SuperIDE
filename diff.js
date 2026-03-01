/*
  diff.js — Visual diff viewer for the kAIxU Super IDE
  Powers the commit history pane: click a commit → see what changed.
  Supports inline (unified) and side-by-side views.
  No dependencies — pure vanilla JS.
*/

/* ─── State ────────────────────────────────────────────────────────────────── */
let _diffMode = 'inline'; // 'inline' | 'split'

/* ─── Init ─────────────────────────────────────────────────────────────────── */
function initDiff() {
  // History pane is opened and _renderHistoryList() called via app.js's refreshHistory()
  // initDiff just wires any persistent UI controls (mode toggle is built dynamically)
  // Nothing additional needed here — diff.js functions are called as globals from app.js
}

/* ─── Commit list ───────────────────────────────────────────────────────────── */
async function _renderHistoryList() {
  const pane = document.getElementById('history-pane');
  if (!pane) return;

  pane.innerHTML = `
    <div class="diff-toolbar">
      <span class="diff-toolbar-title">📜 Commit History</span>
      <div class="diff-mode-btns">
        <button class="diff-mode-btn${_diffMode === 'inline' ? ' active' : ''}" data-mode="inline">Inline</button>
        <button class="diff-mode-btn${_diffMode === 'split' ? ' active' : ''}" data-mode="split">Split</button>
      </div>
    </div>
    <div id="diff-commit-list" class="diff-commit-list"></div>
    <div id="diff-detail" class="diff-detail hidden"></div>
  `;

  // Mode toggle
  pane.querySelectorAll('.diff-mode-btn').forEach(b => {
    b.addEventListener('click', () => {
      _diffMode = b.dataset.mode;
      pane.querySelectorAll('.diff-mode-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      // Re-render the currently open diff if any
      const detail = document.getElementById('diff-detail');
      const open = detail?.dataset.commitId;
      if (open && !detail.classList.contains('hidden')) {
        const cached = _commitCache.get(Number(open));
        if (cached) _renderDiff(cached);
      }
    });
  });

  // Load commits from IndexedDB
  const commits = await _loadCommits();
  const list = document.getElementById('diff-commit-list');
  if (!list) return;

  if (!commits.length) {
    list.innerHTML = '<div class="diff-empty">No commits yet. Use the Commit button to save a snapshot.</div>';
    return;
  }

  commits.forEach(c => {
    _commitCache.set(c.id, c);
    const row = document.createElement('div');
    row.className = 'diff-commit-row';
    const fileCount = Object.keys(c.diff || {}).length;
    const time = c.time ? new Date(c.time).toLocaleString() : '';
    row.innerHTML = `
      <div class="diff-commit-msg">${_esc(c.message || 'Snapshot')}</div>
      <div class="diff-commit-meta">${time} · ${fileCount} file${fileCount !== 1 ? 's' : ''}</div>
    `;
    row.addEventListener('click', () => {
      pane.querySelectorAll('.diff-commit-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      _renderDiff(c);
    });
    list.appendChild(row);
  });
}

const _commitCache = new Map();

async function _loadCommits() {
  // Use the global idbAll if available, else return []
  if (typeof idbAll === 'function') {
    const rows = await idbAll('commits');
    return rows.sort((a, b) => (b.id || 0) - (a.id || 0));
  }
  return [];
}

/* ─── Diff renderer ─────────────────────────────────────────────────────────── */
function _renderDiff(commit) {
  const detail = document.getElementById('diff-detail');
  if (!detail) return;
  detail.dataset.commitId = String(commit.id || '');
  detail.classList.remove('hidden');
  detail.innerHTML = '';

  const diff = commit.diff || {};
  const paths = Object.keys(diff);

  if (!paths.length) {
    detail.innerHTML = '<div class="diff-empty">No changes in this commit.</div>';
    return;
  }

  // Revert button
  const revertBar = document.createElement('div');
  revertBar.className = 'diff-revert-bar';
  revertBar.innerHTML = `
    <span class="diff-commit-label">📝 ${_esc(commit.message || 'Snapshot')}</span>
    <button class="diff-revert-btn" data-id="${commit.id}">↩ Revert to this</button>
  `;
  revertBar.querySelector('.diff-revert-btn').addEventListener('click', async () => {
    if (!confirm(`Revert workspace to "${commit.message || 'Snapshot'}"? Current files will be replaced.`)) return;
    if (typeof revertToCommit === 'function') {
      await revertToCommit(commit.id);
    }
  });
  detail.appendChild(revertBar);

  paths.forEach(path => {
    const rawDiff = String(diff[path] || '');
    const lines = rawDiff.split('\n');

    const section = document.createElement('div');
    section.className = 'diff-file-section';
    section.innerHTML = `<div class="diff-file-header"><span class="diff-file-icon">📄</span>${_esc(path)}</div>`;

    const content = _diffMode === 'split'
      ? _renderSplit(lines)
      : _renderInline(lines);

    section.appendChild(content);
    detail.appendChild(section);
  });
}

/* ─── Inline view ───────────────────────────────────────────────────────────── */
function _renderInline(lines) {
  const table = document.createElement('table');
  table.className = 'diff-table diff-inline';

  let oldNum = 0, newNum = 0;

  lines.forEach(line => {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
      if (line.startsWith('@@')) {
        // Parse @@ -a,b +c,d @@ to set line counters
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) { oldNum = Math.max(0, parseInt(m[1]) - 1); newNum = Math.max(0, parseInt(m[2]) - 1); }
        const tr = document.createElement('tr');
        tr.className = 'diff-hunk-header';
        tr.innerHTML = `<td colspan="3">${_esc(line)}</td>`;
        table.appendChild(tr);
      }
      return;
    }

    const tr = document.createElement('tr');
    if (line.startsWith('-')) {
      oldNum++;
      tr.className = 'diff-del';
      tr.innerHTML = `<td class="diff-ln">${oldNum}</td><td class="diff-ln"></td><td class="diff-code">${_esc(line)}</td>`;
    } else if (line.startsWith('+')) {
      newNum++;
      tr.className = 'diff-add';
      tr.innerHTML = `<td class="diff-ln"></td><td class="diff-ln">${newNum}</td><td class="diff-code">${_esc(line)}</td>`;
    } else {
      oldNum++; newNum++;
      tr.className = 'diff-ctx';
      tr.innerHTML = `<td class="diff-ln">${oldNum}</td><td class="diff-ln">${newNum}</td><td class="diff-code">${_esc(line)}</td>`;
    }
    table.appendChild(tr);
  });

  const wrap = document.createElement('div');
  wrap.className = 'diff-table-wrap';
  wrap.appendChild(table);
  return wrap;
}

/* ─── Split view ────────────────────────────────────────────────────────────── */
function _renderSplit(lines) {
  // Collect hunks: pairs of [old lines, new lines]
  const oldLines = [], newLines = [];
  let oldNum = 0, newNum = 0;

  lines.forEach(line => {
    if (line.startsWith('---') || line.startsWith('+++')) return;
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldNum = Math.max(0, parseInt(m[1]) - 1); newNum = Math.max(0, parseInt(m[2]) - 1); }
      oldLines.push({ type: 'hunk', text: line, num: '' });
      newLines.push({ type: 'hunk', text: line, num: '' });
      return;
    }
    if (line.startsWith('-')) {
      oldNum++;
      oldLines.push({ type: 'del', text: line.slice(1), num: oldNum });
      newLines.push({ type: 'empty', text: '', num: '' });
    } else if (line.startsWith('+')) {
      newNum++;
      // Replace last 'empty' on old side if possible
      const lastOld = oldLines[oldLines.length - 1];
      if (lastOld?.type === 'empty') {
        // Pair up del with add
        oldLines[oldLines.length - 1] = oldLines[oldLines.length - 1]; // keep as is
      }
      oldLines.push({ type: 'empty', text: '', num: '' });
      newLines.push({ type: 'add', text: line.slice(1), num: newNum });
    } else {
      oldNum++; newNum++;
      oldLines.push({ type: 'ctx', text: line.slice(1), num: oldNum });
      newLines.push({ type: 'ctx', text: line.slice(1), num: newNum });
    }
  });

  const wrap = document.createElement('div');
  wrap.className = 'diff-split-wrap';

  const makeCol = (linesArr, side) => {
    const table = document.createElement('table');
    table.className = `diff-table diff-split diff-split-${side}`;
    linesArr.forEach(l => {
      const tr = document.createElement('tr');
      if (l.type === 'hunk') {
        tr.className = 'diff-hunk-header';
        tr.innerHTML = `<td colspan="2">${_esc(l.text)}</td>`;
      } else if (l.type === 'empty') {
        tr.className = 'diff-empty-line';
        tr.innerHTML = `<td class="diff-ln"></td><td class="diff-code"></td>`;
      } else {
        tr.className = l.type === 'del' ? 'diff-del' : l.type === 'add' ? 'diff-add' : 'diff-ctx';
        tr.innerHTML = `<td class="diff-ln">${l.num}</td><td class="diff-code">${_esc(l.text)}</td>`;
      }
      table.appendChild(tr);
    });
    return table;
  };

  wrap.appendChild(makeCol(oldLines, 'old'));
  wrap.appendChild(makeCol(newLines, 'new'));
  return wrap;
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ─── Public API (called from app.js after refreshHistory) ─────────────────── */
function diffRefreshHistory() {
  // If history pane is open, re-render the list
  const pane = document.getElementById('history-pane');
  if (pane && !pane.classList.contains('hidden')) {
    _commitCache.clear();
    _renderHistoryList();
  }
}
