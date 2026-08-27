// Second half of the Expert Mode clip workflow — run tools/sliceHardClipCandidates.js
// first, delete the .mp3 candidates you don't want from the review folder,
// then run this to turn whatever .mp3s remain into real 'hard' question
// rows (public/audio/, difficulty='hard', duration_sec=2). Doesn't touch
// Vercel Blob — run tools/syncAudioToBlob.js afterward to publish them.
//
// Usage: node tools/commitHardClips.js <song-slug>
import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node tools/commitHardClips.js <song-slug>');
  process.exit(1);
}

const reviewDir = path.join(ROOT, 'audio_raw', 'hard_review', slug);
if (!existsSync(reviewDir)) {
  console.error(`No review folder at ${reviewDir} — run tools/sliceHardClipCandidates.js ${slug} first.`);
  process.exit(1);
}

const song = await db.prepare('SELECT id FROM songs WHERE slug = ?').get(slug);
if (!song) {
  console.error(`No song with slug "${slug}"`);
  process.exit(1);
}

const insertQuestion = db.prepare(
  `INSERT INTO questions (type, song_id, start_sec, duration_sec, file_path, difficulty, status)
   VALUES ('audio', ?, ?, 2, ?, 'hard', 'pending')`
);
const existingQuestion = db.prepare(
  `SELECT 1 FROM questions WHERE type = 'audio' AND difficulty = 'hard' AND song_id = ? AND start_sec = ?`
);

const survivors = readdirSync(reviewDir).filter((f) => f.endsWith('.mp3'));
let added = 0;
for (const fileName of survivors) {
  const startSec = Number(fileName.replace(`${slug}-`, '').replace('.mp3', ''));
  if (!Number.isFinite(startSec)) continue;
  if (await existingQuestion.get(song.id, startSec)) {
    console.log(`  skip ${fileName} — already have a hard clip at ${startSec}s`);
    continue;
  }
  const destName = `${slug}-hard-${startSec}.mp3`;
  copyFileSync(path.join(reviewDir, fileName), path.join(ROOT, 'public', 'audio', destName));
  await insertQuestion.run(song.id, startSec, destName);
  added++;
}

rmSync(reviewDir, { recursive: true, force: true });
console.log(`Added ${added} hard clip(s) for "${slug}". Run "node tools/syncAudioToBlob.js" to publish them.`);
