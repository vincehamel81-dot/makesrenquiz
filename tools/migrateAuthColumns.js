// One-off: adds the auth/role columns to the live Turso `users` table
// (CREATE TABLE IF NOT EXISTS in schema.sql can't retrofit an existing
// table) and promotes the seed row (id 1) to admin. Idempotent — checks
// for each column/index before adding it, safe to re-run.
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const cols = (await client.execute('PRAGMA table_info(users)')).rows.map((r) => r.name);

if (!cols.includes('google_sub')) {
  await client.execute('ALTER TABLE users ADD COLUMN google_sub TEXT');
  console.log('added users.google_sub');
}
if (!cols.includes('role')) {
  await client.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  console.log('added users.role');
}
if (!cols.includes('picture_url')) {
  await client.execute('ALTER TABLE users ADD COLUMN picture_url TEXT');
  console.log('added users.picture_url');
}

await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub)');
console.log('ensured idx_users_google_sub');

await client.execute("UPDATE users SET role = 'admin' WHERE id = 1");
console.log('promoted user 1 to admin');

const rows = (await client.execute('SELECT id, name, email, role FROM users')).rows;
console.log('users table now:', JSON.stringify(rows, null, 2));
