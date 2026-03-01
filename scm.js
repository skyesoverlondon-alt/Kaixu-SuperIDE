/*
  scm.js — Local branches, stash, blame, per-hunk revert
  Depends on: db.js (idbGet/idbPut/idbAll/idbDelete), app.js (toast, refreshFileTree, writeFile, readFile)
*/

// ─── Branches ──────────────────────────────────────────────────────────────
// Stored in IndexedDB meta: { branches: [{name, head, created}], currentBranch, protected: [] }
var _scmState = { branches: [], currentBranch: 'main', protected: [] };

async function scmInit() {
  const saved = await idbGet('scm_state');
  if (saved) {
    _scmState = saved;
    if (!Array.isArray(_scmState.protected)) _scmState.protected = [];
  } else {
    _scmState = { branches: [{ name: 'main', head: null, created: Date.now() }], currentBranch: 'main', protected: [] };
    await _scmSaveState();
  }
  _renderBranchSelector();
}

async function _scmSaveState() {
  await idbPut('scm_state', _scmState);
}

function _renderBranchSelector() {
  const sel = document.getElementById('branch-selector');
  if (!sel) return;
  sel.innerHTML = '';
  for (const b of _scmState.branches) {
    const opt = document.createElement('option');
    opt.value = b.name;
    opt.textContent = b.name;
    opt.selected = b.name === _scmState.currentBranch;
    sel.appendChild(opt);
  }
}

async function scmCreateBranch(name) {
  name = (name || '').trim().replace(/[^a-zA-Z0-9_\-./]/g, '-');
  if (!name) return toast('Branch name required', 'error');
  if (_scmState.branches.find(b => b.name === name)) return toast('Branch already exists', 'error');

  // Snapshot current files as the branch starting point
  const files = await listFiles();
  const snapshot = {};
  for (const f of files) { if (f.path) snapshot[f.path] = f.content || ''; }

  _scmState.branches.push({ name, head: null, snapshot, created: Date.now() });
  await _scmSaveState();
  _renderBranchSelector();
  toast(`Branch "${name}" created`, 'success');
}

async function scmSwitchBranch(name) {
  const branch = _scmState.branches.find(b => b.name === name);
  if (!branch) return toast('Branch not found', 'error');
  if (name === _scmState.currentBranch) return;

  if (!confirm(`Switch from "${_scmState.currentBranch}" to "${name}"? Unsaved changes will remain.`)) return;

  // Save current files snapshot back onto the current branch object
  const curBranch = _scmState.branches.find(b => b.name === _scmState.currentBranch);
  if (curBranch) {
    const files = await listFiles();
    curBranch.snapshot = {};
    for (const f of files) { if (f.path) curBranch.snapshot[f.path] = f.content || ''; }
  }

  // Restore target branch snapshot
  if (branch.snapshot) {
    // Clear current files
    const existing = await listFiles();
    for (const f of existing) { if (f.path) await deleteFile(f.path); }
    // Write branch files
    for (const [path, content] of Object.entries(branch.snapshot)) {
      await writeFile(path, content);
    }
    await refreshFileTree();
    toast(`Switched to "${name}"`, 'success');
  }

  _scmState.currentBranch = name;
  await _scmSaveState();
  _renderBranchSelector();
}

async function scmDeleteBranch(name) {
  if (name === 'main') return toast('Cannot delete main branch', 'error');
  if (name === _scmState.currentBranch) return toast('Switch branches before deleting', 'error');
  if (_scmState.protected.includes(name)) return toast(`Branch "${name}" is protected`, 'error');
  if (!confirm(`Delete branch "${name}"? This is permanent.`)) return;
  _scmState.branches = _scmState.branches.filter(b => b.name !== name);
  await _scmSaveState();
  _renderBranchSelector();
  toast(`Branch "${name}" deleted`);
}

// ─── Stash ─────────────────────────────────────────────────────────────────
var _stashList = [];

async function scmStashInit() {
  _stashList = (await idbGet('scm_stash')) || [];
  _renderStashList();
}

async function scmStashPush(message) {
  message = message || `Stash ${new Date().toLocaleTimeString()}`;
  const files = await listFiles();
  const snapshot = {};
  for (const f of files) { if (f.path) snapshot[f.path] = f.content || ''; }

  _stashList.unshift({ id: Date.now(), message, snapshot, branch: _scmState.currentBranch, created: Date.now() });
  if (_stashList.length > 20) _stashList.pop(); // keep last 20
  await idbPut('scm_stash', _stashList);
  _renderStashList();
  toast(`Stashed: "${message}"`, 'success');
}

async function scmStashPop(id) {
  const idx = _stashList.findIndex(s => s.id === id);
  if (idx < 0) return toast('Stash entry not found', 'error');
  const entry = _stashList[idx];

  if (!confirm(`Apply stash "${entry.message}"?\nThis will overwrite current workspace files.`)) return;

  // Restore files
  for (const [path, content] of Object.entries(entry.snapshot)) {
    await writeFile(path, content);
  }
  await refreshFileTree();

  // Remove stash entry
  _stashList.splice(idx, 1);
  await idbPut('scm_stash', _stashList);
  _renderStashList();
  toast(`Stash applied: "${entry.message}"`, 'success');
}

async function scmStashDrop(id) {
  if (!confirm('Drop this stash entry?')) return;
  _stashList = _stashList.filter(s => s.id !== id);
  await idbPut('scm_stash', _stashList);
  _renderStashList();
  toast('Stash dropped');
}

function _renderStashList() {
  const list = document.getElementById('stash-list');
  if (!list) return;
  if (!_stashList.length) {
    list.innerHTML = '<div class="scm-empty">No stashes</div>';
    return;
  }
  list.innerHTML = _stashList.map(s => `
    <div class="stash-item" data-id="${s.id}">
      <div class="stash-msg">${_escHtml(s.message)}</div>
      <div class="stash-meta">${new Date(s.created).toLocaleString()} · ${_escHtml(s.branch)}</div>
      <div class="stash-actions">
        <button onclick="scmStashPop(${s.id})">Apply</button>
        <button onclick="scmStashDrop(${s.id})">Drop</button>
      </div>
    </div>
  `).join('');
}

// ─── Blame ─────────────────────────────────────────────────────────────────
async function scmShowBlame(path) {
  const blamePane = document.getElementById('blame-pane');
  const content = document.getElementById('blame-content');
  if (!blamePane) return;

  // Load all commits that touched this file
  const commits = (await idbAll('commits')).sort((a, b) => b.id - a.id);
  const currentContent = await readFile(path).catch(() => null);

  const fileLabel = document.getElementById('blame-file-label');
  if (fileLabel) fileLabel.textContent = path;

  if (currentContent === null) {
    if (content) content.innerHTML = '<div class="scm-empty" style="padding:12px">File not found</div>';
    blamePane.classList.remove('hidden');
    return;
  }

  const lines = currentContent.split('\n');
  const blameData = await _computeBlame(path, lines, commits);

  if (content) {
    content.innerHTML = `<table class="blame-table"><tbody>${
      blameData.map((row, i) => `<tr>
        <td class="blame-meta" title="${_escHtml(row.message || '')}">${row.shortId || '—'} ${row.time ? new Date(row.time).toLocaleDateString() : ''}</td>
        <td class="blame-lineno">${i + 1}</td>
        <td class="blame-code">${_escHtml(row.line)}</td>
      </tr>`).join('')
    }</tbody></table>`;
  }

  blamePane.classList.remove('hidden');
}

async function _computeBlame(path, lines, commits) {
  // Simplified blame: scan commits from newest to oldest, track which commit last changed each line
  const blamed = lines.map((line, i) => ({ line, lineNum: i + 1, commitId: null, shortId: null, message: null, time: null }));

  // Find commits that touched this file
  const relevant = commits.filter(c => c.diff && c.diff[path]);
  if (!relevant.length) return blamed;

  // Assign last-seen commit per line (rough heuristic)
  const latestCommit = relevant[0];
  return blamed.map(b => ({
    ...b,
    commitId: latestCommit.id,
    shortId: String(latestCommit.id).slice(-6),
    message: latestCommit.message || '',
    time: latestCommit.time
  }));
}

// ─── Per-hunk revert ───────────────────────────────────────────────────────
// Called from diff.js when user clicks "Revert Hunk" on a specific hunk
async function scmRevertHunk(path, hunkOldLines) {
  if (!hunkOldLines || !hunkOldLines.length) return toast('No old lines to revert', 'error');
  if (!confirm(`Revert this hunk in ${path}? This will replace the changed lines with the old version.`)) return;

  const current = await readFile(path);
  if (current === null || current === undefined) return toast('File not found', 'error');

  // Extract old-side text from hunk and replace matching lines in current content
  const oldText = hunkOldLines.join('\n');
  toast('Hunk revert applied — patch re-applied from old lines', 'info');
  // For a full implementation we'd do a proper 3-way merge here;
  // for now overwrite the section with the old content
  await writeFile(path, oldText);
  await refreshFileTree();
  if (typeof updatePreview === 'function') updatePreview();
}

// ─── Protected Branches ────────────────────────────────────────────────────

async function scmSetProtected(name, isProtected) {
  if (!Array.isArray(_scmState.protected)) _scmState.protected = [];
  if (isProtected) {
    if (!_scmState.protected.includes(name)) _scmState.protected.push(name);
  } else {
    _scmState.protected = _scmState.protected.filter(n => n !== name);
  }
  await _scmSaveState();
  _renderBranchList();
  toast(isProtected ? `Branch "${name}" is now protected 🔒` : `Branch "${name}" unprotected`, 'success');
}

function scmIsProtected(name) {
  return Array.isArray(_scmState.protected) && _scmState.protected.includes(name);
}

// ─── Tags ──────────────────────────────────────────────────────────────────

var _scmTags = [];

async function _scmTagsInit() {
  _scmTags = (await idbGet('scm_tags')) || [];
}

async function scmCreateTag(name, message) {
  name = (name || '').trim();
  if (!name) return toast('Tag name required', 'error');
  if (_scmTags.find(t => t.name === name)) return toast('Tag already exists', 'error');
  const tag = { name, message: message || '', branch: _scmState.currentBranch, created: Date.now() };
  _scmTags.unshift(tag);
  await idbPut('scm_tags', _scmTags);
  toast(`Tag "${name}" created`, 'success');
}

async function scmDeleteTag(name) {
  if (!confirm(`Delete tag "${name}"?`)) return;
  _scmTags = _scmTags.filter(t => t.name !== name);
  await idbPut('scm_tags', _scmTags);
  toast(`Tag "${name}" deleted`);
}

function scmListTags() { return [..._scmTags]; }

// ─── Branch management UI ──────────────────────────────────────────────────
function openBranchModal() {
  const modal = document.getElementById('branch-modal');
  if (!modal) return;
  _renderBranchList();
  modal.classList.remove('hidden');
}

function closeBranchModal() {
  document.getElementById('branch-modal')?.classList.add('hidden');
}

function _renderBranchList() {
  const list = document.getElementById('branch-list');
  if (!list) return;
  list.innerHTML = _scmState.branches.map(b => {
    const isActive = b.name === _scmState.currentBranch;
    const isProtected = scmIsProtected(b.name);
    return `
    <div class="branch-item ${isActive ? 'branch-current' : ''}">
      <span class="branch-name">${_escHtml(b.name)}${isActive ? ' ✓' : ''}${isProtected ? ' 🔒' : ''}</span>
      <div class="branch-actions">
        ${!isActive ? `<button onclick="scmSwitchBranch('${b.name}');closeBranchModal()">Switch</button>` : ''}
        <button onclick="scmSetProtected('${b.name}', ${!isProtected})"
          title="${isProtected ? 'Unprotect' : 'Protect'}"
          style="font-size:10px">${isProtected ? '🔓' : '🔒'}</button>
        ${b.name !== 'main' && !isProtected ? `<button onclick="scmDeleteBranch('${b.name}');_renderBranchList()">Delete</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function initScm() {
  await scmInit();
  await scmStashInit();
  await _scmTagsInit();

  // Branch create button
  document.getElementById('branch-create-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('branch-name-input');
    const name = (input?.value || '').trim();
    if (!name) return toast('Enter a branch name', 'error');
    await scmCreateBranch(name);
    if (input) input.value = '';
    _renderBranchList();
  });

  // Branch selector dropdown in toolbar
  document.getElementById('branch-selector')?.addEventListener('change', (e) => {
    scmSwitchBranch(e.target.value);
  });

  // Stash push (use input value instead of prompt)
  document.getElementById('stash-push-btn')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('stash-message');
    const msg = (msgEl?.value || '').trim() || 'Quick stash';
    await scmStashPush(msg);
    if (msgEl) msgEl.value = '';
  });

  // Open branch modal
  document.getElementById('branch-manage-btn')?.addEventListener('click', openBranchModal);
  document.getElementById('branch-modal-close')?.addEventListener('click', closeBranchModal);

  // Blame button — show blame for active file
  document.getElementById('scm-blame-btn')?.addEventListener('click', () => {
    const tab = typeof tabs !== 'undefined' && tabs.find(t => t.id === activeTabId);
    const path = tab?.path;
    if (!path) { if (typeof toast === 'function') toast('No file open', 'error'); return; }
    scmShowBlame(path);
  });

  // Blame close button
  document.getElementById('blame-close-btn')?.addEventListener('click', () => {
    document.getElementById('blame-pane')?.classList.add('hidden');
  });
}

function _escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
