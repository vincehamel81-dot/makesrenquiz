// Bulk-inserts gems for one song from a JSON array, for hand-curated batches
// (e.g. a line-by-line lyric analysis) that don't fit the flat CSV shape
// importGemsCsv.js expects. Mirrors POST/PUT /api/easter-eggs' insert logic
// (category/confidence defaults, quizzable -> linked 'reference' question)
// so gems added this way behave identically to ones added through the UI.
//
// JSON shape: array of { term?, description, category?, confidence?,
// quizzable?, timestamp_sec?, source_url? }
//
// Idempotent: skips any (term, description) pair already present for the
// song, so a batch can be re-run or extended safely.
//
// Usage: node tools/importGemsJson.js <song-slug> <path-to-json>
import { readFileSync } from 'node:fs';
import { db } from '../server/db.js';

const [slug, jsonPath] = process.argv.slice(2);
if (!slug || !jsonPath) {
  console.error('Usage: node tools/importGemsJson.js <song-slug> <path-to-json>');
  process.exit(1);
}

const GEM_CATEGORIES = new Set(['easter_egg', 'reference', 'wordplay', 'fact', 'analysis']);

const song = await db.prepare('SELECT id FROM songs WHERE slug = ?').get(slug);
if (!song) {
  console.error(`No song with slug "${slug}"`);
  process.exit(1);
}

const records = JSON.parse(readFileSync(jsonPath, 'utf-8'));

const existingRows = await db
  .prepare('SELECT term, description FROM easter_eggs WHERE song_id = ? AND deleted = 0')
  .all(song.id);
const existingKeys = new Set(existingRows.map((e) => `${(e.term || '').toLowerCase()}::${e.description.toLowerCase()}`));

let inserted = 0;
let skippedDup = 0;

for (const rec of records) {
  const description = (rec.description || '').trim();
  if (!description) continue;
  const term = rec.term || null;
  const category = GEM_CATEGORIES.has(rec.category) ? rec.category : 'easter_egg';
  const confidence = rec.confidence === 'confirmed' ? 'confirmed' : 'theory';
  const quizzable = rec.quizzable ? 1 : 0;
  const source_url = rec.source_url || null;
  const timestamp_sec = Number.isInteger(rec.timestamp_sec) && rec.timestamp_sec >= 0 ? rec.timestamp_sec : null;

  const dedupeKey = `${(term || '').toLowerCase()}::${description.toLowerCase()}`;
  if (existingKeys.has(dedupeKey)) {
    skippedDup++;
    continue;
  }

  const info = await db
    .prepare(
      `INSERT INTO easter_eggs (song_id, term, description, category, confidence, quizzable, source_url, timestamp_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(song.id, term, description, category, confidence, quizzable, source_url, timestamp_sec);

  if (quizzable && term) {
    await db.prepare(`INSERT INTO questions (type, song_id, easter_egg_id) VALUES ('reference', ?, ?)`).run(song.id, info.lastInsertRowid);
  }

  existingKeys.add(dedupeKey);
  inserted++;
}

console.log(`Inserted ${inserted} gem(s) for "${slug}".`);
console.log(`Skipped ${skippedDup} duplicate(s) already present.`);
