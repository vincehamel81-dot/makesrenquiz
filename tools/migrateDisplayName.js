// One-off: adds users.display_name (unique, alphanumeric username) to the
// live Turso table and backfills a random name for any existing row missing
// one. Idempotent — safe to re-run (only touches rows where display_name
// IS NULL, and the unique index creation is itself IF NOT EXISTS).
import { createClient } from '@libsql/client';
import { generateUniqueDisplayName } from '../server/lib/randomDisplayName.js';

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const cols = (await client.execute('PRAGMA table_info(users)')).rows.map((r) => r.name);

if (!cols.includes('display_name')) {
  await client.execute('ALTER TABLE users ADD COLUMN display_name TEXT');
  console.log('added users.display_name');
}

// Also catch rows from an earlier run of this script (before display_name
// was tightened to a strict alphanumeric username) that hold an invalid
// value like "Frozen Meadow" (has a space).
const all = (await client.execute('SELECT id, display_name FROM users')).rows;
const missing = all.filter((r) => !r.display_name || !/^[a-zA-Z0-9]{3,15}$/.test(r.display_name));
for (const { id } of missing) {
  const name = await generateUniqueDisplayName(async (candidate) => {
    const existing = await client.execute({
      sql: 'SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE',
      args: [candidate],
    });
    return existing.rows.length > 0;
  });
  await client.execute({ sql: 'UPDATE users SET display_name = ? WHERE id = ?', args: [name, id] });
}
console.log(`backfilled display_name for ${missing.length} user(s)`);

await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name COLLATE NOCASE)');
console.log('ensured idx_users_display_name');

const rows = (await client.execute('SELECT id, name, display_name, role FROM users')).rows;
console.log('users table now:', JSON.stringify(rows, null, 2));
