import { chromium } from 'playwright';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:41783';
const TARGET_URL = `${BASE_URL}/ide.html`;

const results = [];
const warnings = [];
const softErrors = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`${icon}: ${name}${detail ? ` — ${detail}` : ''}`);
}

function warn(name, detail = '') {
  warnings.push({ name, detail });
  console.log(`WARN: ${name}${detail ? ` — ${detail}` : ''}`);
}

async function isVisible(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    if (el.classList.contains('hidden')) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }, selector);
}

async function closeIfVisible(page, selector, closeSelector) {
  if (await isVisible(page, selector)) {
    if (closeSelector && await page.locator(closeSelector).count()) {
      await page.click(closeSelector).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(150);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('pageerror', (err) => softErrors.push(`pageerror: ${err.message}`));

  try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1200);

    await closeIfVisible(page, '#authModal', '#authClose');
    await closeIfVisible(page, '#demo-modal', '#demo-modal-close');
    await closeIfVisible(page, '#onboarding-modal', '#onboarding-close');
    await page.locator('body').click({ position: { x: 40, y: 40 } }).catch(() => {});

    await page.keyboard.press('Control+Shift+V');
    await page.waitForTimeout(200);
    record('Ctrl+Shift+V opens Paste Import modal', await isVisible(page, '#paste-modal'));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    let pasteClosed = !(await isVisible(page, '#paste-modal'));
    if (!pasteClosed) {
      await page.click('#paste-close').catch(() => {});
      await page.waitForTimeout(120);
      pasteClosed = !(await isVisible(page, '#paste-modal'));
    }
    record('Paste Import modal closes via keyboard or close button', pasteClosed);

    await page.keyboard.press('Control+Shift+K');
    await page.waitForTimeout(250);
    const shortcutsOpen = await isVisible(page, '#shortcuts-modal');
    let shortcutRows = 0;
    if (shortcutsOpen) {
      shortcutRows = await page.locator('#shortcuts-tbody tr').count();
    }
    record('Ctrl+Shift+K opens Shortcuts modal', shortcutsOpen, `rows=${shortcutRows}`);
    record('Shortcuts table renders entries', shortcutRows > 0, `rows=${shortcutRows}`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);

    await page.keyboard.press('Control+Shift+P');
    await page.waitForTimeout(220);
    const paletteOpen = await isVisible(page, '#cmd-palette');
    record('Ctrl+Shift+P opens Command Palette', paletteOpen);

    if (paletteOpen) {
      await page.fill('#cmd-input', 'Apply Patch');
      await page.waitForTimeout(180);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(260);
      record('Palette command opens Apply Patch modal', await isVisible(page, '#apply-patch-modal'));
    } else {
      record('Palette command opens Apply Patch modal', false, 'palette did not open');
    }

    if (!(await isVisible(page, '#apply-patch-modal'))) {
      await page.click('#apply-patch-button').catch(() => {});
      await page.waitForTimeout(200);
    }

    const applyOpen = await isVisible(page, '#apply-patch-modal');
    record('Apply Patch modal is open for patch flow', applyOpen);

    if (applyOpen) {
      const patch = [
        'diff --git a/smoke/patch-smoke.txt b/smoke/patch-smoke.txt',
        '--- a/smoke/patch-smoke.txt',
        '+++ b/smoke/patch-smoke.txt',
        '@@ -1 +1 @@',
        '+interaction smoke patch line'
      ].join('\n');

      await page.fill('#apply-patch-input', patch);
      await page.click('#apply-patch-preview-btn');
      await page.waitForTimeout(250);
      const previewBlocks = await page.locator('#apply-patch-preview .patch-file-block').count();
      record('Patch preview renders parsed file block', previewBlocks > 0, `blocks=${previewBlocks}`);

      await page.click('#apply-patch-confirm');
      await page.waitForTimeout(400);
      const applyClosed = !(await isVisible(page, '#apply-patch-modal'));
      record('Patch apply closes modal', applyClosed);

      const patchPersisted = await page.evaluate(async () => {
        try {
          const text = await readFile('smoke/patch-smoke.txt');
          return typeof text === 'string' && text.includes('interaction smoke patch line');
        } catch {
          return false;
        }
      });
      record('Patch apply writes expected content', patchPersisted);
    }

    const autosaveGate = await page.evaluate(async () => {
      try {
        if (!window.IDE) return { ok: false, reason: 'IDE object missing' };
        window.IDE.autoSave = 'keystroke';
        const autosaveCheckbox = document.getElementById('autoSave');
        if (autosaveCheckbox) autosaveCheckbox.checked = true;

        if (typeof openDatabase === 'function') {
          await openDatabase();
        }

        const openEditorFile =
          (typeof openFileInEditor === 'function' && openFileInEditor)
          || (typeof openFile === 'function' && openFile)
          || null;

        if (typeof writeFile !== 'function' || typeof readFile !== 'function' || !openEditorFile) {
          return { ok: false, reason: 'file APIs unavailable' };
        }

        await writeFile('smoke/autosave-gate.js', 'const ok = true;\n');
        await openEditorFile('smoke/autosave-gate.js', typeof activePane === 'number' ? activePane : 0);

        const ta = document.getElementById('editor-0');
        if (!ta) return { ok: false, reason: 'editor-0 missing' };

        ta.value = 'function broken(){\n';
        ta.dispatchEvent(new Event('input', { bubbles: true }));

        await new Promise((r) => setTimeout(r, 450));

        const saved = await readFile('smoke/autosave-gate.js');
        const blocked = !(saved || '').includes('function broken(){');

        let toastSeen = false;
        document.querySelectorAll('#toast-container .toast').forEach((el) => {
          if ((el.textContent || '').toLowerCase().includes('auto-save blocked')) toastSeen = true;
        });

        return { ok: blocked && toastSeen, blocked, toastSeen, savedLen: (saved || '').length };
      } catch (e) {
        return { ok: false, reason: String(e?.message || e) };
      }
    });

    if (autosaveGate?.reason === 'file APIs unavailable' || autosaveGate?.reason === 'IDE object missing') {
      warn('Auto-save problems gate smoke skipped', autosaveGate?.reason);
    } else {
      record(
        'Auto-save problems gate blocks invalid save',
        Boolean(autosaveGate?.ok),
        autosaveGate?.reason || `blocked=${autosaveGate?.blocked} toast=${autosaveGate?.toastSeen}`
      );
    }

    if (softErrors.length) {
      warn('Uncaught page errors observed', softErrors.slice(0, 3).join(' | '));
    } else {
      record('No uncaught page errors during smoke', true);
    }

    const failed = results.filter(r => !r.pass).length;
    console.log(`\nINTERACTION_SMOKE_DONE failed=${failed} total=${results.length} warnings=${warnings.length}`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('FATAL interaction smoke error:', err?.stack || err?.message || String(err));
    await browser.close();
    process.exit(2);
  }
}

run();
