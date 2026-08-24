// Compares each song's actually-downloaded raw audio duration against the
// real duration of the video at its currently-recorded youtube_url. A
// mismatch means the local file was downloaded from a different video than
// the one now on record — exactly the bug found in Hi Ren and the Money
// Game family, where audio was fetched before youtube_url matching was
// fixed/reviewed. This check is comprehensive rather than guesswork: it
// doesn't matter WHY a mismatch happened, only whether the audio on disk
// still corresponds to the link on the song page.
//
// Usage: node tools/auditAudioDurations.js
// Writes tools/audio_duration_audit.json (mismatches only) and logs a summary.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { db } from '../server/db.js';
import { resolveBin } from '../server/lib/ffmpeg.js';

const RAW_DIR = path.join(process.cwd(), 'audio_raw');
const TOLERANCE_SEC = 3; // encoding/rounding slack

function localDuration(slug) {
  const p = path.join(RAW_DIR, `${slug}.mp3`);
  if (!existsSync(p)) return null;
  try {
    const out = execFileSync(resolveBin('ffprobe'), ['-v', 'quiet', '-print_format', 'json', '-show_format', p], {
      encoding: 'utf-8',
    });
    return Number(JSON.parse(out).format.duration);
  } catch {
    return null;
  }
}

function remoteDuration(url) {
  try {
    const out = execFileSync(resolveBin('yt-dlp'), ['--skip-download', '--print', 'duration', url], {
      encoding: 'utf-8',
      timeout: 20000,
    });
    return Number(out.trim());
  } catch {
    return null;
  }
}

const songs = await db.prepare('SELECT id, slug, title, youtube_url FROM songs WHERE youtube_url IS NOT NULL ORDER BY title').all();
const mismatches = [];
let checked = 0;
let errors = 0;

for (const song of songs) {
  const local = localDuration(song.slug);
  if (local == null) continue; // no raw audio to check
  const remote = remoteDuration(song.youtube_url);
  checked++;
  if (remote == null) {
    errors++;
    console.log(`[?] ${song.title} — couldn't fetch remote duration`);
    continue;
  }
  const diff = Math.abs(local - remote);
  if (diff > TOLERANCE_SEC) {
    mismatches.push({ title: song.title, slug: song.slug, youtube_url: song.youtube_url, local: Math.round(local), remote: Math.round(remote) });
    console.log(`[MISMATCH] ${song.title} — local ${Math.round(local)}s vs remote ${Math.round(remote)}s`);
  }
  if (checked % 20 === 0) console.log(`... ${checked}/${songs.length} checked`);
}

writeFileSync(path.join(process.cwd(), 'tools', 'audio_duration_audit.json'), JSON.stringify(mismatches, null, 2));
console.log(`\nChecked ${checked} songs (${errors} lookup errors). ${mismatches.length} mismatch(es) found.`);
console.log('Full list written to tools/audio_duration_audit.json');
