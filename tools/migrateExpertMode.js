// One-off: adds questions.difficulty and user_preferences.expert_mode to
// the live Turso tables. Both are plain ADD COLUMN (with a CHECK on
// difficulty) — unlike the easter_eggs.category change, this doesn't need
// table recreation since it's a brand-new column, not a modified constraint
// on an existing one. Idempotent — safe to re-run.
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const questionCols = (await client.execute('PRAGMA table_info(questions)')).rows.map((r) => r.name);
if (!questionCols.includes('difficulty')) {
  await client.execute(
    `ALTER TABLE questions ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'normal' CHECK(difficulty IN ('normal','hard'))`
  );
  console.log('added questions.difficulty');
} else {
  console.log('questions.difficulty already exists');
}

const prefCols = (await client.execute('PRAGMA table_info(user_preferences)')).rows.map((r) => r.name);
if (!prefCols.includes('expert_mode')) {
  await client.execute('ALTER TABLE user_preferences ADD COLUMN expert_mode INTEGER NOT NULL DEFAULT 0');
  console.log('added user_preferences.expert_mode');
} else {
  console.log('user_preferences.expert_mode already exists');
}
