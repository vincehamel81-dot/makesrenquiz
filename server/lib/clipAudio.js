import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBin } from './ffmpeg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

// Re-slices (or slices for the first time) a clip from the raw downloaded
// track. Returns the file_path (relative to public/audio/) to store on the
// question row, or null if the raw source audio isn't present.
export function sliceClip(slug, startSec, durationSec) {
  const rawPath = path.join(ROOT, 'audio_raw', `${slug}.mp3`);
  if (!existsSync(rawPath)) return null;

  const fileName = `${slug}-${Math.round(startSec)}.mp3`;
  const outPath = path.join(ROOT, 'public', 'audio', fileName);
  execFileSync(resolveBin('ffmpeg'), [
    '-y',
    '-loglevel', 'error',
    '-ss', String(startSec),
    '-t', String(durationSec),
    '-i', rawPath,
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    outPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fileName;
}
