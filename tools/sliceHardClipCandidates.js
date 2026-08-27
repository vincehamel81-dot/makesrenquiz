// Slices 15 candidate 2-second "Expert Mode" clips per song, spread across
// the track, each with a matching waveform .png so you can review them
// visually before picking the 8 that make the cut — no silence-detection
// on this end, that's the point of eyeballing the waveform yourself.
//
// Usage: node tools/sliceHardClipCandidates.js <song-slug>
//
// Requires audio_raw/<slug>.mp3 to already exist (run npm run fetch:audio
// first if it doesn't). Writes into audio_raw/hard_review/<slug>/ — listen
// to and look at what's there, delete the .mp3 files you don't want (their
// .png can stay or go, it's not read back), then run
// tools/commitHardClips.js <slug> to turn whatever .mp3s remain into real
// 'hard' question rows.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBin } from '../server/lib/ffmpeg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CANDIDATE_COUNT = 15;
const CLIP_DURATION_SEC = 2;

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node tools/sliceHardClipCandidates.js <song-slug>');
  process.exit(1);
}

const rawPath = path.join(ROOT, 'audio_raw', `${slug}.mp3`);
if (!existsSync(rawPath)) {
  console.error(`No raw audio at ${rawPath} — run "npm run fetch:audio" first (it's resumable, safe to re-run).`);
  process.exit(1);
}

function probeDuration(filePath) {
  const out = execFileSync(resolveBin('ffprobe'), ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath], {
    encoding: 'utf-8',
  });
  return Number(JSON.parse(out).format.duration);
}

const duration = probeDuration(rawPath);
console.log(`${slug}: ${duration.toFixed(1)}s track`);

const outDir = path.join(ROOT, 'audio_raw', 'hard_review', slug);
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Evenly spread across the middle 92% of the track — avoids the very first/
// last couple seconds where a hard fade-in/out is likelier, though you're
// the one deciding what's actually usable from here.
const fractions = Array.from({ length: CANDIDATE_COUNT }, (_, i) => 0.04 + (0.92 * i) / (CANDIDATE_COUNT - 1));

for (const frac of fractions) {
  const startSec = Math.round(frac * duration);
  if (startSec + CLIP_DURATION_SEC > duration) continue;
  const base = `${slug}-${startSec}`;
  const clipPath = path.join(outDir, `${base}.mp3`);
  const wavePath = path.join(outDir, `${base}.png`);

  execFileSync(
    resolveBin('ffmpeg'),
    ['-y', '-loglevel', 'error', '-ss', String(startSec), '-t', String(CLIP_DURATION_SEC), '-i', rawPath, '-acodec', 'libmp3lame', '-q:a', '4', clipPath],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  execFileSync(
    resolveBin('ffmpeg'),
    ['-y', '-loglevel', 'error', '-i', clipPath, '-filter_complex', 'showwavespic=s=640x120:colors=0xE8A25C', '-frames:v', '1', wavePath],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
}

console.log(`Wrote ${readdirSync(outDir).filter((f) => f.endsWith('.mp3')).length} candidates to ${outDir}`);
console.log('Listen/look, delete the .mp3 files you don\'t want, then run:');
console.log(`  node tools/commitHardClips.js ${slug}`);
