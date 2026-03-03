const DEMO_PROJECTS = [
  {
    id: 'hello-world',
    emoji: '👋',
    name: 'Hello World',
    description: 'Simple HTML/CSS/JS starter.',
    files: {
      'index.html': '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hello</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Hello World</h1><p>kAIxU demo starter.</p><button id="btn">Count: <span id="n">0</span></button></main><script src="app.js"><\/script></body></html>',
      'style.css': 'body{font-family:system-ui;background:#12091f;color:#eadcff;display:grid;place-items:center;min-height:100vh}main{text-align:center}button{padding:.6rem 1rem;border:0;border-radius:8px;background:#7c3aed;color:#fff;cursor:pointer}',
      'app.js': 'const b=document.getElementById("btn");const n=document.getElementById("n");let c=0;b&&b.addEventListener("click",()=>{n.textContent=String(++c)});'
    }
  },
  {
    id: 'landing',
    emoji: '🚀',
    name: 'Landing Page',
    description: 'Single-page landing template.',
    files: {
      'index.html': '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Landing</title><link rel="stylesheet" href="style.css"></head><body><header><b>My Product</b><a href="#">Get Started</a></header><section><h1>Ship faster</h1><p>Starter landing page.</p></section></body></html>',
      'style.css': 'body{font-family:system-ui;background:#0f0b1b;color:#ece3ff;margin:0}header{display:flex;justify-content:space-between;padding:1rem 1.2rem;border-bottom:1px solid #2b2040}a{color:#b58cff}section{padding:3rem 1.2rem}h1{margin:0 0 .5rem}'
    }
  },
  {
    id: 'api-docs',
    emoji: '📖',
    name: 'API Docs',
    description: 'Documentation starter with sections.',
    files: {
      'index.html': '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Docs</title><link rel="stylesheet" href="style.css"></head><body><h1>API Docs</h1><h2>Auth</h2><p>Use Bearer token.</p><h2>Endpoints</h2><pre>GET /v1/users</pre></body></html>',
      'style.css': 'body{font-family:system-ui;background:#100a1c;color:#e8d9ff;padding:2rem;line-height:1.6}pre{background:#1b1130;padding:.8rem;border-radius:8px}'
    }
  }
];

function closeDemoModal() {
  document.getElementById('demo-modal')?.classList.add('hidden');
}

async function loadDemoProject(project) {
  if (!project || !project.files) return;
  const entries = Object.entries(project.files);
  for (const [path, content] of entries) {
    await writeFile(path, String(content));
  }
  await refreshFileTree();
  try {
    if (project.files['index.html']) {
      await openFileInEditor('index.html', typeof activePane === 'number' ? activePane : 0);
    }
  } catch {}
  if (!document.getElementById('preview-section')?.classList.contains('hidden')) {
    updatePreview();
  }
  if (typeof markOnboardingStep === 'function') markOnboardingStep('upload');
  toast(`Loaded demo: ${project.name}`, 'success');
  closeDemoModal();
}

function openDemoModal() {
  const modal = document.getElementById('demo-modal');
  const list = document.getElementById('demo-project-list');
  if (!modal || !list) return;
  list.innerHTML = '';
  for (const project of DEMO_PROJECTS) {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.innerHTML = `<div style="font-size:22px">${project.emoji}</div><div style="font-weight:700">${project.name}</div><div class="muted" style="font-size:12px">${project.description}</div>`;
    const actions = document.createElement('div');
    actions.style.marginTop = '10px';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Load';
    btn.addEventListener('click', () => loadDemoProject(project));
    actions.appendChild(btn);
    card.appendChild(actions);
    list.appendChild(card);
  }
  modal.classList.remove('hidden');
}

function initDemo() {
  document.getElementById('demo-loader-btn')?.addEventListener('click', openDemoModal);
  document.getElementById('demo-modal-close')?.addEventListener('click', closeDemoModal);
  document.getElementById('demo-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeDemoModal();
  });
}
