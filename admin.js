/*
  admin.js — Admin console: org panel, usage dashboard, AI kill switch, invite management
  Depends on: app.js (api, toast, authToken, currentOrgId, currentUser)
*/

var _adminOrgId = null;
var _adminUsageData = null;

// ─── Panel open/close ──────────────────────────────────────────────────────
function openAdminPanel() {
  const modal = document.getElementById('admin-modal');
  if (!modal) return;

  // Sync org selector from main UI
  const mainOrgSel = document.getElementById('orgSelect');
  const adminOrgSel = document.getElementById('admin-org-select');
  if (mainOrgSel && adminOrgSel) {
    adminOrgSel.innerHTML = mainOrgSel.innerHTML; // copy options
    adminOrgSel.value = mainOrgSel.value;
    _adminOrgId = mainOrgSel.value || null;
  } else {
    _adminOrgId = typeof currentOrgId !== 'undefined' ? currentOrgId : null;
  }

  modal.classList.remove('hidden');
  _adminLoadTab('usage');
}

function closeAdminPanel() {
  document.getElementById('admin-modal')?.classList.add('hidden');
}

// ─── Tab routing ───────────────────────────────────────────────────────────
function _adminLoadTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
  ['usage','members','invites','webhooks','settings'].forEach(t => {
    const pane = document.getElementById(`admin-tab-${t}`);
    if (pane) pane.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'usage')    _adminLoadUsage();
  if (tab === 'members')  _adminLoadMembers();
  if (tab === 'invites')  _adminLoadInvites();
  if (tab === 'webhooks') _adminLoadWebhooks();
  if (tab === 'notifications') _adminLoadNotifications();
  if (tab === 'settings') _adminLoadSettings();
}

// ─── Usage dashboard ───────────────────────────────────────────────────────
async function _adminLoadUsage() {
  const grid = document.getElementById('admin-usage-grid');
  const aiStatusEl = document.getElementById('admin-ai-status');
  const toggleBtn = document.getElementById('admin-kill-switch-btn');
  if (!grid) return;
  grid.innerHTML = '<div class="admin-loading">Loading…</div>';
  try {
    const url = _adminOrgId ? `/api/admin-usage?orgId=${_adminOrgId}` : '/api/admin-usage';
    const data = await api(url);
    _adminUsageData = data;

    grid.innerHTML = [
      { val: data.aiCalls.toLocaleString(), label: 'AI Calls (30d)' },
      { val: `${data.aiAvgLatencyMs}ms`, label: 'Avg Latency' },
      { val: (data.aiTokensUsed || 0).toLocaleString(), label: 'Tokens Used' },
      { val: data.aiErrors, label: 'AI Errors', warn: data.aiErrors > 0 },
      { val: data.workspaceCount, label: 'Workspaces' },
      { val: data.memberCount, label: 'Members' }
    ].map(c => `<div class="admin-usage-card${c.warn?' admin-usage-card-warn':''}">
      <div class="admin-usage-card-value">${c.val}</div>
      <div class="admin-usage-card-label">${c.label}</div>
    </div>`).join('');

    // Mini bar chart
    const canvas = document.getElementById('admin-usage-chart');
    if (canvas && data.dailyCalls?.length) _drawBarChart(canvas, data.dailyCalls);

    if (aiStatusEl) aiStatusEl.textContent = data.aiEnabled ? '✅ Enabled' : '🔴 Disabled';
    if (toggleBtn) {
      toggleBtn.textContent = data.aiEnabled ? 'Disable AI' : 'Enable AI';
      toggleBtn.onclick = async () => {
        try {
          await api('/api/admin-kill-switch', { method: 'POST', body: { enabled: !data.aiEnabled, orgId: _adminOrgId || undefined } });
          toast(`AI ${!data.aiEnabled ? 'enabled' : 'disabled'}`, !data.aiEnabled ? 'success' : 'info');
          _adminLoadUsage();
        } catch (e) { toast(e.message, 'error'); }
      };
    }
  } catch (e) {
    grid.innerHTML = `<div class="admin-error">Failed to load usage: ${e.message}</div>`;
  }
}

function _drawBarChart(canvas, dailyCalls) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(...dailyCalls.map(d => d.calls), 1);
  const bw = Math.floor(W / dailyCalls.length) - 4;
  dailyCalls.forEach((d, i) => {
    const bh = Math.round((d.calls / max) * (H - 24));
    const x = i * (bw + 4) + 2;
    ctx.fillStyle = 'rgba(162,89,255,0.7)';
    ctx.fillRect(x, H - 20 - bh, bw, bh);
    ctx.fillStyle = '#6050a0';
    ctx.font = '9px sans-serif';
    const label = new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
    ctx.fillText(label, x, H - 4);
  });
}

function _renderMiniChart(dailyCalls) {
  if (!dailyCalls.length) return '<div class="chart-empty">No data</div>';
  const max = Math.max(...dailyCalls.map(d => d.calls), 1);
  return `<div class="mini-chart">${dailyCalls.map(d => {
    const h = Math.round((d.calls / max) * 60);
    const label = new Date(d.day).toLocaleDateString(undefined, { weekday: 'short' });
    return `<div class="mini-bar-wrap" title="${d.calls} calls on ${label}">
      <div class="mini-bar" style="height:${h}px"></div>
      <div class="mini-bar-label">${label}</div>
    </div>`;
  }).join('')}</div>`;
}

// ─── Members ───────────────────────────────────────────────────────────────
async function _adminLoadMembers() {
  const el = document.getElementById('admin-members-list');
  if (!el || !_adminOrgId) { if (el) el.innerHTML = '<div class="admin-empty">Select an org first</div>'; return; }
  el.innerHTML = '<div class="admin-loading">Loading…</div>';
  try {
    const data = await api(`/api/org-members?orgId=${_adminOrgId}`);
    el.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Email</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>
          ${(data.members || []).map(m => `
            <tr>
              <td>${_esc(m.email)}</td>
              <td>
                <select class="role-select" data-uid="${m.user_id}">
                  ${['owner','admin','member','viewer'].map(r =>
                    `<option value="${r}" ${m.role===r?'selected':''}>${r}</option>`
                  ).join('')}
                </select>
              </td>
              <td>${new Date(m.created_at).toLocaleDateString()}</td>
              <td><button onclick="adminRemoveMember('${m.user_id}')">Remove</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <button class="admin-btn" onclick="_adminLoadInvites()">+ Invite Member</button>
    `;

    // Role change handlers
    el.querySelectorAll('.role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await api('/api/org-members', { method: 'PATCH', body: { orgId: _adminOrgId, userId: sel.dataset.uid, role: sel.value } });
          toast('Role updated', 'success');
        } catch (e) { toast(e.message, 'error'); sel.value = sel.dataset.orig; }
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="admin-error">${e.message}</div>`;
  }
}

async function adminRemoveMember(userId) {
  if (!confirm('Remove this member from the org?')) return;
  try {
    await api('/api/org-members', { method: 'DELETE', body: { orgId: _adminOrgId, userId } });
    toast('Member removed');
    _adminLoadMembers();
  } catch (e) { toast(e.message, 'error'); }
}

// ─── Invites ───────────────────────────────────────────────────────────────
async function _adminLoadInvites() {
  const listEl = document.getElementById('admin-invites-list');
  if (!listEl || !_adminOrgId) { if (listEl) listEl.innerHTML = '<div class="admin-empty">Select an org first</div>'; return; }
  listEl.innerHTML = '<div class="admin-loading">Loading…</div>';
  try {
    const data = await api(`/api/invite-list?orgId=${_adminOrgId}`);
    listEl.innerHTML = (data.invites || []).length
      ? `<table class="admin-table">
          <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th></tr></thead>
          <tbody>${(data.invites || []).map(inv => `
            <tr>
              <td>${_esc(inv.email)}</td>
              <td>${_esc(inv.role)}</td>
              <td>${inv.accepted_at ? '✅ Accepted' : new Date(inv.expires_at) < new Date() ? '⏰ Expired' : '⏳ Pending'}</td>
              <td>${new Date(inv.expires_at).toLocaleDateString()}</td>
            </tr>
          `).join('')}</tbody>
        </table>`
      : '<div class="admin-empty">No invites yet</div>';

    // Wire the invite create button (only once)
    const createBtn = document.getElementById('invite-create-btn');
    if (createBtn && !createBtn._wired) {
      createBtn._wired = true;
      createBtn.addEventListener('click', async () => {
        const email = document.getElementById('invite-email-input')?.value?.trim() || '';
        const role = document.getElementById('invite-role-select')?.value || 'member';
        try {
          const r = await api('/api/invite-create', { method: 'POST', body: { orgId: _adminOrgId, email, role } });
          const linkInput = document.getElementById('invite-link-input');
          const linkOutput = document.getElementById('invite-link-output');
          if (linkInput) linkInput.value = r.inviteUrl;
          if (linkOutput) linkOutput.classList.remove('hidden');
          const copyBtn = document.getElementById('invite-link-copy');
          if (copyBtn && !copyBtn._wired) {
            copyBtn._wired = true;
            copyBtn.addEventListener('click', () => {
              navigator.clipboard?.writeText(r.inviteUrl);
              toast('Invite link copied', 'success');
            });
          }
          toast(email ? `Invite for ${email} created` : 'Invite link created', 'success');
          _adminLoadInvites();
        } catch (e) { toast(e.message, 'error'); }
      });
    }
  } catch (e) {
    listEl.innerHTML = `<div class="admin-error">${e.message}</div>`;
  }
}

// ─── Webhooks ─────────────────────────────────────────────────────────────
async function _adminLoadWebhooks() {
  const listEl = document.getElementById('admin-webhooks-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="admin-loading">Loading…</div>';
  try {
    const qp = _adminOrgId ? `orgId=${_adminOrgId}` : (typeof currentWorkspaceId !== 'undefined' && currentWorkspaceId ? `workspaceId=${currentWorkspaceId}` : 'orgId=');
    const data = await api(`/api/webhooks?${qp}`);
    listEl.innerHTML = (data.webhooks || []).length
      ? `<table class="admin-table">
          <thead><tr><th>URL</th><th>Events</th><th></th></tr></thead>
          <tbody>${(data.webhooks || []).map(w => `
            <tr>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${_esc(w.url)}</td>
              <td>${(w.events || []).join(', ')}</td>
              <td><button onclick="adminDeleteWebhook('${w.id}')">Delete</button></td>
            </tr>
          `).join('')}</tbody>
        </table>`
      : '<div class="admin-empty">No webhooks configured</div>';

    // Wire the create button (once)
    const addBtn = document.getElementById('webhook-create-btn');
    if (addBtn && !addBtn._wired) {
      addBtn._wired = true;
      addBtn.addEventListener('click', async () => {
        const url = document.getElementById('webhook-url-input')?.value?.trim();
        const eventSel = document.getElementById('webhook-events-select');
        const events = eventSel ? Array.from(eventSel.selectedOptions).map(o => o.value) : ['ws.save'];
        if (!url) return toast('Enter webhook URL', 'error');
        try {
          const r = await api('/api/webhooks', { method: 'POST', body: {
            orgId: _adminOrgId || undefined,
            workspaceId: (typeof currentWorkspaceId !== 'undefined' ? currentWorkspaceId : undefined) || undefined,
            url, events
          }});
          toast('Webhook created. Secret: ' + r.secret, 'success');
          const secretDiv = document.createElement('div');
          secretDiv.className = 'webhook-secret-display';
          secretDiv.textContent = 'Secret (save this — shown once): ' + r.secret;
          listEl.prepend(secretDiv);
          _adminLoadWebhooks();
        } catch (e) { toast(e.message, 'error'); }
      });
    }
  } catch (e) {
    listEl.innerHTML = `<div class="admin-error">${e.message}</div>`;
  }
}

async function adminDeleteWebhook(id) {
  if (!confirm('Delete this webhook?')) return;
  try {
    await api('/api/webhooks', { method: 'DELETE', body: { id } });
    toast('Webhook deleted');
    _adminLoadWebhooks();
  } catch (e) { toast(e.message, 'error'); }
}

// ─── Settings / compliance export ─────────────────────────────────────────
function _adminLoadSettings() {
  // Wire static buttons in settings tab (idempotent)
  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (el && !el._wired) { el._wired = true; el.addEventListener('click', fn); }
  };
  wire('export-audit-csv-btn', () => adminExportAudit('csv'));
  wire('export-audit-json-btn', () => adminExportAudit('json'));
  wire('export-soc2-btn', () => adminExportSoc2());
  wire('view-sessions-btn', openSessionsModal);
  wire('resend-verify-admin-btn', adminResendVerify);
}
async function adminExportAudit(format) {
  const base = `/api/admin-audit-export?format=${format}`;
  const url = _adminOrgId ? `${base}&orgId=${_adminOrgId}` : base;
  if (format === 'csv') {
    // Trigger download
    const a = document.createElement('a');
    a.href = `/.netlify/functions/admin-audit-export?format=csv${_adminOrgId ? `&orgId=${_adminOrgId}` : ''}`;
    a.download = `audit-${Date.now()}.csv`;
    a.click();
    return;
  }
  try {
    const data = await api(url);
    const blob = new Blob([JSON.stringify(data.logs, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${Date.now()}.json`;
    a.click();
    toast(`Exported ${data.count} audit entries`);
  } catch (e) { toast(e.message, 'error'); }
}

async function adminExportSoc2() {
  try {
    const orgParam = _adminOrgId ? `?orgId=${_adminOrgId}` : '';
    const res = await fetch(`/.netlify/functions/soc2${orgParam}`, {
      headers: { Authorization: `Bearer ${typeof authToken !== 'undefined' ? authToken : ''}` },
    });
    if (!res.ok) { const t = await res.text(); toast(`SOC2 export failed: ${t}`, 'error'); return; }
    const pack = await res.json();
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `soc2-evidence-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    toast('SOC 2 evidence pack exported', 'success');
  } catch (e) { toast('SOC2 error: ' + e.message, 'error'); }
}

async function adminResendVerify() {
  try {
    const r = await api('/api/auth-verify-email', { method: 'POST', body: {} });
    toast(r.message || 'Verification email sent', 'success');
    if (r.dev_verify_url) console.log('Verify URL:', r.dev_verify_url);
  } catch (e) { toast(e.message, 'error'); }
}

// ─── Notifications tab ─────────────────────────────────────────────────────
async function _adminLoadNotifications() {
  const list = document.getElementById('notif-prefs-list');
  if (!list) return;
  list.innerHTML = '<span>Loading…</span>';

  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (el && !el._notifWired) { el._notifWired = true; el.addEventListener('click', fn); }
  };

  wire('notif-save-btn', async () => {
    const channel = document.getElementById('notif-channel-select')?.value;
    const value   = document.getElementById('notif-channel-input')?.value?.trim();
    if (!value) { toast('Enter a URL or email', 'error'); return; }

    const config = {};
    if (channel === 'slack')   config.webhook_url = value;
    if (channel === 'email')   config.to          = value;
    if (channel === 'webhook') config.url          = value;

    const EVENTS = ['task.created','review.requested','ws.shared','invite.accepted','member.joined','subscription.changed'];

    try {
      const res = await fetch('/.netlify/functions/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${typeof authToken !== 'undefined' ? authToken : ''}` },
        body: JSON.stringify({ action: 'set', orgId: _adminOrgId || undefined, channel, config, events: EVENTS }),
      });
      if (!res.ok) { toast(await res.text(), 'error'); return; }
      toast(`${channel} notification preference saved`, 'success');
      _adminLoadNotifications();
    } catch (e) { toast(e.message, 'error'); }
  });

  try {
    const orgParam = _adminOrgId ? `?orgId=${_adminOrgId}` : '';
    const res = await fetch(`/.netlify/functions/notifications${orgParam}`, {
      headers: { Authorization: `Bearer ${typeof authToken !== 'undefined' ? authToken : ''}` },
    });
    const data = res.ok ? await res.json() : null;
    const prefs = data?.preferences || [];

    if (!prefs.length) {
      list.innerHTML = '<span style="opacity:.4;font-size:12px">No notification preferences configured.</span>';
      return;
    }

    list.innerHTML = prefs.map(p => `
      <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.04);border-radius:6px;padding:8px 12px;margin-bottom:6px">
        <span style="font-size:12px;flex:1">${p.channel} &nbsp;<span style="opacity:.5">${p.has_slack ? '🔗 Slack' : p.has_email ? '✉️ Email' : '🌐 Webhook'}</span></span>
        <span style="font-size:11px;opacity:.5">${p.enabled ? 'enabled' : 'disabled'}</span>
        <button onclick="_adminDeleteNotifPref('${p.id}')" style="font-size:10px;padding:2px 6px;background:#7f1d1d">Del</button>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<span style="color:red;font-size:12px">${e.message}</span>`;
  }
}

async function _adminDeleteNotifPref(id) {
  try {
    await fetch('/.netlify/functions/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${typeof authToken !== 'undefined' ? authToken : ''}` },
      body: JSON.stringify({ action: 'delete', id }),
    });
    toast('Preference removed', 'success');
    _adminLoadNotifications();
  } catch (e) { toast(e.message, 'error'); }
}

// ─── Sessions modal ────────────────────────────────────────────────────────
async function openSessionsModal() {
  const modal = document.getElementById('sessions-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const list = document.getElementById('sessions-list');
  if (!list) return;
  list.innerHTML = '<div class="admin-loading">Loading…</div>';
  try {
    const data = await api('/api/sessions-list');
    list.innerHTML = (data.sessions || []).map(s => `
      <div class="session-item ${s.revoked ? 'session-revoked' : ''}">
        <div class="session-info">
          <div class="session-device">${_esc(s.deviceHint || 'Unknown device')}</div>
          <div class="session-meta">IP: ${_esc(s.ip)} · Last seen: ${new Date(s.lastSeen).toLocaleString()}</div>
        </div>
        ${!s.revoked ? `<button onclick="adminRevokeSession('${s.id}')">Revoke</button>` : '<span class="revoked-label">Revoked</span>'}
      </div>
    `).join('') || '<div class="admin-empty">No sessions found</div>';
  } catch (e) {
    list.innerHTML = `<div class="admin-error">${e.message}</div>`;
  }
}

async function adminRevokeSession(sessionId) {
  if (!confirm('Revoke this session? That device will be signed out.')) return;
  try {
    await api('/api/sessions-revoke', { method: 'POST', body: { sessionId } });
    toast('Session revoked', 'success');
    openSessionsModal();
  } catch (e) { toast(e.message, 'error'); }
}

function closeSessionsModal() {
  document.getElementById('sessions-modal')?.classList.add('hidden');
}

// ─── Init ─────────────────────────────────────────────────────────────────
function initAdmin() {
  document.getElementById('admin-panel-btn')?.addEventListener('click', openAdminPanel);
  document.getElementById('admin-modal-close')?.addEventListener('click', closeAdminPanel);
  document.getElementById('sessions-modal-close')?.addEventListener('click', closeSessionsModal);

  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => _adminLoadTab(btn.dataset.adminTab));
  });

  // Org selector in admin modal — populate from main org selector
  document.getElementById('admin-load-btn')?.addEventListener('click', () => {
    const sel = document.getElementById('admin-org-select');
    _adminOrgId = sel?.value || null;
    _adminLoadTab('usage');
  });
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
