/*
  problems.js — Client-side linting + Problems panel (Phase 5)
  Exposes: initProblems(), lintFile(path, content), renderProblems(), allProblems[]
*/

// ─── Global problems list ─────────────────────────────────────────────────
var allProblems = []; // [{file, line, col, severity, message, source}]

// ─── Linters ──────────────────────────────────────────────────────────────

function _lintJSON(path, content) {
  const probs = [];
  try { JSON.parse(content); } catch (e) {
    // Extract line/col from error message
    const m = e.message.match(/at position (\d+)/);
    let line = 1, col = 1;
    if (m) {
      const pos = parseInt(m[1]);
      const before = content.slice(0, pos);
      line = (before.match(/\n/g) || []).length + 1;
      col = pos - before.lastIndexOf('\n');
    }
    probs.push({ file: path, line, col, severity: 'error', message: e.message, source: 'JSON' });
  }
  return probs;
}

function _lintJS(path, content) {
  const probs = [];
  const lines = content.split('\n');
  let depth = { brace: 0, paren: 0, bracket: 0 };
  lines.forEach((l, i) => {
    // Skip strings/comments roughly
    const stripped = l.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*/g, '');
    for (const ch of stripped) {
      if (ch === '{') depth.brace++;
      else if (ch === '}') { depth.brace--; if (depth.brace < 0) { probs.push({ file: path, line: i + 1, col: 1, severity: 'error', message: 'Unexpected "}"', source: 'JS' }); depth.brace = 0; } }
      else if (ch === '(') depth.paren++;
      else if (ch === ')') { depth.paren--; if (depth.paren < 0) { probs.push({ file: path, line: i + 1, col: 1, severity: 'error', message: 'Unexpected ")"', source: 'JS' }); depth.paren = 0; } }
      else if (ch === '[') depth.bracket++;
      else if (ch === ']') { depth.bracket--; if (depth.bracket < 0) { probs.push({ file: path, line: i + 1, col: 1, severity: 'error', message: 'Unexpected "]"', source: 'JS' }); depth.bracket = 0; } }
    }
    // console.error hint
    if (l.includes('console.error')) probs.push({ file: path, line: i + 1, col: l.indexOf('console.error') + 1, severity: 'info', message: 'console.error in production code', source: 'JS' });
    // debugger statement
    if (/\bdebugger\b/.test(l)) probs.push({ file: path, line: i + 1, col: 1, severity: 'warning', message: 'debugger statement left in code', source: 'JS' });
  });
  if (depth.brace !== 0) probs.push({ file: path, line: lines.length, col: 1, severity: 'error', message: `Unbalanced braces (${depth.brace > 0 ? '+' : ''}${depth.brace})`, source: 'JS' });
  if (depth.paren !== 0) probs.push({ file: path, line: lines.length, col: 1, severity: 'error', message: `Unbalanced parentheses (${depth.paren > 0 ? '+' : ''}${depth.paren})`, source: 'JS' });
  if (depth.bracket !== 0) probs.push({ file: path, line: lines.length, col: 1, severity: 'error', message: `Unbalanced brackets (${depth.bracket > 0 ? '+' : ''}${depth.bracket})`, source: 'JS' });
  return probs;
}

function _lintCSS(path, content) {
  const probs = [];
  const lines = content.split('\n');
  let depth = 0;
  lines.forEach((l, i) => {
    const stripped = l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"|'[^']*'/g, '');
    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth < 0) { probs.push({ file: path, line: i + 1, col: 1, severity: 'error', message: 'Unexpected "}" in CSS', source: 'CSS' }); depth = 0; } }
    }
    // Detect !important overuse
    if ((l.match(/!important/g) || []).length > 1)
      probs.push({ file: path, line: i + 1, col: 1, severity: 'info', message: 'Multiple !important on one line', source: 'CSS' });
  });
  if (depth !== 0)
    probs.push({ file: path, line: lines.length, col: 1, severity: 'error', message: `Unbalanced braces in CSS (${depth > 0 ? '+' : ''}${depth})`, source: 'CSS' });
  return probs;
}

function _lintHTML(path, content) {
  const probs = [];
  // Self-closing void elements
  const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const stack = [];
  const tagRx = /<(\/?)([\w-]+)([^>]*)>/gi;
  const lines = content.split('\n');

  // Map position to line number
  function posToLine(pos) {
    let cur = 0, line = 1;
    for (const l of lines) { cur += l.length + 1; if (cur > pos) break; line++; }
    return line;
  }

  let m;
  while ((m = tagRx.exec(content)) !== null) {
    const close = !!m[1];
    const tag = m[2].toLowerCase();
    if (voids.has(tag)) continue;
    if (m[3].trim().endsWith('/')) continue; // self-closing
    if (close) {
      if (stack.length && stack[stack.length - 1] === tag) stack.pop();
      else probs.push({ file: path, line: posToLine(m.index), col: 1, severity: 'warning', message: `Unexpected closing </${tag}>`, source: 'HTML' });
    } else {
      stack.push(tag);
    }
  }
  stack.forEach(tag => probs.push({ file: path, line: lines.length, col: 1, severity: 'warning', message: `Unclosed <${tag}>`, source: 'HTML' }));

  // img without alt
  const imgRx = /<img\b([^>]*)>/gi;
  while ((m = imgRx.exec(content)) !== null) {
    if (!m[1].includes('alt='))
      probs.push({ file: path, line: posToLine(m.index), col: 1, severity: 'info', message: '<img> missing alt attribute', source: 'HTML' });
  }
  return probs;
}

// ─── Public API ───────────────────────────────────────────────────────────

function lintFile(path, content) {
  if (!path || content === undefined) return [];
  const ext = (path.split('.').pop() || '').toLowerCase();
  let probs = [];
  if (ext === 'json') probs = _lintJSON(path, content);
  else if (['js', 'mjs', 'ts', 'jsx', 'tsx'].includes(ext)) probs = _lintJS(path, content);
  else if (['css', 'scss', 'less'].includes(ext)) probs = _lintCSS(path, content);
  else if (['html', 'htm'].includes(ext)) probs = _lintHTML(path, content);

  // Remove old problems for this file and add new
  allProblems = allProblems.filter(p => p.file !== path).concat(probs);
  renderProblems();
  return probs;
}

function renderProblems() {
  const panel = document.getElementById('problems-list');
  if (!panel) return;

  // Update badge
  const errCount = allProblems.filter(p => p.severity === 'error').length;
  const warnCount = allProblems.filter(p => p.severity === 'warning').length;
  const badge = document.getElementById('problems-badge');
  if (badge) badge.textContent = errCount + warnCount || '';

  // Active filter
  const filterVal = document.getElementById('problems-filter')?.value || 'all';
  let list = allProblems;
  if (filterVal === 'errors') list = allProblems.filter(p => p.severity === 'error');
  else if (filterVal === 'warnings') list = allProblems.filter(p => p.severity === 'warning');

  panel.innerHTML = '';
  if (!list.length) {
    panel.innerHTML = '<div class="problems-empty">No problems detected ✓</div>';
    return;
  }

  const severityIcon = { error: '✕', warning: '⚠', info: 'ℹ' };

  // Group by file
  const byFile = {};
  list.forEach(p => { if (!byFile[p.file]) byFile[p.file] = []; byFile[p.file].push(p); });

  Object.keys(byFile).sort().forEach(file => {
    const group = document.createElement('div');
    group.className = 'problems-file-group';

    const header = document.createElement('div');
    header.className = 'problems-file-label';
    const fname = file.split('/').pop();
    header.innerHTML = `<span>${fname}</span><span class="problems-file-path">${file}</span><span class="problems-count">${byFile[file].length}</span>`;
    header.addEventListener('click', () => group.classList.toggle('collapsed'));
    group.appendChild(header);

    byFile[file].forEach(p => {
      const row = document.createElement('div');
      row.className = `problem-row problem-${p.severity}`;
      row.innerHTML =
        `<span class="problem-icon">${severityIcon[p.severity] || '•'}</span>` +
        `<span class="problem-msg">${p.message}</span>` +
        `<span class="problem-loc">${p.file.split('/').pop()}:${p.line}:${p.col}</span>` +
        `<span class="problem-src">${p.source}</span>`;
      row.addEventListener('click', async () => {
        if (typeof openFileInEditor === 'function') {
          await openFileInEditor(p.file, typeof activePane !== 'undefined' ? activePane : 0);
        }
        // Jump to line
        await new Promise(r => setTimeout(r, 80));
        const tab = (typeof tabs !== 'undefined') && tabs.find(t => t.path === p.file && t.id === activeTabId);
        if (tab) {
          const ta = document.getElementById('editor-' + tab.pane);
          if (ta) {
            const ls = ta.value.split('\n');
            let pos = 0;
            for (let i = 0; i < p.line - 1 && i < ls.length; i++) pos += ls[i].length + 1;
            ta.focus();
            ta.setSelectionRange(pos + (p.col - 1), pos + (p.col - 1) + 1);
            const lineH = parseInt(getComputedStyle(ta).lineHeight) || 20;
            ta.scrollTop = Math.max(0, (p.line - 5) * lineH);
          }
        }
      });
      group.appendChild(row);
    });
    panel.appendChild(group);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────
function initProblems() {
  const filterEl = document.getElementById('problems-filter');
  if (filterEl) filterEl.addEventListener('change', renderProblems);

  const clearBtn = document.getElementById('problems-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => { allProblems = []; renderProblems(); });

  // Register commands
  if (typeof COMMANDS !== 'undefined') {
    COMMANDS.push(
      { id: 'open-problems', label: 'Open Problems Panel', category: 'View', action: () => setActiveTab('problems') },
      { id: 'lint-file', label: 'Lint Active File', category: 'Editor', action: async () => {
        const tab = (typeof tabs !== 'undefined') && tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        const ta = document.getElementById('editor-' + tab.pane);
        if (ta) { lintFile(tab.path, ta.value); setActiveTab('problems'); toast('Lint complete'); }
      }},
    );
  }

  renderProblems();
}
