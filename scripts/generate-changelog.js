#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
}

function safeRun(cmd, fallback = '') {
  try {
    return run(cmd);
  } catch {
    return fallback;
  }
}

function readPinnedEntries() {
  const pinnedPath = path.resolve(process.cwd(), 'CHANGELOG.pinned.md');
  if (!fs.existsSync(pinnedPath)) return [];
  const raw = fs.readFileSync(pinnedPath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
}

function buildChangelog() {
  const generatedAt = new Date().toISOString();
  const pinnedEntries = readPinnedEntries();
  const latestTag = safeRun('git describe --tags --abbrev=0', '');
  const range = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  const raw = safeRun(`git log ${range} --date=short --pretty=format:%H%x1f%ad%x1f%s%x1f%an%x1e`, '');
  const commits = raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, date, subject, author] = chunk.split('\x1f');
      return {
        hash: (hash || '').slice(0, 7),
        date: date || '',
        subject: subject || '',
        author: author || ''
      };
    });

  const lines = [];
  lines.push('# Changelog');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');

  if (pinnedEntries.length) {
    pinnedEntries.forEach((entry) => lines.push(entry));
    lines.push('');
  }

  if (latestTag) {
    lines.push(`Range: ${latestTag} → HEAD`);
    lines.push('');
  }

  if (!commits.length) {
    lines.push('- No commits found in selected range.');
  } else {
    commits.forEach((item) => {
      lines.push(`- ${item.date} · ${item.subject} (${item.hash}, ${item.author})`);
    });
  }

  lines.push('');
  lines.push('## Release Notes Feed');
  lines.push('');
  lines.push('- Use this file as the source for in-app or docs release summaries.');
  lines.push('- Regenerate with: `npm run changelog:generate`.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function main() {
  const outPath = path.resolve(process.cwd(), 'CHANGELOG.md');
  const content = buildChangelog();
  fs.writeFileSync(outPath, content, 'utf8');
  console.log(`Wrote ${outPath}`);
}

main();
