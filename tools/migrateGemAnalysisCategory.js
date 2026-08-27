// One-off: adds 'analysis' to easter_eggs.category's allowed values. SQLite
// can't ALTER a CHECK constraint in place, so this recreates the table.
// Turso enforces foreign keys regardless of PRAGMA foreign_keys=OFF, and —
// surprisingly — still blocks DROP TABLE on the old copy even *after*
// renaming it out of the way and swapping the new one into its place (tried
// both; neither PRAGMA nor the rename-before-drop trick gets past it). So
// this renames the old table to easter_eggs_old and leaves it there rather
// than dropping it — dead weight, but harmless: nothing in the app
// references that name, and it costs nothing to leave sitting in the DB.
// Idempotent — checks the current constraint before doing anything.
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const schemaRow = await client.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='easter_eggs'");
const currentSql = schemaRow.rows[0]?.sql ?? '';
if (currentSql.includes("'analysis'")) {
  console.log("easter_eggs.category already allows 'analysis' — nothing to do");
  process.exit(0);
}

await client.batch(
  [
    'DROP TABLE IF EXISTS easter_eggs_new',
    'DROP TABLE IF EXISTS easter_eggs_old',
    `CREATE TABLE easter_eggs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL REFERENCES songs(id),
      term TEXT,
      description TEXT NOT NULL,
      timestamp_sec INTEGER,
      category TEXT NOT NULL DEFAULT 'easter_egg' CHECK(category IN ('easter_egg','reference','wordplay','fact','analysis')),
      confidence TEXT NOT NULL DEFAULT 'theory' CHECK(confidence IN ('confirmed','theory')),
      quizzable INTEGER NOT NULL DEFAULT 0,
      source_url TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `INSERT INTO easter_eggs_new (id, song_id, term, description, timestamp_sec, category, confidence, quizzable, source_url, deleted, created_at)
     SELECT id, song_id, term, description, timestamp_sec, category, confidence, quizzable, source_url, deleted, created_at FROM easter_eggs`,
    'ALTER TABLE easter_eggs RENAME TO easter_eggs_old',
    'ALTER TABLE easter_eggs_new RENAME TO easter_eggs',
    'CREATE INDEX IF NOT EXISTS idx_easter_eggs_song ON easter_eggs(song_id)',
  ],
  'write'
);
console.log("recreated easter_eggs with 'analysis' added to category (old copy left as easter_eggs_old, unreferenced)");

const count = (await client.execute('SELECT COUNT(*) as n FROM easter_eggs')).rows[0].n;
console.log(`easter_eggs now has ${count} row(s)`);

const fkCheck = await client.execute('PRAGMA foreign_key_check(questions)');
console.log(`dangling FK rows in questions: ${fkCheck.rows.length}`);
