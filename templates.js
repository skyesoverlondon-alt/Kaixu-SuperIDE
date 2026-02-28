/*
  templates.js — Built-in workspace templates + browser modal (Phase 12)
  Exposes: initTemplates(), openTemplatesModal()
*/

// ─── Built-in templates ───────────────────────────────────────────────────
var BUILT_IN_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Empty workspace — start from scratch.',
    tags: ['blank'],
    emoji: '📄',
    files: {
      'index.html': '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <title>My App</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n  <h1>Hello World</h1>\n  <script src="app.js"></script>\n</body>\n</html>\n',
      'styles.css': '/* Styles */\nbody {\n  font-family: system-ui, sans-serif;\n  margin: 0;\n  padding: 2rem;\n}\n',
      'app.js': '// Main script\nconsole.log(\'Hello from kAIxU!\');\n',
    },
  },
  {
    id: 'spa',
    name: 'Single-Page App',
    description: 'Vanilla JS SPA with routing stub, CSS reset, and app shell.',
    tags: ['html', 'css', 'js', 'spa'],
    emoji: '🌐',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SPA App</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <nav id="nav"></nav>
  <main id="app"></main>
  <script src="router.js"></script>
  <script src="app.js"></script>
</body>
</html>
`,
      'styles.css': `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
nav { display: flex; gap: 1rem; padding: 1rem 2rem; background: rgba(255,255,255,.05); border-bottom: 1px solid rgba(255,255,255,.1); }
nav a { color: #a5b4fc; text-decoration: none; font-weight: 600; }
nav a:hover { color: #fff; }
#app { padding: 2rem; max-width: 960px; margin: 0 auto; }
`,
      'router.js': `// Minimal hash router
var Router = {
  routes: {},
  define(path, handler) { this.routes[path] = handler; return this; },
  navigate(path) {
    location.hash = path;
  },
  start() {
    const resolve = () => {
      const path = location.hash.replace('#', '') || '/';
      const handler = this.routes[path] || this.routes['*'];
      if (handler) handler(path);
    };
    window.addEventListener('hashchange', resolve);
    resolve();
  }
};
`,
      'app.js': `// App entry point
Router
  .define('/', () => {
    document.getElementById('app').innerHTML = '<h1>Home</h1><p>Welcome to your SPA!</p>';
  })
  .define('/about', () => {
    document.getElementById('app').innerHTML = '<h1>About</h1><p>Built with kAIxU Super IDE.</p>';
  })
  .define('*', (path) => {
    document.getElementById('app').innerHTML = '<h1>404</h1><p>Page not found: ' + path + '</p>';
  });

document.getElementById('nav').innerHTML = \`
  <a href="#/">Home</a>
  <a href="#/about">About</a>
\`;

Router.start();
`,
    },
  },
  {
    id: 'react-cdn',
    name: 'React CDN App',
    description: 'React + ReactDOM from CDN — no bundler needed.',
    tags: ['react', 'jsx', 'frontend'],
    emoji: '⚛',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>React App</title>
  <link rel="stylesheet" href="styles.css" />
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" src="app.jsx"></script>
</body>
</html>
`,
      'styles.css': `body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
.app { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 1rem; }
button { background: #7c3aed; color: white; border: none; padding: .5rem 1.5rem; border-radius: 8px; font-size: 1rem; cursor: pointer; }
button:hover { background: #6d28d9; }
`,
      'app.jsx': `function Counter() {
  const [count, setCount] = React.useState(0);
  return (
    <div className="app">
      <h1>kAIxU React App</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <button onClick={() => setCount(0)}>Reset</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Counter />);
`,
    },
  },
  {
    id: 'markdown-site',
    name: 'Markdown Site',
    description: 'Static site that renders Markdown content with a clean reader style.',
    tags: ['markdown', 'static', 'blog'],
    emoji: '📝',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Markdown Site</title>
  <link rel="stylesheet" href="styles.css" />
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
  <article id="content"></article>
  <script src="app.js"></script>
</body>
</html>
`,
      'styles.css': `body { margin: 0; font-family: Georgia, serif; background: #0f172a; color: #e2e8f0; }
article { max-width: 720px; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.8; }
h1, h2, h3 { color: #f8fafc; }
a { color: #818cf8; }
code { background: rgba(255,255,255,.08); padding: .15em .4em; border-radius: 4px; font-family: monospace; }
pre { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 1.5rem; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #7c3aed; margin: 0; padding-left: 1rem; color: #94a3b8; }
`,
      'content.md': `# Welcome to My Markdown Site

This site is built with kAIxU Super IDE and requires no bundler.

## Features

- Pure Markdown content
- Renders beautifully in any browser
- Easy to edit — just update this file

## Getting Started

Edit **content.md** to update this page.

> Built with kAIxU Super IDE ⚡
`,
      'app.js': `(async () => {
  const res = await fetch('content.md');
  const md = await res.text();
  document.getElementById('content').innerHTML = marked.parse(md);
})();
`,
    },
  },
  {
    id: 'netlify-function',
    name: 'Netlify Function Starter',
    description: 'A Netlify site with a serverless function, CORS headers, and test page.',
    tags: ['netlify', 'serverless', 'api'],
    emoji: '⚡',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Netlify Function Demo</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div class="container">
    <h1>Netlify Function Demo</h1>
    <button id="callBtn">Call /.netlify/functions/hello</button>
    <pre id="output">Response will appear here…</pre>
  </div>
  <script src="app.js"></script>
</body>
</html>
`,
      'styles.css': `body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; padding: 3rem 1rem; }
.container { max-width: 600px; width: 100%; }
h1 { color: #f8fafc; }
button { background: #7c3aed; color: white; border: none; padding: .6rem 1.4rem; border-radius: 8px; font-size: 1rem; cursor: pointer; margin-bottom: 1rem; }
button:hover { background: #6d28d9; }
pre { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 1rem; min-height: 80px; white-space: pre-wrap; word-break: break-word; font-size: .9rem; }
`,
      'app.js': `document.getElementById('callBtn').addEventListener('click', async () => {
  const out = document.getElementById('output');
  out.textContent = 'Loading…';
  try {
    const res = await fetch('/.netlify/functions/hello');
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
});
`,
      'netlify/functions/hello.js': `exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      ok: true,
      message: 'Hello from Netlify Functions!',
      timestamp: new Date().toISOString(),
      method: event.httpMethod,
    }),
  };
};
`,
      'netlify.toml': `[build]
  functions = "netlify/functions"

[[redirects]]
  from = "/.netlify/functions/*"
  to = "/.netlify/functions/:splat"
  status = 200
`,
    },
  },
  {
    id: 'todo-app',
    name: 'Todo App',
    description: 'Classic todo list with local storage persistence.',
    tags: ['js', 'frontend', 'demo'],
    emoji: '✅',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Todo App</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div class="app">
    <h1>Todos</h1>
    <div class="input-row">
      <input id="todo-input" placeholder="Add todo…" />
      <button id="add-btn">Add</button>
    </div>
    <ul id="todo-list"></ul>
    <div class="footer">
      <span id="remaining">0 remaining</span>
      <button id="clear-done">Clear done</button>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>
`,
      'styles.css': `* { box-sizing: border-box; } body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; padding: 3rem 1rem; }
.app { width: 100%; max-width: 480px; }
h1 { color: #f8fafc; text-align: center; }
.input-row { display: flex; gap: .5rem; margin-bottom: 1.5rem; }
input { flex: 1; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.15); border-radius: 8px; color: #e2e8f0; padding: .6rem 1rem; font-size: 1rem; }
button { background: #7c3aed; color: white; border: none; border-radius: 8px; padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
button:hover { background: #6d28d9; }
ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .5rem; }
li { display: flex; align-items: center; gap: .75rem; background: rgba(255,255,255,.05); border-radius: 8px; padding: .75rem 1rem; cursor: pointer; }
li.done span { text-decoration: line-through; color: #64748b; }
li .check { font-size: 1.2rem; }
.footer { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; color: #64748b; font-size: .9rem; }
#clear-done { background: transparent; border: 1px solid rgba(255,255,255,.15); font-size: .85rem; padding: .35rem .8rem; color: #94a3b8; }
`,
      'app.js': `var todos = JSON.parse(localStorage.getItem('todos') || '[]');
function save() { localStorage.setItem('todos', JSON.stringify(todos)); }
function render() {
  const ul = document.getElementById('todo-list');
  ul.innerHTML = '';
  todos.forEach((t, i) => {
    const li = document.createElement('li');
    if (t.done) li.classList.add('done');
    li.innerHTML = '<span class="check">' + (t.done ? '☑' : '☐') + '</span><span>' + t.text.replace(/</g,'&lt;') + '</span>';
    li.addEventListener('click', () => { todos[i].done = !todos[i].done; save(); render(); });
    ul.appendChild(li);
  });
  document.getElementById('remaining').textContent = todos.filter(t => !t.done).length + ' remaining';
}
document.getElementById('add-btn').addEventListener('click', () => {
  const input = document.getElementById('todo-input');
  const text = input.value.trim();
  if (!text) return;
  todos.push({ text, done: false });
  input.value = '';
  save(); render();
});
document.getElementById('todo-input').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('add-btn').click(); });
document.getElementById('clear-done').addEventListener('click', () => { todos = todos.filter(t => !t.done); save(); render(); });
render();
`,
    },
  },
];

// ─── User templates (saved to IndexedDB) ──────────────────────────────────
var _userTemplates = [];
var _orgTemplates = [];
var _activeTemplateTab = 'builtin'; // 'builtin' | 'yours' | 'org'

async function _loadUserTemplates() {
  _userTemplates = (await getMeta('userTemplates', [])) || [];
}

async function _saveUserTemplates() {
  await setMeta('userTemplates', _userTemplates);
}

// ─── Cloud / org templates (Phase 12.5) ───────────────────────────────────
function _getApiToken() {
  return localStorage.getItem('KAIXU_AUTH_TOKEN') || null;
}

function _getOrgId() {
  return (typeof currentOrgId !== 'undefined' && currentOrgId) ? currentOrgId : null;
}

async function _loadOrgTemplates() {
  const token = _getApiToken();
  const orgId = _getOrgId();
  if (!token && !orgId) { _orgTemplates = []; return; }

  try {
    const params = new URLSearchParams({ public: 'true' });
    if (orgId) params.set('org_id', orgId);
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(`/.netlify/functions/templates-list?${params}`, { headers });
    const data = await res.json();
    _orgTemplates = data.ok ? (data.templates || []) : [];
  } catch (_) {
    _orgTemplates = [];
  }
}

async function _cloudSaveTemplate(tpl) {
  const token = _getApiToken();
  if (!token) { toast('Sign in to save to the cloud', 'error'); return; }
  const orgId = _getOrgId();
  const isPublic = confirm('Make this template public (visible to everyone)?');

  try {
    const res = await fetch('/.netlify/functions/templates-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        org_id: orgId || null,
        name: tpl.name,
        description: tpl.description,
        tags: tpl.tags,
        emoji: tpl.emoji,
        files: tpl.files,
        is_public: isPublic,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      toast(`Template "${tpl.name}" saved to cloud`, 'success');
      await _loadOrgTemplates();
    } else {
      toast('Cloud save failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch (err) {
    toast('Cloud save failed: ' + err.message, 'error');
  }
}

function _switchTemplateTab(tab) {
  _activeTemplateTab = tab;
  document.querySelectorAll('.tpl-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  _renderTemplateGrid(document.getElementById('templates-search')?.value || '');
}

async function saveWorkspaceAsTemplate() {
  const name = prompt('Template name:');
  if (!name) return;
  const desc = prompt('Description (optional):') || '';
  const tagsRaw = prompt('Tags (comma-separated, optional):') || '';
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

  const fileList = await listFiles();
  const files = {};
  for (const f of fileList) {
    if (f.content && !f.content.startsWith('__b64__:')) {
      files[f.path] = f.content;
    }
  }

  const tpl = {
    id: 'u-' + Date.now(),
    name: name.trim(),
    description: desc.trim(),
    tags,
    emoji: '⭐',
    files,
    isUser: true,
  };

  // If signed in, offer cloud save
  if (_getApiToken()) {
    const choice = confirm(
      `Save "${tpl.name}" as template?\n\nOK = Save to org cloud (shareable with team)\nCancel = Save locally only`
    );
    if (choice) {
      // Also save locally so it shows under "Yours"
      _userTemplates.push(tpl);
      await _saveUserTemplates();
      await _cloudSaveTemplate(tpl);
      return;
    }
  }

  _userTemplates.push(tpl);
  await _saveUserTemplates();
  toast(`Saved template: "${name}"`, 'success');
  // Refresh grid if modal is open
  const modal = document.getElementById('templates-modal');
  if (modal && !modal.classList.contains('hidden')) {
    _renderTemplateGrid(document.getElementById('templates-search')?.value || '');
  }
}

// ─── Modal UI ─────────────────────────────────────────────────────────────

function openTemplatesModal() {
  const modal = document.getElementById('templates-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  // Show/hide Org tab depending on sign-in state
  const orgTabBtn = document.getElementById('tpl-tab-org');
  if (orgTabBtn) orgTabBtn.style.display = _getApiToken() ? '' : 'none';
  _renderTemplateGrid('');
  // Load org / community templates in background
  _loadOrgTemplates().then(() => {
    if (!modal.classList.contains('hidden')) {
      _renderTemplateGrid(document.getElementById('templates-search')?.value || '');
    }
  });
}

function closeTemplatesModal() {
  const modal = document.getElementById('templates-modal');
  if (modal) modal.classList.add('hidden');
}

function _renderTemplateGrid(q) {
  const grid = document.getElementById('templates-grid');
  if (!grid) return;
  const query = (q || '').toLowerCase();

  // Decide which set to show based on active tab
  let pool;
  if (_activeTemplateTab === 'yours') {
    pool = _userTemplates;
  } else if (_activeTemplateTab === 'org') {
    // Cloud templates — map to card-compatible shape
    pool = _orgTemplates.map(t => ({
      ...t,
      files: t.files || {},
      isOrg: true,
      _fileCount: t.file_count || 0,
    }));
  } else {
    pool = BUILT_IN_TEMPLATES;
  }

  const filtered = query
    ? pool.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (t.description || '').toLowerCase().includes(query) ||
        (t.tags || []).some(tag => tag.includes(query)))
    : pool;

  grid.innerHTML = '';

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="template-empty">No templates match your search.</div>';
    return;
  }

  filtered.forEach(tpl => {
    const orgBadge = tpl.isOrg ? (tpl.is_public ? '<span class="tpl-org-badge">public</span>' : '<span class="tpl-org-badge">org</span>') : '';
    const fileCount = tpl.isOrg ? (tpl._fileCount || 0) : Object.keys(tpl.files || {}).length;
    const card = document.createElement('div');
    card.className = 'template-card' + (tpl.isUser ? ' user-template' : '') + (tpl.isOrg ? ' cloud-template' : '');
    card.innerHTML =
      `<div class="template-emoji">${tpl.emoji || '📄'}</div>` +
      `<div class="template-name">${tpl.name}${tpl.isUser ? ' <span class="tpl-user-badge">yours</span>' : ''}${orgBadge}</div>` +
      `<div class="template-desc">${tpl.description || ''}</div>` +
      `<div class="template-tags">${(tpl.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` +
      `<div class="template-file-count">${fileCount} files</div>` +
      (tpl.isUser ? `<button class="tpl-delete-btn" data-id="${tpl.id}">🗑 Delete</button>` : '');
    card.querySelector('.tpl-delete-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      _userTemplates = _userTemplates.filter(t => t.id !== tpl.id);
      await _saveUserTemplates();
      _renderTemplateGrid(document.getElementById('templates-search')?.value || '');
    });
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('tpl-delete-btn')) return;
      _applyTemplate(tpl);
    });
    grid.appendChild(card);
  });
}

async function _applyTemplate(tpl) {
  let resolvedTpl = tpl;

  // Cloud templates from list API only have file_count — fetch full template
  if (tpl.isOrg && (!tpl.files || Object.keys(tpl.files).length === 0)) {
    toast('Loading template…', 'info');
    try {
      const headers = {};
      const token = _getApiToken();
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(`/.netlify/functions/templates-get?id=${encodeURIComponent(tpl.id)}`, { headers });
      const data = await res.json();
      if (!data.ok || !data.template) { toast('Failed to load template', 'error'); return; }
      resolvedTpl = { ...tpl, files: data.template.files || {} };
    } catch (err) {
      toast('Failed to load template: ' + err.message, 'error');
      return;
    }
  }

  const existing = await listFiles();
  if (existing.length > 0) {
    const ok = confirm(`Apply template "${resolvedTpl.name}"?\n\nThis will REPLACE all current workspace files (${existing.length} files).`);
    if (!ok) return;
    for (const f of existing) await deleteFile(f.path);
  }

  for (const [path, content] of Object.entries(resolvedTpl.files || {})) {
    await writeFile(path, content);
  }
  await refreshFileTree();
  closeTemplatesModal();

  // Open index.html if present
  if ((resolvedTpl.files || {})['index.html'] && typeof openFileInEditor === 'function') {
    await openFileInEditor('index.html', typeof activePane !== 'undefined' ? activePane : 0);
  }
  toast(`Applied template: ${resolvedTpl.name}`, 'success');
}

// ─── Init ─────────────────────────────────────────────────────────────────

function initTemplates() {
  // Load user templates from IndexedDB
  _loadUserTemplates();

  // Tab buttons
  document.querySelectorAll('.tpl-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchTemplateTab(btn.dataset.tab));
  });

  // Search input
  const searchEl = document.getElementById('templates-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => _renderTemplateGrid(searchEl.value));
  }

  // Close button
  document.getElementById('templates-close')?.addEventListener('click', closeTemplatesModal);

  // Overlay click to close
  document.getElementById('templates-modal')?.addEventListener('click', e => {
    if (e.target.id === 'templates-modal') closeTemplatesModal();
  });

  // Toolbar button
  document.getElementById('apply-template')?.addEventListener('click', openTemplatesModal);
  document.getElementById('templates-btn')?.addEventListener('click', openTemplatesModal);

  // Save as template button (if exists in toolbar or modal)
  document.getElementById('save-as-template-btn')?.addEventListener('click', saveWorkspaceAsTemplate);
  document.getElementById('save-as-template-btn-modal')?.addEventListener('click', saveWorkspaceAsTemplate);

  // Register commands
  if (typeof COMMANDS !== 'undefined') {
    COMMANDS.push(
      {
        id: 'new-from-template',
        label: 'New from Template…',
        category: 'File',
        keybinding: '',
        action: openTemplatesModal,
      },
      {
        id: 'save-as-template',
        label: 'Save Workspace as Template',
        category: 'File',
        keybinding: '',
        action: saveWorkspaceAsTemplate,
      }
    );
  }
}
