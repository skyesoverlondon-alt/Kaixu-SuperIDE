/* kAIxU Super IDE — migration runner
   Runs sql/schema.sql against NEON_DATABASE_URL at build time.
*/
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  // Netlify-Neon integration sets DATABASE_URL; fall back to manual NEON_DATABASE_URL
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) {
    console.log('[migrate] DATABASE_URL / NEON_DATABASE_URL not set; skipping migrations.');
    return;
  }

  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.log('[migrate] Applying schema.sql ...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[migrate] Done.');
  } catch (err) {
    console.error('[migrate] Failed:', err.message || err);
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error('[migrate] fatal:', e);
  process.exit(1);
});
