import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:41783';
const TARGET_URL = `${BASE_URL}/smoke?public=1`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLES_DIR = path.join(ROOT, 'artifacts', 'evidence-bundles');

function toStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function relativeFromRoot(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function updateSmokeLedger() {
  const ledgerPath = path.join(BUNDLES_DIR, 'SMOKE-LEDGER.json');
  const latestPath = path.join(BUNDLES_DIR, 'latest-smoke.json');

  const dirs = fs.existsSync(BUNDLES_DIR)
    ? fs.readdirSync(BUNDLES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    : [];

  const runs = [];

  for (const dir of dirs) {
    const runFile = path.join(BUNDLES_DIR, dir, 'smoke-download-verification.json');
    if (!fs.existsSync(runFile)) continue;

    try {
      const payload = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      runs.push({
        stamp: dir,
        startedAt: payload.startedAt || null,
        finishedAt: payload.finishedAt || null,
        pass: Boolean(payload.pass),
        checks: payload.checks || {},
        artifact: relativeFromRoot(runFile)
      });
    } catch {
      continue;
    }
  }

  const ledger = {
    kind: 'smoke-download-ledger',
    updatedAt: new Date().toISOString(),
    totalRuns: runs.length,
    runs
  };

  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');

  if (runs.length) {
    const latest = runs[runs.length - 1];
    fs.writeFileSync(latestPath, JSON.stringify({
      kind: 'latest-smoke-download-run',
      updatedAt: new Date().toISOString(),
      latest
    }, null, 2), 'utf8');
  }

  return { ledgerPath, latestPath, totalRuns: runs.length };
}

async function run() {
  const startedAt = new Date();
  const stamp = toStamp(startedAt);
  const evidenceDir = path.join(BUNDLES_DIR, stamp);
  const evidenceFile = path.join(evidenceDir, 'smoke-download-verification.json');

  const result = {
    test: 'smoke-download-verification',
    startedAt: startedAt.toISOString(),
    baseUrl: BASE_URL,
    targetUrl: TARGET_URL,
    checks: {
      routeOk: false,
      hasButtons: false,
      latestDownload: false,
      allDownload: false,
      statusText: ''
    },
    pass: false,
    error: null
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    const page = await context.newPage();

    await page.route('**/api/health**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, db: 'ok', gate: 'ok' })
    }));

    await page.route('**/api/smoke-public**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'smoke-download-ledger',
        updatedAt: new Date().toISOString(),
        totalRuns: 2,
        runs: [
          {
            createdAt: new Date(Date.now() - 3600_000).toISOString(),
            runId: 'run-public-1',
            verifyHash: 'a'.repeat(64),
            status: 'pass',
            total: 3,
            failed: 0,
            checks: [{ name: 'Public health endpoint', ok: true }]
          },
          {
            createdAt: new Date(Date.now() - 1800_000).toISOString(),
            runId: 'run-public-2',
            verifyHash: 'b'.repeat(64),
            status: 'pass',
            total: 3,
            failed: 0,
            checks: [{ name: 'Public ledger accessibility', ok: true }]
          }
        ]
      })
    }));

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    result.checks.routeOk = page.url().includes('/smoke') || page.url().includes('/smoke-live.html');
    result.checks.hasButtons = await page.evaluate(() => {
      return Boolean(document.getElementById('downloadLatestBtn'))
        && Boolean(document.getElementById('downloadAllBtn'));
    });

    await page.click('#runBtn');
    await page.waitForTimeout(350);

    const latestDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.click('#downloadLatestBtn');
    const latestDownload = await latestDownloadPromise;
    result.checks.latestDownload = Boolean(latestDownload?.suggestedFilename());

    const allDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.click('#downloadAllBtn');
    const allDownload = await allDownloadPromise;
    result.checks.allDownload = Boolean(allDownload?.suggestedFilename());

    result.checks.statusText = (await page.locator('#runStatus').textContent())?.trim() || '';

    result.pass = result.checks.routeOk
      && result.checks.hasButtons
      && result.checks.latestDownload
      && result.checks.allDownload;
  } catch (err) {
    result.error = String(err?.message || err);
    result.pass = false;
  } finally {
    if (browser) await browser.close();
  }

  result.finishedAt = new Date().toISOString();

  ensureDir(evidenceDir);
  fs.writeFileSync(evidenceFile, JSON.stringify(result, null, 2), 'utf8');
  const ledger = updateSmokeLedger();

  console.log('SMOKE_DOWNLOAD_EVIDENCE_WRITTEN');
  console.log(`evidence_file=${evidenceFile}`);
  console.log(`ledger_file=${ledger.ledgerPath}`);
  console.log(`latest_file=${ledger.latestPath}`);
  console.log(`ledger_runs=${ledger.totalRuns}`);
  console.log(`pass=${result.pass}`);

  if (!result.pass) {
    process.exit(1);
  }
}

run();
