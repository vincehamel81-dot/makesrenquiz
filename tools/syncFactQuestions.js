// Backfills `questions` bank rows for the non-audio/lyric types (theme,
// follow-up, album, collaborator, bio) from the current songs/bio_facts
// tables. Idempotent — only inserts rows that don't already exist, so it's
// safe to re-run any time metadata is added or edited.
import { db } from '../server/db.js';

function parseJsonArray(text) {
  try {
    const v = JSON.parse(text ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let inserted = 0;

async function insertIfMissing(where, params, insertSql, insertParams) {
  const exists = await db.prepare(`SELECT 1 FROM questions WHERE ${where}`).get(...params);
  if (!exists) {
    await db.prepare(insertSql).run(...insertParams);
    inserted++;
  }
}

const songs = await db.prepare('SELECT * FROM songs').all();

for (const s of songs) {
  if (s.album_id) {
    await insertIfMissing(
      `type = 'album' AND song_id = ?`,
      [s.id],
      `INSERT INTO questions (type, song_id) VALUES ('album', ?)`,
      [s.id]
    );
  }
  if (s.follow_up_to_id) {
    await insertIfMissing(
      `type = 'follow-up' AND song_id = ?`,
      [s.id],
      `INSERT INTO questions (type, song_id) VALUES ('follow-up', ?)`,
      [s.id]
    );
  }
  for (const theme of parseJsonArray(s.themes)) {
    await insertIfMissing(
      `type = 'theme' AND song_id = ? AND fact_key = ?`,
      [s.id, theme],
      `INSERT INTO questions (type, song_id, fact_key) VALUES ('theme', ?, ?)`,
      [s.id, theme]
    );
  }
  for (const collab of parseJsonArray(s.collaborators)) {
    await insertIfMissing(
      `type = 'collaborator' AND song_id = ? AND fact_key = ?`,
      [s.id, collab],
      `INSERT INTO questions (type, song_id, fact_key) VALUES ('collaborator', ?, ?)`,
      [s.id, collab]
    );
  }
}

const bioFacts = await db.prepare('SELECT id FROM bio_facts').all();
for (const fact of bioFacts) {
  await insertIfMissing(
    `type = 'bio' AND bio_fact_id = ?`,
    [fact.id],
    `INSERT INTO questions (type, bio_fact_id) VALUES ('bio', ?)`,
    [fact.id]
  );
}

const eggs = await db.prepare(`SELECT id, song_id FROM easter_eggs WHERE quizzable = 1 AND term IS NOT NULL AND deleted = 0`).all();
for (const egg of eggs) {
  await insertIfMissing(
    `type = 'reference' AND easter_egg_id = ?`,
    [egg.id],
    `INSERT INTO questions (type, song_id, easter_egg_id) VALUES ('reference', ?, ?)`,
    [egg.song_id, egg.id]
  );
}

console.log(`Inserted ${inserted} new fact questions.`);
