// Exports the full song list (title, album, dates, collaborators, YouTube
// link) to a CSV for manual discography auditing — cross-referencing
// against outside sources for missing songs or misattributed albums.
// Re-runnable any time: node tools/exportSongs.js
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, 'songs_export.csv');

function csvEscape(value) {
  const s = value ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const rows = db
  .prepare(
    `SELECT s.title, a.name as album, s.release_date as song_release_date,
            a.release_date as album_release_date, s.collaborators, s.youtube_url
     FROM songs s LEFT JOIN albums a ON a.id = s.album_id
     ORDER BY a.release_date DESC, s.title`
  )
  .all();

const header = ['title', 'album', 'song_release_date', 'album_release_date', 'collaborators', 'youtube_url'];
const lines = [header.join(',')];
for (const r of rows) {
  const collaborators = JSON.parse(r.collaborators || '[]').join('; ');
  lines.push(
    [r.title, r.album ?? '', r.song_release_date ?? '', r.album_release_date ?? '', collaborators, r.youtube_url ?? '']
      .map(csvEscape)
      .join(',')
  );
}

writeFileSync(OUT_PATH, lines.join('\n'), 'utf-8');
console.log(`Exported ${rows.length} songs to ${OUT_PATH}`);
