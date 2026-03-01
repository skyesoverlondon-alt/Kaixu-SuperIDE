/*
  demo.js — Demo project loader for the kAIxU Super IDE
  Provides starter projects that users can load into their workspace.
  Called from app.js as initDemo().
*/

/* ─── Starter projects ──────────────────────────────────────────────────────── */
const DEMO_PROJECTS = [
  {
    id: 'hello-world',
    emoji: '👋',
    name: 'Hello World',
    description: 'Simple HTML page with CSS and a JS counter.',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hello World</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="container">
    <h1>Hello, World! 👋</h1>
    <p>Edit this file in kAIxU Super IDE and watch the preview update live.</p>
    <button id="counter-btn">Clicked: <span id="count">0</span></button>
  </div>
  <script src="app.js"><\/script>
</body>
</html>`,
      'style.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: linear-gradient(135deg, #1a0e2e, #12091f);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e8d8ff;
}
.container { text-align: center; padding: 2rem; }
h1 { font-size: 2.5rem; margin-bottom: 1rem; }
p { color: #b0a0d0; margin-bottom: 2rem; }
button {
  background: linear-gradient(135deg, #a259ff, #7c3aed);
  border: none; border-radius: 12px; color: #fff;
  font-size: 1.1rem; padding: 0.75rem 2rem; cursor: pointer;
  transition: opacity .2s;
}
button:hover { opacity: .85; }`,
      'app.js': `const btn = document.getElementById('counter-btn');
const count = document.getElementById('count');
let n = 0;
btn.addEventListener('click', () => { count.textContent = ++n; });`,
    },
  },

  {
    id: 'landing-page',
    emoji: '🚀',
    name: 'Landing Page',
    description: 'A clean SaaS-style landing page template.',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MyProduct — Build faster</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header>
    <nav><span class="logo">⬡ MyProduct</span><a href="#contact" class="nav-cta">Get Started</a></nav>
  </header>
  <main>
    <section class="hero">
      <h1>Build <em>faster</em> with MyProduct</h1>
      <p>The all-in-one platform for teams who ship. No config. No waiting.</p>
      <div class="hero-btns">
        <a href="#" class="btn-primary">Start for free</a>
        <a href="#" class="btn-secondary">Watch demo</a>
      </div>
    </section>
    <section class="features">
      <div class="feature">🔒<h3>Secure by default</h3><p>End-to-end encrypted. SOC2 ready.</p></div>
      <div class="feature">⚡<h3>Blazing fast</h3><p>P95 latency under 50ms globally.</p></div>
      <div class="feature">🤝<h3>Team ready</h3><p>Roles, orgs, and RBAC built in.</p></div>
    </section>
  </main>
  <footer><p>© 2026 MyProduct Inc.</p></footer>
  <script src="app.js"><\/script>
</body>
</html>`,
      'style.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --accent: #a259ff; --bg: #0d0914; --txt: #e8d8ff; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--txt); line-height: 1.6; }
nav { display: flex; justify-content: space-between; align-items: center; padding: 1.2rem 2rem; border-bottom: 1px solid rgba(255,255,255,.08); }
.logo { font-weight: 700; font-size: 1.2rem; color: var(--accent); }
.nav-cta { background: var(--accent); color: #fff; padding: .5rem 1.2rem; border-radius: 8px; text-decoration: none; font-size: .9rem; }
.hero { text-align: center; padding: 6rem 2rem 4rem; }
.hero h1 { font-size: clamp(2rem, 5vw, 3.5rem); margin-bottom: 1rem; }
.hero em { color: var(--accent); font-style: normal; }
.hero p { color: #b0a0d0; font-size: 1.15rem; margin-bottom: 2.5rem; }
.hero-btns { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
.btn-primary { background: var(--accent); color: #fff; padding: .75rem 2rem; border-radius: 10px; text-decoration: none; font-weight: 600; }
.btn-secondary { background: rgba(162,89,255,.1); border: 1px solid var(--accent); color: var(--accent); padding: .75rem 2rem; border-radius: 10px; text-decoration: none; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; max-width: 900px; margin: 0 auto; padding: 2rem; }
.feature { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 1.5rem; text-align: center; }
.feature h3 { margin: .75rem 0 .5rem; }
.feature p { color: #9080c0; font-size: .9rem; }
footer { text-align: center; padding: 2rem; color: #6050a0; font-size: .85rem; }`,
      'app.js': `// Landing page interactions
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
  });
});`,
    },
  },

  {
    id: 'dashboard',
    emoji: '📊',
    name: 'Admin Dashboard',
    description: 'Charts, stats cards, and a data table layout.',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <aside class="sidebar">
    <div class="sidebar-logo">⬡ Dash</div>
    <nav><a href="#" class="active">Overview</a><a href="#">Users</a><a href="#">Reports</a><a href="#">Settings</a></nav>
  </aside>
  <main class="main">
    <header class="top-bar"><h2>Overview</h2><span id="clock"></span></header>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-value">12,480</div><div class="stat-delta positive">+8.3%</div></div>
      <div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-value">$84,200</div><div class="stat-delta positive">+12.1%</div></div>
      <div class="stat-card"><div class="stat-label">Active Sessions</div><div class="stat-value">342</div><div class="stat-delta negative">-2.4%</div></div>
      <div class="stat-card"><div class="stat-label">Error Rate</div><div class="stat-value">0.12%</div><div class="stat-delta positive">-0.04%</div></div>
    </div>
    <div class="chart-placeholder">📈 Chart area — connect your data source</div>
    <table class="data-table">
      <thead><tr><th>User</th><th>Email</th><th>Plan</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Alice Kim</td><td>alice@example.com</td><td>Pro</td><td><span class="badge green">Active</span></td></tr>
        <tr><td>Bob Hart</td><td>bob@example.com</td><td>Team</td><td><span class="badge green">Active</span></td></tr>
        <tr><td>Carol Diaz</td><td>carol@example.com</td><td>Free</td><td><span class="badge grey">Inactive</span></td></tr>
      </tbody>
    </table>
  </main>
  <script src="app.js"><\/script>
</body>
</html>`,
      'style.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg: #0d0914; --bg2: #140b24; --bg3: #1c1030; --accent: #a259ff; --txt: #e0d0ff; --muted: #7060a0; --border: rgba(255,255,255,.08); }
body { display: flex; min-height: 100vh; font-family: system-ui, sans-serif; background: var(--bg); color: var(--txt); font-size: 14px; }
.sidebar { width: 200px; background: var(--bg2); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 1.5rem 1rem; gap: 1rem; flex-shrink: 0; }
.sidebar-logo { font-weight: 700; font-size: 1.1rem; color: var(--accent); padding: 0 .5rem .5rem; border-bottom: 1px solid var(--border); }
.sidebar nav { display: flex; flex-direction: column; gap: .25rem; }
.sidebar nav a { color: var(--muted); text-decoration: none; padding: .5rem .75rem; border-radius: 7px; transition: background .15s, color .15s; }
.sidebar nav a:hover, .sidebar nav a.active { background: rgba(162,89,255,.15); color: var(--accent); }
.main { flex: 1; display: flex; flex-direction: column; overflow: auto; }
.top-bar { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); font-size: .85rem; color: var(--muted); }
.top-bar h2 { font-size: 1rem; font-weight: 600; color: var(--txt); }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; padding: 1.5rem; }
.stat-card { background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 1.2rem; }
.stat-label { font-size: .75rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: .5rem; }
.stat-value { font-size: 1.6rem; font-weight: 700; }
.stat-delta { font-size: .75rem; margin-top: .25rem; }
.positive { color: #60d090; } .negative { color: #ff7070; }
.chart-placeholder { margin: 0 1.5rem 1.5rem; background: var(--bg3); border: 1px dashed var(--border); border-radius: 10px; padding: 3rem; text-align: center; color: var(--muted); }
.data-table { width: calc(100% - 3rem); margin: 0 1.5rem 1.5rem; border-collapse: collapse; }
.data-table th { text-align: left; padding: .75rem 1rem; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); border-bottom: 1px solid var(--border); }
.data-table td { padding: .75rem 1rem; border-bottom: 1px solid rgba(255,255,255,.04); }
.badge { font-size: .7rem; padding: .25rem .6rem; border-radius: 20px; font-weight: 600; }
.badge.green { background: rgba(96,208,144,.15); color: #60d090; }
.badge.grey { background: rgba(255,255,255,.06); color: var(--muted); }`,
      'app.js': `// Clock
const clock = document.getElementById('clock');
function tick() { if (clock) clock.textContent = new Date().toLocaleTimeString(); }
tick(); setInterval(tick, 1000);`,
    },
  },

  {
    id: 'api-readme',
    emoji: '📖',
    name: 'API Docs',
    description: 'Documentation site with sidebar navigation.',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>API Docs</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <aside class="doc-nav">
    <div class="doc-logo">📖 Docs</div>
    <ul>
      <li><a href="#intro">Introduction</a></li>
      <li><a href="#auth">Authentication</a></li>
      <li><a href="#endpoints">Endpoints</a></li>
      <li><a href="#errors">Errors</a></li>
    </ul>
  </aside>
  <main class="doc-main">
    <h1 id="intro">Introduction</h1>
    <p>Welcome to the API documentation. All requests require a valid Bearer token.</p>
    <div class="code-block"><pre>Base URL: https://api.example.com/v1</pre></div>
    <h2 id="auth">Authentication</h2>
    <p>Pass your API key in the <code>Authorization</code> header:</p>
    <div class="code-block"><pre>Authorization: Bearer YOUR_API_KEY</pre></div>
    <h2 id="endpoints">Endpoints</h2>
    <div class="endpoint"><span class="method get">GET</span><code>/users</code><p>List all users in your org.</p></div>
    <div class="endpoint"><span class="method post">POST</span><code>/users</code><p>Create a new user.</p></div>
    <div class="endpoint"><span class="method del">DELETE</span><code>/users/:id</code><p>Delete a user by ID.</p></div>
    <h2 id="errors">Error Codes</h2>
    <table><thead><tr><th>Code</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td>400</td><td>Bad request — check your payload.</td></tr>
      <tr><td>401</td><td>Unauthorized — invalid or missing token.</td></tr>
      <tr><td>429</td><td>Rate limited — slow down.</td></tr>
      <tr><td>500</td><td>Server error — try again later.</td></tr>
    </tbody></table>
  </main>
  <script src="app.js"><\/script>
</body>
</html>`,
      'style.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { display: flex; font-family: system-ui, sans-serif; background: #0f0c1e; color: #d8cdf0; line-height: 1.7; }
.doc-nav { width: 220px; position: sticky; top: 0; height: 100vh; background: #140b24; border-right: 1px solid rgba(255,255,255,.08); padding: 1.5rem 1rem; flex-shrink: 0; }
.doc-logo { font-weight: 700; margin-bottom: 1.5rem; color: #c080ff; }
.doc-nav ul { list-style: none; display: flex; flex-direction: column; gap: .25rem; }
.doc-nav a { color: #9080b0; text-decoration: none; padding: .4rem .75rem; display: block; border-radius: 6px; font-size: .9rem; }
.doc-nav a:hover { color: #c080ff; background: rgba(162,89,255,.12); }
.doc-main { flex: 1; max-width: 780px; padding: 2.5rem 3rem; }
h1 { font-size: 2rem; margin-bottom: 1rem; color: #e8d8ff; }
h2 { font-size: 1.3rem; margin: 2.5rem 0 1rem; color: #c8b8f0; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: .5rem; }
p { color: #b0a0d0; margin-bottom: 1rem; }
code { background: rgba(162,89,255,.15); color: #c8a8ff; padding: .1em .4em; border-radius: 4px; font-size: .9em; }
.code-block { background: #1a1030; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; padding: 1rem 1.5rem; margin: 1rem 0; }
.code-block pre { color: #a8f0c8; font-family: monospace; font-size: .9rem; }
.endpoint { background: #1a1030; border: 1px solid rgba(255,255,255,.06); border-radius: 8px; padding: 1rem 1.2rem; margin-bottom: 1rem; display: flex; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.method { font-size: .75rem; font-weight: 700; padding: .25rem .6rem; border-radius: 4px; flex-shrink: 0; margin-top: .1rem; }
.method.get { background: rgba(96,168,224,.2); color: #60a8e0; }
.method.post { background: rgba(96,208,144,.2); color: #60d090; }
.method.del { background: rgba(255,100,100,.2); color: #ff7070; }
table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
th { text-align: left; padding: .6rem 1rem; color: #7060a0; font-size: .8rem; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,.08); }
td { padding: .65rem 1rem; border-bottom: 1px solid rgba(255,255,255,.04); color: #b0a0d0; }`,
      'app.js': `// Smooth scroll for doc nav
document.querySelectorAll('.doc-nav a').forEach(a => {
  a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
  });
});`,
    },
  },
];

/* ─── Modal UI ──────────────────────────────────────────────────────────────── */
function initDemo() {
  const btn = document.getElementById('demo-loader-btn');
  if (btn) btn.addEventListener('click', openDemoModal);

  // Also wire the close button once DOM is ready
  document.getElementById('demo-modal-close')?.addEventListener('click', closeDemoModal);
  document.getElementById('demo-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDemoModal();
  });
}

function openDemoModal() {
  const modal = document.getElementById('demo-modal');
  if (!modal) return;
  const list = document.getElementById('demo-project-list');
  if (list && !list.dataset.rendered) {
    list.innerHTML = '';
    DEMO_PROJECTS.forEach(p => {
      const card = document.createElement('div');
      card.className = 'demo-card';
      card.innerHTML = `
        <div class="demo-card-emoji">${p.emoji}</div>
        <div class="demo-card-info">
          <div class="demo-card-name">${p.name}</div>
          <div class="demo-card-desc">${p.description}</div>
        </div>
        <button class="demo-load-btn" data-id="${p.id}">Load</button>
      `;
      card.querySelector('.demo-load-btn').addEventListener('click', () => loadDemoProject(p.id));
      list.appendChild(card);
    });
    list.dataset.rendered = '1';
  }
  modal.classList.remove('hidden');
}

function closeDemoModal() {
  document.getElementById('demo-modal')?.classList.add('hidden');
}

async function loadDemoProject(id) {
  const project = DEMO_PROJECTS.find(p => p.id === id);
  if (!project) return;

  // Confirm if workspace has files
  const existing = typeof listFiles === 'function' ? await listFiles() : [];
  if (existing.length > 0) {
    const ok = confirm(`Load "${project.name}"? This will add files to your workspace (existing files are kept).`);
    if (!ok) return;
  }

  for (const [path, content] of Object.entries(project.files)) {
    if (typeof writeFile === 'function') await writeFile(path, content);
  }

  if (typeof refreshFileTree === 'function') await refreshFileTree();
  if (typeof openFileInEditor === 'function') {
    await openFileInEditor('index.html', 0);
  }
  if (typeof toast === 'function') toast(`✅ Loaded "${project.name}"`, 'success');
  if (typeof markOnboardingStep === 'function') markOnboardingStep('upload');

  closeDemoModal();
}
