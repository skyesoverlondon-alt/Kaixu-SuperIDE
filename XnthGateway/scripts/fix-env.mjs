/**
 * Fixes common .env quoting issues that break `source .env`.
 *
 * - Does NOT print any secret values.
 * - Creates a .env.bak backup.
 * - Only applies minimal, conservative fixes.
 */

import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
const bakPath = path.resolve(process.cwd(), ".env.bak");

if (!fs.existsSync(envPath)) {
  console.error("No .env found in", process.cwd());
  process.exit(1);
}

const raw = fs.readFileSync(envPath, "utf8");
const lines = raw.split(/\r?\n/);

const varsToHeal = new Set([
  "ADMIN_PASSWORD",
  "JWT_SECRET",
  "ALLOWED_ORIGINS",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "DB_ENCRYPTION_KEY",
  "KEY_PEPPER",
  "CLIENT_ERROR_TOKEN",
  "JOB_WORKER_SECRET",
  "NETLIFY_AUTH_TOKEN",
  "NEON_DATA_API_JWT",
  "NEON_DATA_API_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN"
]);

function hasOddDoubleQuotes(s) {
  const count = (s.match(/"/g) || []).length;
  return count % 2 === 1;
}

const changes = [];
const out = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Preserve comments/blank lines verbatim
  if (!line || /^\s*#/.test(line)) {
    out.push(line);
    continue;
  }

  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) {
    out.push(line);
    continue;
  }

  const name = m[1];
  const value = m[2];

  // Only attempt healing on known vars (conservative)
  if (varsToHeal.has(name)) {
    const trimmed = value.trim();

    // If value starts with a quote but line has odd number of quotes, append a closing quote.
    // This fixes common "unterminated quote" cases.
    if (trimmed.startsWith('"') && hasOddDoubleQuotes(line)) {
      out.push(line + '"');
      changes.push({ line: i + 1, var: name, fix: "appended closing quote" });
      continue;
    }
  }

  out.push(line);
}

// If file still has odd number of quotes overall, append a quote at EOF as last resort.
const outText = out.join("\n");
if (hasOddDoubleQuotes(outText)) {
  fs.copyFileSync(envPath, bakPath);
  fs.writeFileSync(envPath, outText + "\n\"\n", "utf8");
  changes.push({ line: out.length + 1, var: "<eof>", fix: "appended closing quote at EOF" });
} else {
  fs.copyFileSync(envPath, bakPath);
  fs.writeFileSync(envPath, outText + "\n", "utf8");
}

if (!changes.length) {
  console.log("No .env quote fixes applied.");
} else {
  console.log("Applied .env quote fixes:");
  for (const c of changes) {
    console.log(`- line ${c.line}: ${c.var} (${c.fix})`);
  }
  console.log("Backup written to .env.bak");
}
