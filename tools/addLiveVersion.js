// Adds a live-performance video as a second source for a song that already
// has a studio one, concatenating the two into one combined raw track:
//   - audio_raw/<slug>.mp3 is replaced with studio+live concatenated
//   - the standard 8-fraction slicer (matching tools/fetchAudio.js's own
//     CLIP_FRACTIONS) re-runs against the new, ~2x-longer duration, adding
//     roughly 8 more normal clips alongside the existing 8 (their start_sec
//     values naturally land in different places than before, so nothing
//     collides or needs deleting)
//   - tools/sliceHardClipCandidates.js then just works unchanged afterward,
//     since it already reads audio_raw/<slug>.mp3 and spans whatever
//     duration is actually there — run that separately per song, same as
//     any other song's hard-clip batch
//
// Usage: node tools/addLiveVersion.js <slug> <live-youtube-url>
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';
import { resolveBin } from '../server/lib/ffmpeg.js';
import { sliceClip } from '../server/lib/clipAudio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'audio_raw');

const CLIP_FRACTIONS = [0, 0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9]; // must match tools/fetchAudio.js
const DEFAULT_PLAYBACK_SEC = 5;
const CLIP_SLICE_SEC = 10;

const [slug, liveUrl] = process.argv.slice(2);
if (!slug || !liveUrl) {
  console.error('Usage: node tools/addLiveVersion.js <slug> <live-youtube-url>');
  process.exit(1);
}

function videoIdFrom(url) {
  const m = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
  if (!m) throw new Error(`couldn't extract a video id from ${url}`);
  return m[1];
}

function downloadAudio(videoId, outBasePath) {
  const ffmpegBin = resolveBin('ffmpeg');
  const args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--quiet', '--no-warnings', '-o', `${outBasePath}.%(ext)s`];
  if (path.isAbsolute(ffmpegBin)) args.push('--ffmpeg-location', path.dirname(ffmpegBin));
  args.push(`https://www.youtube.com/watch?v=${videoId}`);
  execFileSync(resolveBin('yt-dlp'), args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function probeDuration(filePath) {
  const out = execFileSync(resolveBin('ffprobe'), ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath], {
    encoding: 'utf-8',
  });
  return Number(JSON.parse(out).format.duration);
}

const song = await db.prepare('SELECT * FROM songs WHERE slug = ?').get(slug);
if (!song) {
  console.error(`No song with slug "${slug}"`);
  process.exit(1);
}
const studioPath = path.join(RAW_DIR, `${slug}.mp3`);
if (!existsSync(studioPath)) {
  console.error(`No existing studio raw audio at ${studioPath} — this tool only handles adding a live version to a song that already has one.`);
  process.exit(1);
}

console.log(`Downloading live audio for "${song.title}"...`);
const liveBase = path.join(RAW_DIR, `${slug}-live-src`);
downloadAudio(videoIdFrom(liveUrl), liveBase);
const livePath = `${liveBase}.mp3`;

const combinedPath = path.join(RAW_DIR, `${slug}-combined.mp3`);
console.log('Concatenating studio + live...');
execFileSync(resolveBin('ffmpeg'), [
  '-y', '-loglevel', 'error',
  '-i', studioPath,
  '-i', livePath,
  '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]',
  '-map', '[out]',
  '-acodec', 'libmp3lame', '-q:a', '4',
  combinedPath,
]);

renameSync(combinedPath, studioPath); // studio path is now the canonical combined raw source
unlinkSync(livePath);

const duration = probeDuration(studioPath);
await db.prepare('UPDATE songs SET duration_sec = ?, live_youtube_url = ? WHERE id = ?').run(duration, liveUrl, song.id);
console.log(`Combined duration: ${duration.toFixed(1)}s`);

const insertQuestion = db.prepare(
  `INSERT INTO questions (type, song_id, start_sec, duration_sec, file_path, status) VALUES ('audio', ?, ?, ?, ?, 'pending')`
);
const existingQuestion = db.prepare(`SELECT 1 FROM questions WHERE type = 'audio' AND song_id = ? AND start_sec = ?`);

let added = 0;
for (const frac of CLIP_FRACTIONS) {
  const startSec = Math.round(frac * duration);
  if (startSec + 3 > duration) continue;
  if (await existingQuestion.get(song.id, startSec)) continue;
  const sliceLen = Math.min(CLIP_SLICE_SEC, duration - startSec);
  const fileName = sliceClip(slug, startSec, sliceLen);
  if (!fileName) continue;
  await insertQuestion.run(song.id, startSec, DEFAULT_PLAYBACK_SEC, fileName);
  added++;
}

console.log(`Added ${added} new normal-difficulty clip(s) from the combined track.`);
console.log(`Next: node tools/sliceHardClipCandidates.js ${slug}`);
