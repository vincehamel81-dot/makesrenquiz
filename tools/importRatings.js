// Imports personal preference ratings from tools/ratings.csv (columns:
// "Song list","On 1000") into user_song_ratings for user 1 (vince). Matches by normalized
// title so casing/punctuation differences don't cause misses. Blank ratings
// become 0. Re-runnable any time the CSV is updated.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Minimal CSV line parser handling quoted fields with embedded commas.
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

const lines = readFileSync(path.join(__dirname, 'ratings.csv'), 'utf-8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

const rows = lines.slice(1).map(parseCsvLine); // skip header

const songs = await db.prepare('SELECT id, title FROM songs').all();
const byNormalized = new Map(songs.map((s) => [normalize(s.title), s]));

const USER_ID = 1; // vince — see server/auth.js
const updateRating = db.prepare(
  `INSERT INTO user_song_ratings (user_id, song_id, rating) VALUES (?, ?, ?)
   ON CONFLICT(user_id, song_id) DO UPDATE SET rating = excluded.rating`
);

let matched = 0;
const unmatched = [];
for (const [titleRaw, ratingRaw] of rows) {
  const title = titleRaw.trim();
  if (!title) continue;
  const song = byNormalized.get(normalize(title));
  const rating = ratingRaw.trim() === '' ? 0 : Number(ratingRaw.trim());
  if (!song) {
    unmatched.push(title);
    continue;
  }
  await updateRating.run(USER_ID, song.id, rating);
  matched++;
}

console.log(`Matched and rated ${matched} songs.`);
if (unmatched.length) {
  console.log(`\n${unmatched.length} CSV row(s) could not be matched to a song:`);
  for (const t of unmatched) console.log(`  - "${t}"`);
}

const unrated = await db
  .prepare(
    `SELECT title FROM songs s WHERE NOT EXISTS (
       SELECT 1 FROM user_song_ratings r WHERE r.song_id = s.id AND r.user_id = ? AND r.rating != 0
     ) ORDER BY title`
  )
  .all(USER_ID);
if (unrated.length) {
  console.log(`\n${unrated.length} song(s) have no rating (0) — either genuinely 0 in the CSV or never in it:`);
  for (const s of unrated) console.log(`  - ${s.title}`);
}
