// One-off batch song insert, mirroring POST /api/songs' insert logic
// (slugify, unique-slug skip, collaborators JSON, auto-checked for user 1).
// For batches of new songs supplied with youtube_url already known, so
// npm run fetch:audio's matcher is skipped and it just downloads+slices.
//
// Usage: node tools/addSongsBatch.js path/to/songs.json
// JSON shape: array of { title, collaborators?: string[], youtube_url?, notes? }
import { readFileSync } from 'node:fs';
import { db } from '../server/db.js';

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: node tools/addSongsBatch.js <path-to-json>');
  process.exit(1);
}

const records = JSON.parse(readFileSync(jsonPath, 'utf-8'));
const ADMIN_USER_ID = 1;

let inserted = 0;
let skipped = 0;

for (const rec of records) {
  const title = (rec.title || '').trim();
  if (!title) continue;
  const slug = slugify(title);
  if (!slug) continue;

  if (await db.prepare('SELECT 1 FROM songs WHERE slug = ? OR title = ?').get(slug, title)) {
    console.log(`Skipping "${title}" — slug/title already exists.`);
    skipped++;
    continue;
  }

  const collaborators = Array.isArray(rec.collaborators) ? rec.collaborators.map((c) => c.trim()).filter(Boolean) : [];
  const youtube_url = (rec.youtube_url || '').trim() || null;
  const notes = (rec.notes || '').trim() || null;

  const info = await db
    .prepare(`INSERT INTO songs (title, slug, collaborators, themes, youtube_url, notes) VALUES (?, ?, ?, '[]', ?, ?)`)
    .run(title, slug, JSON.stringify(collaborators), youtube_url, notes);

  await db.prepare('INSERT OR IGNORE INTO user_songs (user_id, song_id) VALUES (?, ?)').run(ADMIN_USER_ID, info.lastInsertRowid);

  console.log(`Inserted "${title}" -> ${slug} (id ${info.lastInsertRowid})`);
  inserted++;
}

console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.`);
