/*
  ui.js — Toast notifications, Settings modal, Context menu
  Depends on: db.js (for loadSettings/saveSettings)
*/

// ─── Global IDE settings (written here, read everywhere) ──────────────────
var IDE = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  autoSave: 'idle',   // 'off' | 'idle' | 'keystroke' | 'blur'
  formatOnSave: false,
};

async function initSettings() {
  const saved = await loadSettings();
  Object.assign(IDE, saved);
  applySettings();
}

function applySettings() {
  document.querySelectorAll('.editor-area').forEach((ta) => {
    ta.style.fontSize = IDE.fontSize + 'px';
    ta.style.whiteSpace = IDE.wordWrap ? 'pre-wrap' : 'pre';
    ta.style.tabSize = IDE.tabSize;
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) { console.log('[toast]', msg); return; }
  const el = document.createElement('div');
  el.className = 'toast' + (type !== 'info' ? ' ' + type : '');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 350);
  }, duration);
}

// ─── Settings Modal ───────────────────────────────────────────────────────
function openSettings() {
  const m = document.getElementById('settings-modal');
  if (!m) return;
  // Populate inputs from IDE state
  document.getElementById('set-font-size').value = IDE.fontSize;
  document.getElementById('set-tab-size').value = IDE.tabSize;
  document.getElementById('set-autosave').value = IDE.autoSave;
  document.getElementById('set-wordwrap').checked = IDE.wordWrap;
  document.getElementById('set-format-save').checked = IDE.formatOnSave;
  m.classList.remove('hidden');
  document.getElementById('set-font-size').focus();
}

function closeSettingsModal() {
  document.getElementById('settings-modal')?.classList.add('hidden');
}

async function applyAndSaveSettings() {
  IDE.fontSize    = parseInt(document.getElementById('set-font-size').value) || 14;
  IDE.tabSize     = parseInt(document.getElementById('set-tab-size').value) || 2;
  IDE.autoSave    = document.getElementById('set-autosave').value;
  IDE.wordWrap    = document.getElementById('set-wordwrap').checked;
  IDE.formatOnSave= document.getElementById('set-format-save').checked;
  applySettings();
  await saveSettings({ ...IDE });
  closeSettingsModal();
  toast('Settings saved');
}

function bindSettingsModal() {
  document.getElementById('settings-btn')?.addEventListener('click', openSettings);
  document.getElementById('settings-apply')?.addEventListener('click', applyAndSaveSettings);
  document.getElementById('settings-close')?.addEventListener('click', closeSettingsModal);
  document.getElementById('settings-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettingsModal();
  });
}

// ─── Context Menu ─────────────────────────────────────────────────────────
let _ctxCleanup = null;

function showContextMenu(x, y, items) {
  hideContextMenu();
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.innerHTML = '';
  items.forEach((item) => {
    if (item === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item';
    el.innerHTML = `<span class="ctx-icon">${item.icon || ''}</span><span>${item.label}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); hideContextMenu(); item.action(); });
    menu.appendChild(el);
  });

  // Position
  menu.classList.remove('hidden');
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.min(x, vw - mw - 8) + 'px';
  menu.style.top  = Math.min(y, vh - mh - 8) + 'px';

  const close = (e) => { if (!menu.contains(e.target)) hideContextMenu(); };
  document.addEventListener('mousedown', close, { once: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); }, { once: true });
  _ctxCleanup = close;
}

function hideContextMenu() {
  const menu = document.getElementById('ctx-menu');
  if (menu) menu.classList.add('hidden');
  if (_ctxCleanup) { document.removeEventListener('mousedown', _ctxCleanup); _ctxCleanup = null; }
}

// ─── Generic modal helpers ────────────────────────────────────────────────
function showDialog(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideDialog(id) { document.getElementById(id)?.classList.add('hidden'); }

// Close any .dialog on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('dialog')) {
    e.target.classList.add('hidden');
  }
});
