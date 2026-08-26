// One-off: adds easter_eggs.timestamp_sec to the live Turso table.
// Idempotent — safe to re-run.
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const cols = (await client.execute('PRAGMA table_info(easter_eggs)')).rows.map((r) => r.name);

if (!cols.includes('timestamp_sec')) {
  await client.execute('ALTER TABLE easter_eggs ADD COLUMN timestamp_sec INTEGER');
  console.log('added easter_eggs.timestamp_sec');
} else {
  console.log('easter_eggs.timestamp_sec already exists');
}
