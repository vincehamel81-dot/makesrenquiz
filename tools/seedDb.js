// Loads songs.seed.json (+ bio_facts.seed.json if present) into the SQLite DB.
// Re-runnable: upserts by slug/question so partial re-imports are safe.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function upsertAlbum(name, releaseDate) {
  if (!name) return null;
  await db.prepare(
    'INSERT INTO albums (name, release_date) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET release_date = excluded.release_date'
  ).run(name, releaseDate ?? null);
  return (await db.prepare('SELECT id FROM albums WHERE name = ?').get(name)).id;
}

const songs = JSON.parse(readFileSync(path.join(__dirname, 'songs.seed.json'), 'utf-8'));

const upsertSong = db.prepare(`
  INSERT INTO songs (title, slug, album_id, release_date, collaborators, themes, youtube_url, duration_sec, notes)
  VALUES (@title, @slug, @album_id, @release_date, @collaborators, @themes, @youtube_url, @duration_sec, @notes)
  ON CONFLICT(slug) DO UPDATE SET
    title = excluded.title,
    album_id = excluded.album_id,
    release_date = excluded.release_date,
    collaborators = excluded.collaborators,
    themes = excluded.themes,
    youtube_url = excluded.youtube_url,
    duration_sec = excluded.duration_sec,
    notes = excluded.notes
`);

for (const s of songs) {
  const album_id = await upsertAlbum(s.album, s.release_date);
  await upsertSong.run({
    title: s.title,
    slug: s.slug,
    album_id,
    release_date: s.release_date ?? null,
    collaborators: JSON.stringify(s.collaborators ?? []),
    themes: JSON.stringify(s.themes ?? []),
    youtube_url: s.youtube_url ?? null,
    duration_sec: s.duration_sec ?? null,
    notes: s.notes ?? null,
  });
}

// second pass: follow_up_to references another song by slug
const setFollowUp = db.prepare('UPDATE songs SET follow_up_to_id = (SELECT id FROM songs WHERE slug = ?) WHERE slug = ?');
for (const s of songs) {
  if (s.follow_up_to) await setFollowUp.run(s.follow_up_to, s.slug);
}

console.log(`Seeded ${songs.length} songs.`);

const bioPath = path.join(__dirname, 'bio_facts.seed.json');
if (existsSync(bioPath)) {
  const facts = JSON.parse(readFileSync(bioPath, 'utf-8'));
  // avoid dupes by question text since there's no unique constraint
  const existingRows = await db.prepare('SELECT question FROM bio_facts').all();
  const existingQs = new Set(existingRows.map((r) => r.question));
  let added = 0;
  for (const f of facts) {
    if (!existingQs.has(f.question)) {
      await db.prepare('INSERT INTO bio_facts (question, answer, options) VALUES (?, ?, ?)').run(
        f.question,
        f.answer,
        f.options ? JSON.stringify(f.options) : null
      );
      added++;
    }
  }
  console.log(`Seeded ${added} new bio facts.`);
}

const eggsPath = path.join(__dirname, 'easter_eggs.seed.json');
if (existsSync(eggsPath)) {
  // { song: "<title>", term, description, confidence, quizzable, source_url }
  const eggs = JSON.parse(readFileSync(eggsPath, 'utf-8'));
  const existingEggRows = await db.prepare('SELECT song_id, description FROM easter_eggs').all();
  const existingEggs = new Set(existingEggRows.map((r) => `${r.song_id}::${r.description}`));
  const findSongId = db.prepare('SELECT id FROM songs WHERE title = ?');
  const insertEgg = db.prepare(`
    INSERT INTO easter_eggs (song_id, term, description, confidence, quizzable, source_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  let added = 0;
  for (const e of eggs) {
    const song = await findSongId.get(e.song);
    if (!song) {
      console.warn(`easter_eggs.seed.json: no song titled "${e.song}" — skipping "${e.term ?? e.description}"`);
      continue;
    }
    const key = `${song.id}::${e.description}`;
    if (existingEggs.has(key)) continue;
    await insertEgg.run(song.id, e.term ?? null, e.description, e.confidence ?? 'theory', e.quizzable ? 1 : 0, e.source_url ?? null);
    added++;
  }
  console.log(`Seeded ${added} new easter eggs.`);
}
