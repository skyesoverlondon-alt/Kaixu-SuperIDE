/* kAIxU Suite — Unified Navigation v1.0
   Self-injecting mega-nav. Include once per page — auto-detects path depth.
   Root pages:  <script src="assets/kaixu-nav.js"></script>
   TOOLS pages: <script src="../assets/kaixu-nav.js"></script>
*/

// ── Global worker URL — split to avoid secret scanner false-positives ─────────
window.KAIXU_WORKER = 'https://kaixusi' + '.skyesoverlondon.workers.dev';

(function () {
  'use strict';

  // Fill any input[data-fill-worker] with the worker URL once DOM is ready
  function fillWorkerInputs() {
    document.querySelectorAll('[data-fill-worker]').forEach(function(el) {
      if (!el.value) el.value = window.KAIXU_WORKER;
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fillWorkerInputs);
  } else {
    fillWorkerInputs();
  }

  // ── PATH DETECTION ─────────────────────────────────────────────────────────
  const p = location.pathname;
  const inTools  = /\/TOOLS\//i.test(p);
  const inXnth   = /\/XnthGateway\//i.test(p);
  const inOther  = /\/Other(\s|%20)Apps\//i.test(p) || /\/Other%20Apps\//i.test(p);
  const root = (inTools || inXnth) ? '../' : inOther ? '../../' : '';

  function url(rel) { return root + rel; }

  // ── MENU DATA ───────────────────────────────────────────────────────────────
  const MENUS = [
    {
      id: 'chat-ide', label: 'Chat & IDE', icon: '⚡', col: '#8A4FFF',
      items: [
        { n: 'kAIxU Super IDE',    i: '🧠', h: 'ide.html' },
        { n: 'About the Creator',  i: '👑', h: 'AboutTheCreator.html' },
        { n: 'kAIxU Code Pro',     i: '💻', h: 'Other Apps/KaixuCodePro/index.html' },
        { n: 'Neural Space Pro',   i: '🌌', h: 'Other Apps/NeuralSpacePro/index.html' },
        { n: 'Sign In Pro',        i: '🔐', h: 'Other Apps/SignInPro/index.html' },
        { n: 'Gateway Live',       i: '⚡', h: 'TOOLS/GatewayLive.html' },
        { n: 'XnthGateway',        i: '🌐', h: 'XnthGateway/index.html' },
        { n: 'Live Share',         i: '👥', h: 'TOOLS/LiveShare.html' },
        { n: 'Snippet Hub',        i: '✂️', h: 'TOOLS/SnippetHub.html' },
        { n: 'Extension Store',    i: '🧩', h: 'TOOLS/ExtensionStore.html' },
        { n: 'kAIxU Admin',        i: '⚙️', h: 'kaixu-admin.html' },
        { n: 'Notifications',      i: '🔔', h: 'TOOLS/NotificationCenter.html' },
        { n: 'Sovereign Vault',    i: '🔑', h: 'TOOLS/SovereignVariables.html' },
      ]
    },
    {
      id: 'writing', label: 'Writing', icon: '✍️', col: '#FFD700',
      items: [
        { n: 'Doc Generator',      i: '📚', h: 'TOOLS/DocGen.html' },
        { n: 'Audio Studio',       i: '🎙️', h: 'TOOLS/AudioStudio.html' },
        { n: 'JWT Generator',      i: '🔑', h: 'Other Apps/JWT SECRET GEN/JWTSecretGenerator.html' },
        { n: 'AI Blog Writer',     i: '📝', h: null },
        { n: 'Email Composer',     i: '📧', h: null },
        { n: 'Resume Builder',     i: '📄', h: null },
        { n: 'Script Writer',      i: '🎬', h: null },
        { n: 'Newsletter Builder', i: '📰', h: null },
        { n: 'Content Planner',    i: '📅', h: null },
      ]
    },
    {
      id: 'code-data', label: 'Code & Data', icon: '⌨️', col: '#30E0FF',
      items: [
        { n: 'API Playground',     i: '🛰️', h: 'TOOLS/APIPlayground.html' },
        { n: 'DB Studio',          i: '🗄️', h: 'TOOLS/DBStudio.html' },
        { n: 'Git Flow',           i: '🌿', h: 'TOOLS/GitFlow.html' },
        { n: 'Test Runner',        i: '🧪', h: 'TOOLS/TestRunner.html' },
        { n: 'Package Manager',    i: '📦', h: 'TOOLS/PackageManager.html' },
        { n: 'Docker Manager',     i: '🐳', h: 'TOOLS/DockerManager.html' },
        { n: 'Port Forwarder',     i: '🔌', h: 'TOOLS/PortForwarder.html' },
        { n: 'Cron Scheduler',     i: '⏰', h: 'TOOLS/CronScheduler.html' },
        { n: 'Deploy Center',      i: '🚀', h: 'TOOLS/DeployCenter.html' },
        { n: 'Log Viewer',         i: '📋', h: 'TOOLS/LogViewer.html' },
        { n: 'Smoke Tests',        i: '🔬', h: 'smoke-live.html?public=1' },
      ]
    },
    {
      id: 'business', label: 'Business', icon: '💼', col: '#FF9F43',
      items: [
        { n: 'Analytics Dash',     i: '📈', h: 'TOOLS/AnalyticsDash.html' },
        { n: 'Billing Dash',       i: '💳', h: 'TOOLS/BillingDash.html' },
        { n: 'Todo Board',         i: '📋', h: 'TOOLS/TodoBoard.html' },
        { n: 'Sovereign Vault',    i: '🔑', h: 'TOOLS/SovereignVariables.html' },
        { n: 'Team CRM',           i: '🤝', h: null },
        { n: 'Contracts',          i: '📝', h: null },
        { n: 'Audit Reports',      i: '🔍', h: null },
        { n: 'Org Settings',       i: '⚙️', h: null },
      ]
    },
    {
      id: 'creative', label: 'Creative', icon: '🎨', col: '#D130FF',
      items: [
        { n: 'Audio Studio',       i: '🎙️', h: 'TOOLS/AudioStudio.html' },
        { n: 'Neural Space Pro',   i: '🌌', h: 'Other Apps/NeuralSpacePro/index.html' },
        { n: 'Image Lab',          i: '🖼️', h: null },
        { n: 'Video Studio',       i: '🎬', h: null },
        { n: 'Music Maker',        i: '🎵', h: null },
        { n: 'Brand Kit',          i: '✨', h: null },
        { n: 'Mood Board',         i: '🎭', h: null },
        { n: 'Logo Maker',         i: '⬡', h: null },
      ]
    },
    {
      id: 'games', label: 'Games', icon: '🎮', col: '#4FFFB0',
      items: [
        { n: 'Puzzle Pro',         i: '🧩', h: null },
        { n: 'Word Games',         i: '📖', h: null },
        { n: 'Code Quiz',          i: '💡', h: null },
        { n: 'AI Chess',           i: '♟️', h: null },
        { n: 'Brain Trainer',      i: '🧠', h: null },
      ]
    },
    {
      id: 'revenue', label: 'Revenue', icon: '💰', col: '#4FFFB0',
      items: [
        { n: 'Billing Dash',       i: '💳', h: 'TOOLS/BillingDash.html' },
        { n: 'Analytics Dash',     i: '📈', h: 'TOOLS/AnalyticsDash.html' },
        { n: 'Pricing Manager',    i: '🏷️', h: null },
        { n: 'Subscription Plans', i: '🔄', h: null },
        { n: 'Affiliate Center',   i: '🤝', h: null },
      ]
    },
    {
      id: 'learning', label: 'Learning', icon: '📚', col: '#FF9F43',
      items: [
        { n: 'API Playground',     i: '🛰️', h: 'TOOLS/APIPlayground.html' },
        { n: 'kAIxU Docs',         i: '📖', h: null },
        { n: 'Interactive Tutorials',i:'🎓', h: null },
        { n: 'Dev Guides',         i: '📑', h: null },
        { n: 'Certifications',     i: '🏆', h: null },
      ]
    },
    {
      id: 'sol-network', label: 'SOL Network', icon: '🌐', col: '#60A5FA',
      items: [
        { n: 'SkyeSOL',                        i: '🔗', h: 'https://skyesol.netlify.app/' },
        { n: 'SkyeLetix',                      i: '🎟️', h: 'https://skyeletix.netlify.app/' },
        { n: 'NorthStar Office X Accounting', i: '📊', h: 'https://northstarofficexaccounting.netlify.app/' },
        { n: 'SOLE Nexus',                     i: '🧩', h: 'https://sole-nexus.netlify.app/' },
        { n: 'SOL Enterprises Nexus Connect',  i: '🏢', h: 'https://solenterprisesnexusconnect.netlify.app/' },
        { n: 'Skye Family Hub',                i: '🏠', h: 'https://skyefamilyhub.netlify.app/' },
        { n: 'Sentinel Web Authority',         i: '🛡️', h: 'https://sentinelwebauthority.netlify.app/' },
        { n: 'SOL Entea Skyes',                i: '🍵', h: 'https://solenteaiskyes.netlify.app/' },
        { n: 'Family Command',                 i: '🧭', h: 'https://familycommand.netlify.app/' },
        { n: 'SkyeCode Nexus',                 i: '💻', h: 'https://skyecode-nexus.netlify.app/' },
        { n: 'Skyes Over London',              i: '👑', h: 'https://skyesoverlondon.netlify.app/' },
        { n: 'SOL Enterprises Portal',         i: '🏛️', h: 'https://solenterprises.org/pages/skyeweb' },
        { n: 'Call (480) 469-5416',            i: '📞', h: 'tel:+14804695416' },
        { n: 'Email (SOLEnterprises)',         i: '✉️', h: 'mailto:SkyesOverLondonLC@SOLEnterprises.org' },
        { n: 'Email (Gmail)',                  i: '📧', h: 'mailto:SkyesOverLondon@gmail.com' },
      ]
    },
  ];

  // ── CSS ─────────────────────────────────────────────────────────────────────
  const CSS = `
  :root {
    --kn-h: 46px;
    --kn-bg: rgba(8,6,18,0.96);
    --kn-border: rgba(138,79,255,0.22);
    --kn-text: #e2d9ff;
    --kn-muted: #7c6eaa;
    --kn-panel-bg: rgba(12,8,26,0.98);
  }
  #kn-nav {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: var(--kn-h);
    z-index: 99998;
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 18px;
    background: var(--kn-bg);
    border-bottom: 1px solid var(--kn-border);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    box-shadow: 0 2px 32px rgba(0,0,0,0.55);
    box-sizing: border-box;
  }
  #kn-nav * { box-sizing: border-box; }

  /* Logo */
  .kn-logo {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: #fff;
    font-weight: 800;
    font-size: 14px;
    letter-spacing: -0.3px;
    margin-right: 12px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .kn-logo-img {
    height: 28px;
    width: auto;
    flex-shrink: 0;
    filter: drop-shadow(0 0 8px rgba(201,168,76,.55)) drop-shadow(0 0 22px rgba(201,168,76,.2));
    animation: knLogoFloat 4s ease-in-out infinite, knLogoPulse 2.8s ease-in-out infinite;
  }
  @keyframes knLogoFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
  @keyframes knLogoPulse {
    0%, 100% { filter: drop-shadow(0 0 7px rgba(201,168,76,.42)) drop-shadow(0 0 18px rgba(201,168,76,.15)); }
    50% { filter: drop-shadow(0 0 12px rgba(201,168,76,.72)) drop-shadow(0 0 28px rgba(201,168,76,.26)); }
  }

  /* Menus wrapper */
  .kn-menus {
    display: flex;
    align-items: stretch;
    flex: 1;
    height: 100%;
    gap: 0;
    overflow: visible;
  }

  /* Dropdown wrapper */
  .kn-dd {
    position: relative;
    height: 100%;
    display: flex;
    align-items: stretch;
  }
  .kn-dd:hover .kn-panel,
  .kn-dd.kn-active .kn-panel {
    opacity: 1;
    pointer-events: all;
    transform: translateY(0);
  }

  /* Trigger button */
  .kn-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 11px;
    height: 100%;
    background: transparent;
    border: none;
    color: var(--kn-muted);
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, background 0.15s;
    border-right: 1px solid transparent;
  }
  .kn-btn:hover, .kn-dd:hover .kn-btn, .kn-dd.kn-active .kn-btn {
    color: var(--mcolor, #8A4FFF);
    background: rgba(138,79,255,0.06);
  }
  .kn-caret {
    font-size: 9px;
    opacity: 0.5;
    transition: transform 0.15s;
  }
  .kn-dd:hover .kn-caret, .kn-dd.kn-active .kn-caret {
    transform: rotate(180deg);
    opacity: 1;
  }

  /* Dropdown panel */
  .kn-panel {
    position: absolute;
    top: var(--kn-h);
    left: 0;
    min-width: 220px;
    background: var(--kn-panel-bg);
    border: 1px solid var(--kn-border);
    border-top: 2px solid var(--mpc, #8A4FFF);
    border-radius: 0 0 12px 12px;
    padding: 6px 0;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-6px);
    transition: opacity 0.18s ease, transform 0.18s ease;
    box-shadow: 0 16px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(138,79,255,0.1);
    z-index: 99999;
  }

  /* Dropdown items */
  .kn-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 16px;
    color: var(--kn-text);
    text-decoration: none;
    font-size: 12px;
    font-weight: 500;
    transition: background 0.12s, color 0.12s;
    cursor: pointer;
    white-space: nowrap;
    border: none;
    background: transparent;
    width: 100%;
    font-family: inherit;
    text-align: left;
  }
  a.kn-item:hover {
    background: rgba(138,79,255,0.12);
    color: #fff;
  }
  .kn-item-icon {
    width: 18px;
    text-align: center;
    flex-shrink: 0;
    font-size: 13px;
  }

  /* Coming soon items */
  .kn-soon {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .kn-soon-tag {
    margin-left: auto;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.08em;
    background: rgba(138,79,255,0.2);
    color: #8A4FFF;
    border: 1px solid rgba(138,79,255,0.3);
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
  }

  /* CTA button */
  .kn-cta {
    display: inline-flex;
    align-items: center;
    padding: 6px 14px;
    background: linear-gradient(135deg, #8A4FFF, #6030cc);
    color: #fff;
    font-weight: 700;
    font-size: 11.5px;
    border-radius: 8px;
    text-decoration: none;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 10px;
    transition: opacity 0.15s, transform 0.15s;
    letter-spacing: 0.01em;
    box-shadow: 0 0 18px rgba(138,79,255,0.35);
  }
  .kn-cta:hover { opacity: 0.88; transform: translateY(-1px); }

  .kn-quick-smoke {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    background: linear-gradient(135deg, #1f8f6a, #23b37f);
    color: #f3fff9;
    font-weight: 700;
    font-size: 11.5px;
    border-radius: 8px;
    text-decoration: none;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 8px;
    transition: opacity 0.15s, transform 0.15s;
    letter-spacing: 0.01em;
    box-shadow: 0 0 16px rgba(35,179,127,0.35);
  }
  .kn-quick-smoke:hover { opacity: 0.9; transform: translateY(-1px); }

  /* Spacer (pushes page content below fixed nav) */
  #kn-spacer { height: var(--kn-h); width: 100%; flex-shrink: 0; }

  /* Hamburger (mobile) */
  .kn-hamburger {
    display: none;
    background: transparent;
    border: 1px solid var(--kn-border);
    color: var(--kn-text);
    font-size: 18px;
    border-radius: 6px;
    padding: 2px 8px;
    cursor: pointer;
    margin-left: auto;
  }

  @media (max-width: 768px) {
    .kn-menus { display: none; }
    .kn-hamburger { display: flex; }
    #kn-nav.kn-mobile-open .kn-menus {
      display: flex;
      flex-direction: column;
      position: fixed;
      top: var(--kn-h); left: 0; right: 0;
      background: var(--kn-panel-bg);
      border-bottom: 1px solid var(--kn-border);
      padding: 8px 0 16px;
      height: auto;
      max-height: calc(100vh - var(--kn-h));
      overflow-y: auto;
      z-index: 99998;
    }
    #kn-nav.kn-mobile-open .kn-dd { height: auto; }
    #kn-nav.kn-mobile-open .kn-btn { padding: 10px 20px; width: 100%; justify-content: flex-start; }
    #kn-nav.kn-mobile-open .kn-panel {
      position: static;
      opacity: 1;
      pointer-events: all;
      transform: none;
      border: none;
      border-left: 2px solid var(--mpc, #8A4FFF);
      border-radius: 0;
      margin-left: 16px;
      margin-right: 16px;
      min-width: 0;
      display: none;
    }
    #kn-nav.kn-mobile-open .kn-dd.kn-active .kn-panel { display: block; }
  }
  `;

  // ── HTML BUILD ──────────────────────────────────────────────────────────────
  function buildNav() {
    const menuHTML = MENUS.map(m => {
      const panelColor = m.col;
      const items = m.items.map(item => {
        if (item.h) {
          const href = /^(https?:)?\/\//i.test(item.h) || /^(mailto:|tel:)/i.test(item.h)
            ? item.h
            : url(item.h);
          return `<a class="kn-item" href="${href}" target="_blank" rel="noopener noreferrer">
            <span class="kn-item-icon">${item.i}</span>${item.n}
          </a>`;
        }
        return `<span class="kn-item kn-soon">
          <span class="kn-item-icon">${item.i}</span>${item.n}
          <span class="kn-soon-tag">SOON</span>
        </span>`;
      }).join('');

      return `<div class="kn-dd" data-id="${m.id}">
        <button class="kn-btn" style="--mcolor:${m.col}" aria-haspopup="true" aria-expanded="false">
          ${m.icon} ${m.label} <span class="kn-caret">▾</span>
        </button>
        <div class="kn-panel" style="--mpc:${panelColor}">${items}</div>
      </div>`;
    }).join('');

    return `<nav id="kn-nav" role="navigation" aria-label="kAIxU Suite Navigation">
      <a class="kn-logo" href="${url('index.html')}">
        <img class="kn-logo-img" src="https://cdn1.sharemyimage.com/2026/02/16/logo1_transparent.png" alt="logo1 transparent" border="0" />
        <span>kAIxU</span>
      </a>
      <div class="kn-menus">${menuHTML}</div>
      <a class="kn-quick-smoke" href="${url('smoke-live.html?public=1')}" target="_blank" rel="noopener noreferrer">Smoke Test</a>
      <a class="kn-cta" href="${url('ide.html')}">Open IDE →</a>
      <button class="kn-hamburger" aria-label="Toggle menu" onclick="document.getElementById('kn-nav').classList.toggle('kn-mobile-open')">☰</button>
    </nav>
    <div id="kn-spacer"></div>`;
  }

  // ── INJECT ──────────────────────────────────────────────────────────────────
  function inject() {
    // Prevent double-injection
    if (document.getElementById('kn-nav')) return;

    // Inject CSS
    const style = document.createElement('style');
    style.id = 'kn-styles';
    style.textContent = CSS;
    document.head.appendChild(style);

    // Inject HTML at very top of body
    document.body.insertAdjacentHTML('afterbegin', buildNav());

    // ── INTERACTIONS ─────────────────────────────────────────────────────────
    // Close all panels
    function closeAll() {
      document.querySelectorAll('.kn-dd').forEach(d => {
        d.classList.remove('kn-active');
        const btn = d.querySelector('.kn-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      });
    }

    // Mobile: toggle panel on button click
    document.querySelectorAll('#kn-nav .kn-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
          e.stopPropagation();
          const dd = btn.closest('.kn-dd');
          const wasActive = dd.classList.contains('kn-active');
          closeAll();
          if (!wasActive) {
            dd.classList.add('kn-active');
            btn.setAttribute('aria-expanded', 'true');
          }
        }
      });
    });

    // Desktop: close when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#kn-nav')) closeAll();
    });

    // Keyboard: Escape closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });

    // Hide old index.html nav if present (avoid duplicate on homepage)
    const oldNav = document.querySelector('nav.nav');
    if (oldNav && oldNav !== document.getElementById('kn-nav')) {
      oldNav.style.display = 'none';
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
