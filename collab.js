/*
  collab.js — Polling-based presence, live cursors, activity feed
  Depends on: app.js (api, authToken, currentWorkspaceId, toast)
*/

var _presenceInterval  = null;
var _pollInterval      = null;
var _lastPresenceUsers = [];
var _cursorOverlays    = {};          // userId → DOM element
var _presenceSlow      = true;        // true = 25s poll, false = 2s poll
var _contentHashCache  = {};          // filePath → last known remote hash

// Palette must match presence.js color assignment
var _CURSOR_COLORS = ['#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#d19a66'];

// ─── Presence ──────────────────────────────────────────────────────────────
function startPresence() {
  if (_presenceInterval) return;
  _presenceInterval = setInterval(_presenceTick, 25000);
  _presenceTick();
  _schedulePresencePoll(true);
  _presencePoll();
}

function stopPresence() {
  if (_presenceInterval) { clearInterval(_presenceInterval); _presenceInterval = null; }
  if (_pollInterval)     { clearInterval(_pollInterval);     _pollInterval = null; }
  _clearCursorOverlays();
}

function _schedulePresencePoll(slow) {
  if (_pollInterval) clearInterval(_pollInterval);
  _presenceSlow = slow;
  _pollInterval = setInterval(_presencePoll, slow ? 25000 : 2000);
}

// Compute fast SHA-1-like hash for short strings (FNV-1a 32-bit, hex)
function _hashContent(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < Math.min(str.length, 4096); i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Return the active editor textarea (visible, not hidden)
function _activeEditor() {
  return document.querySelector('textarea.editor-area:not([style*="display: none"])') ||
         document.querySelector('.editor-area:not(.hidden)');
}

async function _presenceTick() {
  if (!authToken || !currentWorkspaceId) return;
  const ta = _activeEditor();
  let cursor = null;
  let filePath = null;
  let contentHash = null;
  if (ta) {
    const pos = ta.selectionStart;
    const lines = ta.value.substring(0, pos).split('\n');
    cursor = { line: lines.length, col: lines[lines.length - 1].length + 1 };
    // filePath from active tab data attribute (set by editor.js / app.js)
    filePath = ta.dataset.filePath ||
               document.querySelector('.tab.active')?.dataset?.path || null;
    contentHash = _hashContent(ta.value);
  }
  try {
    await api('/api/presence', {
      method: 'POST',
      body: { workspaceId: currentWorkspaceId, cursor, filePath, contentHash }
    });
  } catch { /* non-fatal */ }
}

async function _presencePoll() {
  if (!authToken || !currentWorkspaceId) return;
  try {
    const data = await api(`/api/presence?workspaceId=${currentWorkspaceId}`);
    const myId  = _getCurrentUserId();
    const users = (data.users || []).filter(u => u.userId !== myId);

    const changed = JSON.stringify(users) !== JSON.stringify(_lastPresenceUsers);
    _lastPresenceUsers = users;

    if (changed) {
      _renderPresenceBar(users);
      _renderCursorOverlays(users);
    }

    // Switch polling speed: fast when collaborators are present
    const hasFriends = users.length > 0;
    if (hasFriends && _presenceSlow)   _schedulePresencePoll(false);
    if (!hasFriends && !_presenceSlow) _schedulePresencePoll(true);

    // Content-hash change detection (same file, different hash, not self)
    _detectRemoteChanges(users);
  } catch { /* non-fatal */ }
}

function _detectRemoteChanges(users) {
  const ta       = _activeEditor();
  if (!ta) return;
  const myPath   = ta.dataset.filePath ||
                   document.querySelector('.tab.active')?.dataset?.path || null;
  if (!myPath) return;

  for (const u of users) {
    if (u.filePath !== myPath || !u.contentHash) continue;
    const prev = _contentHashCache[myPath + ':' + u.userId];
    if (prev && prev !== u.contentHash) {
      // Remote hash changed — collaborator edited the file
      if (typeof toast === 'function')
        toast(`${(u.email||'A collaborator').split('@')[0]} changed this file`, 'info');
    }
    _contentHashCache[myPath + ':' + u.userId] = u.contentHash;
  }
}

function _getCurrentUserId() {
  try {
    if (!authToken) return null;
    const payload = JSON.parse(atob(authToken.split('.')[1]));
    return payload.sub || payload.userId || null;
  } catch { return null; }
}

// ─── Presence bar (avatar pills) ────────────────────────────────────────────
function _renderPresenceBar(users) {
  const bar = document.getElementById('presence-bar');
  if (!bar) return;
  if (!users.length) {
    bar.innerHTML = '';
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML = `<span class="presence-label">Also here:</span>` +
    users.map(u => {
      const initials = (u.email || '?').split('@')[0].slice(0, 2).toUpperCase();
      const cursorTip = u.cursor ? ` · Ln ${u.cursor.line}:${u.cursor.col}` : '';
      const fileTip   = u.filePath ? ` · ${u.filePath.split('/').pop()}` : '';
      const color     = u.color || _CURSOR_COLORS[0];
      return `<span class="presence-avatar" title="${_esc(u.email||'?')}${fileTip}${cursorTip}"
        style="background:${color}">${initials}</span>`;
    }).join('');
}

// ─── Live cursor overlays ────────────────────────────────────────────────────
/*
  Renders a colored caret + name badge absolutely positioned over the active
  editor textarea.  Position is approximated from line number × line-height.
  This works best with monospace fonts; it degrades gracefully when off.
*/
function _renderCursorOverlays(users) {
  // Remove overlays for users who are no longer present
  const activeIds = new Set(users.map(u => u.userId));
  for (const uid of Object.keys(_cursorOverlays)) {
    if (!activeIds.has(uid)) {
      _cursorOverlays[uid]?.remove();
      delete _cursorOverlays[uid];
    }
  }

  const ta = _activeEditor();
  if (!ta) { _clearCursorOverlays(); return; }

  // Ensure the editor wrapper is position:relative so we can layer cursors
  let wrapper = ta.parentElement;
  if (!wrapper) return;
  if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';

  // Measure line height (once per render is fine)
  const style      = getComputedStyle(ta);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 18;
  const charWidth  = parseFloat(style.fontSize) * 0.6; // approx for monospace
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingLeft= parseFloat(style.paddingLeft) || 0;

  // Current file being edited (only show cursors for users on same file)
  const myPath = ta.dataset.filePath ||
                 document.querySelector('.tab.active')?.dataset?.path || null;

  for (const u of users) {
    if (!u.cursor) { _cursorOverlays[u.userId]?.remove(); delete _cursorOverlays[u.userId]; continue; }

    // Only render cursor if on the same file (or filePath not reported)
    if (myPath && u.filePath && u.filePath !== myPath) {
      _cursorOverlays[u.userId]?.remove();
      delete _cursorOverlays[u.userId];
      continue;
    }

    const top  = paddingTop  + (u.cursor.line - 1) * lineHeight;
    const left = paddingLeft + (u.cursor.col  - 1) * charWidth;
    const color = u.color || _CURSOR_COLORS[0];
    const name  = (u.email || 'User').split('@')[0];

    let el = _cursorOverlays[u.userId];
    if (!el) {
      el = document.createElement('div');
      el.className = 'collab-cursor';
      el.innerHTML = `<div class="collab-cursor-caret"></div><span class="collab-cursor-label"></span>`;
      wrapper.appendChild(el);
      _cursorOverlays[u.userId] = el;
    }

    Object.assign(el.style, {
      position: 'absolute',
      top:      `${top}px`,
      left:     `${left}px`,
      zIndex:   '10',
      pointerEvents: 'none'
    });
    const caret = el.querySelector('.collab-cursor-caret');
    const label = el.querySelector('.collab-cursor-label');
    if (caret) Object.assign(caret.style, {
      width: '2px', height: `${lineHeight}px`,
      background: color, display: 'inline-block', verticalAlign: 'top'
    });
    if (label) {
      label.textContent = name;
      Object.assign(label.style, {
        background: color, color: '#fff',
        fontSize: '10px', padding: '0 3px',
        borderRadius: '2px', whiteSpace: 'nowrap',
        display: 'inline-block', verticalAlign: 'top',
        marginLeft: '2px', opacity: '0.9'
      });
    }
  }
}

function _clearCursorOverlays() {
  for (const el of Object.values(_cursorOverlays)) el?.remove();
  _cursorOverlays = {};
}

// Hide overlays when editor loses focus or file switches
function _onEditorFocusChange() { _renderCursorOverlays(_lastPresenceUsers); }

function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

// ─── Activity Feed ─────────────────────────────────────────────────────────
async function loadActivityFeed(orgId, workspaceId) {
  const el = document.getElementById('activity-feed');
  if (!el) return;
  el.innerHTML = '<div class="activity-loading">Loading…</div>';
  try {
    const qs = orgId ? `orgId=${orgId}` : workspaceId ? `workspaceId=${workspaceId}` : '';
    const data = await api(`/api/activity-list?${qs}&limit=30`);
    const events = data.events || [];
    if (!events.length) {
      el.innerHTML = '<div class="activity-empty">No activity yet</div>';
      return;
    }
    el.innerHTML = events.map(ev => {
      const icon = _actIcon(ev.action);
      const relTime = _relTime(ev.created_at);
      return `
        <div class="activity-item">
          <span class="activity-icon">${icon}</span>
          <div class="activity-body">
            <span class="activity-who">${_esc(ev.user_email || 'System')}</span>
            <span class="activity-action">${_fmtAction(ev.action, ev.details)}</span>
          </div>
          <span class="activity-time" title="${new Date(ev.created_at).toLocaleString()}">${relTime}</span>
        </div>
      `;
    }).join('');
  } catch (e) {
    el.innerHTML = `<div class="activity-error">Failed: ${e.message}</div>`;
  }
}

function _actIcon(action) {
  const icons = {
    'ws.save': '💾', 'chat.append': '💬', 'presence': '👁',
    'login_success': '🔐', 'signup_success': '✅', 'email_verified': '📧',
    'invite_created': '📨', 'invite_accepted': '🤝',
    'ws_created': '📁', 'org_created': '🏢', 'ai_edit': '🤖'
  };
  return icons[action] || '📌';
}

function _fmtAction(action, details) {
  const d = details || {};
  switch (action) {
    case 'ws.save':      return `saved workspace "${d.name || ''}"`;
    case 'chat.append':  return `sent a chat message`;
    case 'login_success': return `signed in`;
    case 'signup_success': return `created an account`;
    case 'invite_created': return `invited ${d.email || ''}`;
    case 'invite_accepted': return `accepted an invite`;
    case 'org_ai_kill_switch': return `${d.enabled ? 'enabled' : 'disabled'} AI`;
    default: return action.replace(/_/g, ' ');
  }
}

function _relTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return `${Math.floor(diff/86400000)}d ago`;
}

// ─── Share Preview ─────────────────────────────────────────────────────────
async function createShareLink(expiresInHours) {
  if (typeof currentWorkspaceId === 'undefined' || !currentWorkspaceId) {
    if (typeof toast === 'function') toast('Save workspace to cloud first', 'error');
    return;
  }
  try {
    const r = await api('/api/workspace-share', { method: 'POST', body: { workspaceId: currentWorkspaceId, expiresInHours: expiresInHours || 48 } });
    const linkInput = document.getElementById('share-link-input');
    const linkOutput = document.getElementById('share-link-output');
    if (linkInput) linkInput.value = r.shareUrl;
    if (linkOutput) linkOutput.classList.remove('hidden');
    if (typeof toast === 'function') toast('Share link created', 'success');
    return r.shareUrl;
  } catch (e) { if (typeof toast === 'function') toast(e.message, 'error'); }
}

function openShareModal() {
  document.getElementById('share-modal')?.classList.remove('hidden');
  document.getElementById('share-link-output')?.classList.add('hidden');
}

function closeShareModal() {
  document.getElementById('share-modal')?.classList.add('hidden');
}

// ─── Init ──────────────────────────────────────────────────────────────────
function initCollab() {
  document.getElementById('share-preview-btn')?.addEventListener('click', openShareModal);
  document.getElementById('share-modal-close')?.addEventListener('click', closeShareModal);

  document.getElementById('share-create-btn')?.addEventListener('click', () => {
    const hrs = parseInt(document.getElementById('share-expiry')?.value || '48') || 48;
    createShareLink(hrs);
  });

  // Copy share link
  document.getElementById('share-link-copy')?.addEventListener('click', () => {
    const val = document.getElementById('share-link-input')?.value;
    if (val) { navigator.clipboard.writeText(val); if (typeof toast === 'function') toast('Link copied', 'success'); }
  });

  // Activity refresh button
  document.getElementById('activity-refresh-btn')?.addEventListener('click', () => {
    const orgSel = document.getElementById('orgSelect');
    const orgId = orgSel?.value || undefined;
    loadActivityFeed(orgId, window.currentWorkspaceId);
  });

  // Refresh cursor overlays whenever the active editor changes (tab switch)
  document.addEventListener('editor:fileOpened', _onEditorFocusChange);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _presencePoll();
  });

  // Start presence polling when workspace is loaded
  // (startPresence is called from app.js after workspace load)
}
