/* kAIxU Super IDE — migration runner
   Runs sql/schema.sql and sql/rls.sql against NEON_DATABASE_URL at build time.
*/
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function runSql(client, sqlPath, label) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log(`[migrate] Applying ${label} ...`);
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log(`[migrate] ${label} done.`);
}

async function run() {
  // Netlify-Neon integration sets DATABASE_URL; fall back to manual NEON_DATABASE_URL
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) {
    console.log('[migrate] DATABASE_URL / NEON_DATABASE_URL not set; skipping migrations.');
    return;
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
    const rlsPath    = path.join(__dirname, '..', 'sql', 'rls.sql');

    await runSql(client, schemaPath, 'schema.sql');

    // RLS is optional — if pgvector or other extensions aren't enabled yet, skip gracefully
    if (fs.existsSync(rlsPath)) {
      try {
        await runSql(client, rlsPath, 'rls.sql');
      } catch (rlsErr) {
        console.warn('[migrate] rls.sql skipped (may need manual ENABLE ROW LEVEL SECURITY):', rlsErr.message);
        await client.query('ROLLBACK').catch(() => {});
      }
    }

    console.log('[migrate] All migrations complete.');
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
