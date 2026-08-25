// Personal full-data export (includes your own ratings) — separate from
// exportSongs.js, which is the public-safe discography-audit export
// already checked into the repo. This one writes to the project root,
// which .gitignore excludes, since it carries personal preference data.
// Re-runnable any time: node tools/exportSongsFull.js
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'export_songs.csv');
const USER_ID = 1; // vince

function csvEscape(value) {
  const s = value ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const rows = await db
  .prepare(
    `SELECT s.id, s.title, s.slug, a.name as album_name, a.release_date as album_release_date,
            s.release_date as song_release_date, s.collaborators, s.themes, s.youtube_url,
            s.duration_sec, s.notes,
            f.title as follow_up_to,
            COALESCE((SELECT rating FROM user_song_ratings r WHERE r.song_id = s.id AND r.user_id = ?), 0) as rating,
            EXISTS(SELECT 1 FROM user_songs us WHERE us.song_id = s.id AND us.user_id = ?) as known,
            (SELECT COUNT(*) FROM lyrics_lines ll WHERE ll.song_id = s.id AND ll.is_header = 0) as lyric_line_count,
            (SELECT COUNT(*) FROM questions q WHERE q.song_id = s.id AND q.type = 'audio' AND q.status != 'retired') as clip_count,
            (SELECT COUNT(*) FROM easter_eggs e WHERE e.song_id = s.id AND e.deleted = 0) as gem_count
     FROM songs s
     LEFT JOIN albums a ON a.id = s.album_id
     LEFT JOIN songs f ON f.id = s.follow_up_to_id
     ORDER BY a.release_date DESC, s.title`
  )
  .all(USER_ID, USER_ID);

const header = [
  'id', 'title', 'slug', 'album_name', 'album_release_date', 'song_release_date',
  'collaborators', 'themes', 'follow_up_to', 'youtube_url', 'duration_sec', 'notes',
  'rating', 'known', 'lyric_line_count', 'clip_count', 'gem_count',
];
const lines = [header.join(',')];
for (const r of rows) {
  const collaborators = JSON.parse(r.collaborators || '[]').join('; ');
  const themes = JSON.parse(r.themes || '[]').join('; ');
  lines.push(
    [
      r.id,
      r.title,
      r.slug,
      r.album_name ?? '',
      r.album_release_date ?? '',
      r.song_release_date ?? '',
      collaborators,
      themes,
      r.follow_up_to ?? '',
      r.youtube_url ?? '',
      r.duration_sec ?? '',
      r.notes ?? '',
      r.rating,
      r.known ? 'yes' : 'no',
      r.lyric_line_count,
      r.clip_count,
      r.gem_count,
    ]
      .map(csvEscape)
      .join(',')
  );
}

writeFileSync(OUT_PATH, lines.join('\n'), 'utf-8');
console.log(`Exported ${rows.length} songs to ${OUT_PATH}`);
