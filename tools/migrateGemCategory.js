// One-off: adds easter_eggs.category to the live Turso table, defaulting
// every existing row to 'easter_egg' (they all predate the split — see
// schema.sql's comment on this table for what each category means).
// Idempotent — safe to re-run.
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const cols = (await client.execute('PRAGMA table_info(easter_eggs)')).rows.map((r) => r.name);

if (!cols.includes('category')) {
  await client.execute(
    `ALTER TABLE easter_eggs ADD COLUMN category TEXT NOT NULL DEFAULT 'easter_egg'
     CHECK(category IN ('easter_egg','reference','wordplay','fact'))`
  );
  console.log('added easter_eggs.category');
} else {
  console.log('easter_eggs.category already exists');
}

const counts = (await client.execute('SELECT category, COUNT(*) as n FROM easter_eggs WHERE deleted = 0 GROUP BY category')).rows;
console.log('gem counts by category:', JSON.stringify(counts));
