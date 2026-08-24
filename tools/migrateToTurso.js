// One-time bulk migration: local data/renquiz.db (node:sqlite) -> Turso.
// Reads directly via node:sqlite (bypasses server/db.js, which is now
// Turso-only) and writes via @libsql/client's batch() for efficiency —
// some tables here have tens of thousands of rows.
//
// Idempotent: every insert is OR IGNORE against the table's real primary
// key, so re-running after a partial failure just skips what already made
// it across. `users` is deliberately skipped — schema.sql already seeds
// the one row (id 1 = vince) on Turso's own bootstrap; re-inserting it here
// would just be a duplicate no-op at best.
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localDb = new DatabaseSync(path.join(__dirname, '..', 'data', 'renquiz.db'));
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const BATCH_SIZE = 400;

async function migrateTable(table, columns) {
  const rows = localDb.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await turso.batch(
      chunk.map((row) => ({ sql, args: columns.map((c) => row[c]) })),
      'write'
    );
  }
  console.log(`${table}: migrated ${rows.length} rows`);
}

await migrateTable('albums', ['id', 'name', 'release_date']);
await migrateTable('songs', [
  'id', 'title', 'slug', 'album_id', 'release_date', 'collaborators', 'themes',
  'follow_up_to_id', 'youtube_url', 'duration_sec', 'notes',
]);
await migrateTable('user_song_ratings', ['user_id', 'song_id', 'rating']);
await migrateTable('lyrics_lines', ['id', 'song_id', 'line_no', 'text', 'is_header']);
await migrateTable('bio_facts', ['id', 'question', 'answer', 'options']);
await migrateTable('easter_eggs', [
  'id', 'song_id', 'term', 'description', 'confidence', 'quizzable', 'source_url', 'deleted', 'created_at',
]);
await migrateTable('questions', [
  'id', 'type', 'song_id', 'status', 'start_sec', 'duration_sec', 'file_path', 'start_line_no',
  'context_lines', 'fact_key', 'bio_fact_id', 'easter_egg_id', 'weight', 'times_asked', 'times_correct',
  'last_asked_at', 'created_at',
]);
await migrateTable('user_songs', ['user_id', 'song_id', 'created_at']);
await migrateTable('user_preferences', ['user_id', 'audio_pct', 'lyric_pct', 'trivia_pct']);
await migrateTable('quiz_sessions', ['id', 'user_id', 'requested_count', 'active_song_count', 'started_at']);
await migrateTable('quiz_attempts', [
  'id', 'user_id', 'session_id', 'played_at', 'question_type', 'question_id', 'song_id', 'prompt',
  'correct_answer', 'user_answer', 'mode', 'was_correct', 'points',
]);

localDb.close();
console.log('Migration complete.');
