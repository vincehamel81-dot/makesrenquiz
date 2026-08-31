// Deleting a song (DELETE /api/songs/:slug) only touches the DB — it never
// removes audio_raw/<slug>.mp3 or the sliced public/audio clips, so a
// deleted song's files just sit there as dead weight forever. This finds
// and removes them.
//
// audio_raw files are matched by exact slug (one raw file per song, named
// <slug>.mp3 — no ambiguity there). public/audio clips are matched against
// the exact set of file_path values still referenced by live 'audio'
// question rows, rather than trying to reverse-parse a slug out of the
// filename — a prefix-based approach would misfire the same way
// scrapeLyrics.js's title matcher did (e.g. "money-game-" is a valid prefix
// of "money-game-pt-2-103.mp3" too).
//
// Usage: node tools/cleanupOrphanedAudio.js [--delete]
// Without --delete, only lists what would be removed (dry run, the default).
import { readdirSync, statSync, unlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '..', 'audio_raw');
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');
const HARD_REVIEW_DIR = path.join(RAW_DIR, 'hard_review');

const DO_DELETE = process.argv.includes('--delete');

const songs = await db.prepare('SELECT slug FROM songs').all();
const knownSlugs = new Set(songs.map((s) => s.slug));

const liveFilePaths = new Set(
  (await db.prepare(`SELECT file_path FROM questions WHERE type = 'audio' AND file_path IS NOT NULL`).all()).map(
    (r) => r.file_path
  )
);

// ---------- audio_raw/<slug>.mp3 ----------
const rawFiles = readdirSync(RAW_DIR).filter((f) => f.endsWith('.mp3'));
const orphanedRaw = rawFiles.filter((f) => !knownSlugs.has(f.slice(0, -4)));

// ---------- public/audio/*.mp3 ----------
const clipFiles = readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3'));
const orphanedClips = clipFiles.filter((f) => !liveFilePaths.has(f));

// ---------- audio_raw/hard_review/<slug>/ (leftover from a song deleted
// mid-review, before ever being committed) ----------
let orphanedReviewDirs = [];
try {
  orphanedReviewDirs = readdirSync(HARD_REVIEW_DIR).filter((d) => !knownSlugs.has(d));
} catch {
  // hard_review dir doesn't exist — nothing to check
}

let rawBytes = 0;
for (const f of orphanedRaw) rawBytes += statSync(path.join(RAW_DIR, f)).size;
let clipBytes = 0;
for (const f of orphanedClips) clipBytes += statSync(path.join(AUDIO_DIR, f)).size;

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

console.log(`Orphaned raw audio: ${orphanedRaw.length} file(s), ${mb(rawBytes)}`);
for (const f of orphanedRaw) console.log(`  audio_raw/${f}`);
console.log(`Orphaned clips: ${orphanedClips.length} file(s), ${mb(clipBytes)}`);
for (const f of orphanedClips) console.log(`  public/audio/${f}`);
console.log(`Orphaned hard_review folders: ${orphanedReviewDirs.length}`);
for (const d of orphanedReviewDirs) console.log(`  audio_raw/hard_review/${d}/`);

if (!DO_DELETE) {
  console.log(`\nDry run — nothing deleted. Re-run with --delete to actually remove these.`);
} else {
  for (const f of orphanedRaw) unlinkSync(path.join(RAW_DIR, f));
  for (const f of orphanedClips) unlinkSync(path.join(AUDIO_DIR, f));
  for (const d of orphanedReviewDirs) rmSync(path.join(HARD_REVIEW_DIR, d), { recursive: true, force: true });
  console.log(`\nDeleted ${orphanedRaw.length + orphanedClips.length} file(s) and ${orphanedReviewDirs.length} folder(s).`);
}
