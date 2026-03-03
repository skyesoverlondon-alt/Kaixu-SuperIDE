#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const includeFiles = [
  'README.md',
  'SECURITY.md',
  '.well-known/security.txt',
  'privacy.html',
  'terms.html',
  'dpa.html',
  'security.html',
  'subprocessors.html',
  'sla.html',
  'docs/enterprise/README.md',
  'docs/enterprise/SECURITY-GOVERNANCE.md',
  'docs/enterprise/INCIDENT-RESPONSE-RUNBOOK.md',
  'docs/enterprise/DISASTER-RECOVERY-BCP.md',
  'docs/enterprise/VULNERABILITY-MANAGEMENT.md',
  'docs/enterprise/ACCESS-REVIEW.md',
  'docs/enterprise/THIRD-PARTY-RISK.md',
  'docs/enterprise/COMPLIANCE-ROADMAP.md',
  'docs/enterprise/REPO-GOVERNANCE-CHECKLIST.md',
  'docs/enterprise/dossier/EXECUTIVE-READINESS-BRIEF.md',
  'docs/enterprise/dossier/TRUST-SECURITY-POSTURE.md',
  'docs/enterprise/dossier/STANDARD-SECURITY-QUESTIONNAIRE.md',
  '.github/CODEOWNERS',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml'
];

const includeDirectories = [
  'docs/enterprise/evidence/access-reviews',
  'docs/enterprise/evidence/dr-drills',
  'docs/enterprise/evidence/incidents',
  'docs/enterprise/evidence/vuln-remediation',
  'docs/enterprise/evidence/vendor-reviews'
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hashFile(absolutePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(absolutePath));
  return hash.digest('hex');
}

function copyFileIntoBundle(relativePath, bundleRoot) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) return null;

  const destination = path.join(bundleRoot, relativePath);
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);

  return {
    file: relativePath,
    bytes: fs.statSync(source).size,
    sha256: hashFile(source)
  };
}

function toStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}Z`;
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function collectFilesRecursively(directoryRelativePath) {
  const absoluteDir = path.join(root, directoryRelativePath);
  if (!fs.existsSync(absoluteDir)) return [];

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryRelative = path.posix.join(directoryRelativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(entryRelative));
      continue;
    }
    files.push(entryRelative);
  }

  return files;
}

function generate() {
  const generatedAt = new Date();
  const stamp = toStamp(generatedAt);
  const outBase = path.join(root, 'artifacts', 'evidence-bundles', stamp);

  ensureDir(outBase);

  const directoryFiles = includeDirectories.flatMap((dir) => collectFilesRecursively(dir));
  const uniqueIncludeFiles = [...new Set([...includeFiles, ...directoryFiles])];

  const copied = uniqueIncludeFiles
    .map((file) => copyFileIntoBundle(file, outBase))
    .filter(Boolean);

  const missing = uniqueIncludeFiles.filter((f) => !copied.find((c) => c.file === f));

  const manifest = {
    packet: {
      name: 'kAIxU Super IDE Procurement Readiness Packet',
      company: 'Skyes Over London',
      generatedAt: generatedAt.toISOString(),
      generatedBy: 'scripts/generate-evidence-bundle.js',
      model: 'founder-led single-operator with documented compensating controls'
    },
    summary: {
      included: copied.length,
      missing: missing.length
    },
    includedFiles: copied,
    missingFiles: missing
  };

  writeText(path.join(outBase, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));

  const indexMd = [
    '# Procurement Readiness Packet',
    '',
    `- Company: **Skyes Over London**`,
    `- Product: **kAIxU Super IDE**`,
    `- Generated at (UTC): **${generatedAt.toISOString()}**`,
    `- Included artifacts: **${copied.length}**`,
    `- Missing artifacts: **${missing.length}**`,
    '',
    '## Core dossier',
    '- docs/enterprise/dossier/EXECUTIVE-READINESS-BRIEF.md',
    '- docs/enterprise/dossier/TRUST-SECURITY-POSTURE.md',
    '- docs/enterprise/dossier/STANDARD-SECURITY-QUESTIONNAIRE.md',
    '',
    '## Governance and evidence policy set',
    '- docs/enterprise/*.md',
    '- docs/enterprise/evidence/*',
    '',
    '## Integrity',
    '- See `MANIFEST.json` for SHA-256 checksums of all included files.'
  ].join('\n');

  writeText(path.join(outBase, 'README.md'), indexMd);

  const zipPath = path.join(root, 'artifacts', 'evidence-bundles', `packet-${stamp}.zip`);
  const zipResult = spawnSync('zip', ['-rq', zipPath, '.'], { cwd: outBase, stdio: 'ignore' });
  const zipCreated = zipResult.status === 0 && fs.existsSync(zipPath);

  console.log('EVIDENCE_PACKET_OK');
  console.log(`bundle_dir=${outBase}`);
  console.log(`manifest=${path.join(outBase, 'MANIFEST.json')}`);
  console.log(`zip_created=${zipCreated}`);
  if (zipCreated) {
    console.log(`zip_file=${zipPath}`);
  } else {
    console.log('zip_note=zip command unavailable; directory bundle generated successfully');
  }
}

generate();
