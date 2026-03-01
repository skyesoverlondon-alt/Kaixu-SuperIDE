/*
  github.js — kAIxU Super IDE GitHub integration
  Requires: db.js (listFiles, writeFile, deleteFile, refreshFileTree),
            ui.js (toast), app.js (api, authToken, currentWorkspaceId)
  Load order: after snippets.js, before app.js
*/

// ─── State ─────────────────────────────────────────────────────────────────
var _ghConnected = false;
var _ghStatus    = null; // last status object from /api/github-status

// ─── Init ──────────────────────────────────────────────────────────────────
function initGitHub() {
  // Tab switch — load status when GitHub tab becomes visible
  document.querySelectorAll('.tabBtn[data-tab="github"]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Give app.js sideTabs handler a tick to show the pane, then refresh
      setTimeout(ghRefreshStatus, 50);
    });
  });

  // Connect button (disconnected state)
  _on('gh-connect-btn', 'click', openGhConnectModal);

  // Modal
  _on('gh-connect-save-btn', 'click', ghSaveConnection);
  _on('gh-connect-cancel-btn', 'click', closeGhConnectModal);
  _on('gh-connect-modal', 'click', (e) => {
    if (e.target.id === 'gh-connect-modal') closeGhConnectModal();
  });

  // Enter in PAT / owner / repo / branch fields
  ['gh-pat-input','gh-owner-input','gh-repo-input','gh-branch-input'].forEach(id => {
    _on(id, 'keydown', (e) => { if (e.key === 'Enter') ghSaveConnection(); });
  });

  // Connected state actions
  _on('gh-push-btn',       'click', ghPush);
  _on('gh-pull-btn',       'click', ghPull);
  _on('gh-refresh-btn',    'click', ghRefreshStatus);
  _on('gh-disconnect-btn', 'click', ghDisconnect);

  // Keyboard shortcut Ctrl+Shift+G → push
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'G') { e.preventDefault(); ghPush(); }
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function _on(id, evt, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evt, fn);
}

function _ghApi(path, opts = {}) {
  // Delegate to app.js api() which handles JWT header automatically
  return api(path, opts);
}

function _ghSetStatus(text, cls = '') {
  const el = document.getElementById('gh-status-text');
  if (!el) return;
  el.textContent = text;
  el.className = 'gh-status-text' + (cls ? ' ' + cls : '');
}

function _ghSetProgress(pct, label) {
  const prog = document.getElementById('gh-push-progress');
  const fill = document.getElementById('gh-progress-fill');
  const lbl  = document.getElementById('gh-progress-label');
  if (!prog) return;
  if (pct === null) {
    prog.classList.add('hidden');
    return;
  }
  prog.classList.remove('hidden');
  if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  if (lbl)  lbl.textContent = label || '';
}

function _ghShowBadge(show) {
  const badge = document.getElementById('github-badge');
  if (badge) badge.classList.toggle('hidden', !show);
}

function _ghRenderConnected(status) {
  const dis = document.getElementById('gh-disconnected');
  const con = document.getElementById('gh-connected');
  if (dis) dis.classList.toggle('hidden', !!status?.connected);
  if (con) con.classList.toggle('hidden', !status?.connected);

  if (!status?.connected) return;

  const repoLabel   = document.getElementById('gh-repo-label');
  const branchLabel = document.getElementById('gh-branch-label');
  const repoLink    = document.getElementById('gh-repo-link');

  if (repoLabel)   repoLabel.textContent   = `${status.owner}/${status.repo}`;
  if (branchLabel) branchLabel.textContent = `⎇ ${status.branch}`;
  if (repoLink)    repoLink.href = status.repoUrl || `https://github.com/${status.owner}/${status.repo}`;

  if (status.upToDate) {
    _ghSetStatus('Up to date ✓', 'ok');
    _ghShowBadge(false);
  } else if (status.behindBy != null && status.behindBy > 0) {
    _ghSetStatus(`Behind by ${status.behindBy} commit${status.behindBy !== 1 ? 's' : ''} — Pull to update`, 'behind');
    _ghShowBadge(true);
  } else if (status.error) {
    _ghSetStatus(status.error, 'err');
  } else {
    _ghSetStatus(`Local changes not yet pushed`, 'behind');
  }
}

// ─── Status ────────────────────────────────────────────────────────────────
async function ghRefreshStatus() {
  if (!window.authToken || !window.currentWorkspaceId) {
    _ghRenderConnected({ connected: false });
    return;
  }
  try {
    const data = await _ghApi(`/api/github-status?workspaceId=${encodeURIComponent(window.currentWorkspaceId)}`);
    _ghStatus = data;
    _ghConnected = !!data.connected;
    _ghRenderConnected(data);
  } catch (err) {
    // Not connected or server error — show disconnected UI
    _ghRenderConnected({ connected: false });
  }
}

// ─── Connect modal ─────────────────────────────────────────────────────────
function openGhConnectModal() {
  if (!window.authToken) { toast('Sign in first', 'error'); return; }
  const modal = document.getElementById('gh-connect-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const status = document.getElementById('gh-connect-status');
  if (status) { status.textContent = ''; status.className = 'gh-modal-status'; }
  // Pre-fill branch if we have a status
  const branch = document.getElementById('gh-branch-input');
  if (branch && !branch.value) branch.value = 'main';
  // Focus PAT field
  setTimeout(() => document.getElementById('gh-pat-input')?.focus(), 50);
}

function closeGhConnectModal() {
  document.getElementById('gh-connect-modal')?.classList.add('hidden');
}

async function ghSaveConnection() {
  const pat    = (document.getElementById('gh-pat-input')?.value   || '').trim();
  const owner  = (document.getElementById('gh-owner-input')?.value || '').trim();
  const repo   = (document.getElementById('gh-repo-input')?.value  || '').trim();
  const branch = (document.getElementById('gh-branch-input')?.value || 'main').trim();

  const statusEl = document.getElementById('gh-connect-status');
  const btn      = document.getElementById('gh-connect-save-btn');

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className   = 'gh-modal-status ' + (ok ? 'ok' : 'err');
  }

  if (!pat)   return setStatus('PAT is required', false);
  if (!owner) return setStatus('Owner is required', false);
  if (!repo)  return setStatus('Repository name is required', false);
  if (!window.currentWorkspaceId) return setStatus('No workspace selected', false);

  if (btn) btn.disabled = true;
  setStatus('Verifying access to GitHub…', true);

  try {
    const data = await _ghApi('/api/github-connect', {
      method: 'POST',
      body: { workspaceId: window.currentWorkspaceId, pat, owner, repo, branch }
    });
    setStatus(`Connected to ${data.owner}/${data.repo} (${data.branch}) ✓`, true);
    setTimeout(async () => {
      closeGhConnectModal();
      await ghRefreshStatus();
      toast(`Connected to ${data.owner}/${data.repo}`, 'success');
      if (typeof markOnboardingStep === 'function') markOnboardingStep('github');
    }, 700);
  } catch (err) {
    setStatus(String(err?.message || err), false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Push ──────────────────────────────────────────────────────────────────
async function ghPush() {
  if (!window.authToken)           return toast('Sign in first', 'error');
  if (!window.currentWorkspaceId)  return toast('No workspace', 'error');
  if (!_ghConnected)               return toast('Connect a GitHub repo first', 'error');

  const pushBtn   = document.getElementById('gh-push-btn');
  const pullBtn   = document.getElementById('gh-pull-btn');
  const commitMsg = (document.getElementById('gh-commit-msg')?.value || '').trim();

  if (pushBtn) pushBtn.disabled = true;
  if (pullBtn) pullBtn.disabled = true;
  _ghSetProgress(5, 'Reading workspace files…');
  _ghSetStatus('Pushing…');

  try {
    // Collect all files from IndexedDB
    const fileList = await listFiles();
    const filesObj = {};
    for (const { path, content } of fileList) {
      filesObj[path] = content || '';
    }

    _ghSetProgress(15, `Computing diff for ${fileList.length} files…`);

    const data = await _ghApi('/api/github-push', {
      method: 'POST',
      body: {
        workspaceId: window.currentWorkspaceId,
        files: filesObj,
        message: commitMsg || `kAIxU push — ${new Date().toLocaleString()}`
      }
    });

    _ghSetProgress(100, 'Done');
    setTimeout(() => _ghSetProgress(null), 1500);

    // Clear commit message input
    const msgEl = document.getElementById('gh-commit-msg');
    if (msgEl) msgEl.value = '';

    if (data.status === 'up-to-date') {
      _ghSetStatus('Up to date ✓', 'ok');
      toast('Nothing to push — already up to date');
    } else {
      _ghSetStatus('Up to date ✓', 'ok');
      _ghShowBadge(false);
      toast(`Pushed ${data.filesChanged} file${data.filesChanged !== 1 ? 's' : ''} → ${data.repo}`, 'success');
    }

    _ghStatus = { ..._ghStatus, upToDate: true, lastSha: data.commitSha };

  } catch (err) {
    _ghSetProgress(null);
    _ghSetStatus('Push failed', 'err');
    toast('Push failed: ' + String(err?.message || err), 'error');
  } finally {
    if (pushBtn) pushBtn.disabled = false;
    if (pullBtn) pullBtn.disabled = false;
  }
}

// ─── Pull ──────────────────────────────────────────────────────────────────
async function ghPull() {
  if (!window.authToken)           return toast('Sign in first', 'error');
  if (!window.currentWorkspaceId)  return toast('No workspace', 'error');
  if (!_ghConnected)               return toast('Connect a GitHub repo first', 'error');

  if (!confirm('Pull from GitHub? This will overwrite local files that differ from the remote.')) return;

  const pushBtn = document.getElementById('gh-push-btn');
  const pullBtn = document.getElementById('gh-pull-btn');

  if (pushBtn) pushBtn.disabled = true;
  if (pullBtn) pullBtn.disabled = true;
  _ghSetStatus('Pulling…');
  _ghSetProgress(10, 'Fetching from GitHub…');

  try {
    const data = await _ghApi('/api/github-pull', {
      method: 'POST',
      body: { workspaceId: window.currentWorkspaceId }
    });

    _ghSetProgress(70, `Writing ${Object.keys(data.files || {}).length} files…`);

    // Write pulled files into IndexedDB (replaces local content)
    const incomingFiles = data.files || {};
    // Clear existing files first, then write incoming
    const existingList = await listFiles();
    for (const f of existingList) {
      if (!(f.path in incomingFiles)) await deleteFile(f.path);
    }
    for (const [path, content] of Object.entries(incomingFiles)) {
      await writeFile(path, content || '');
    }

    _ghSetProgress(100, 'Done');
    setTimeout(() => _ghSetProgress(null), 1500);

    await refreshFileTree();
    _ghSetStatus('Up to date ✓', 'ok');
    _ghShowBadge(false);

    toast(
      `Pulled ${data.filesUpdated} updated + ${data.filesDeleted} deleted ← ${data.totalFiles} total files`,
      'success'
    );

  } catch (err) {
    _ghSetProgress(null);
    _ghSetStatus('Pull failed', 'err');
    toast('Pull failed: ' + String(err?.message || err), 'error');
  } finally {
    if (pushBtn) pushBtn.disabled = false;
    if (pullBtn) pullBtn.disabled = false;
  }
}

// ─── Disconnect ────────────────────────────────────────────────────────────
async function ghDisconnect() {
  if (!confirm('Disconnect GitHub? This removes the stored token and repo settings.')) return;
  try {
    await _ghApi('/api/github-connect', {
      method: 'DELETE',
      body: { workspaceId: window.currentWorkspaceId }
    });
    _ghConnected = false;
    _ghStatus    = null;
    _ghRenderConnected({ connected: false });
    _ghShowBadge(false);
    toast('GitHub disconnected');
  } catch (err) {
    toast('Disconnect failed: ' + String(err?.message || err), 'error');
  }
}
