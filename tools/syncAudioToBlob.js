// Uploads local public/audio/*.mp3 clips to Vercel Blob. Re-runnable —
// lists what's already there and only uploads new files, so running this
// after tools/fetchAudio.js picks up new songs is cheap. Deterministic
// pathnames (addRandomSuffix: false, the SDK default) mean the resulting
// URL is always <base>/<same file name>, so server/questionTypes.js can
// construct clip URLs from BLOB_PUBLIC_BASE_URL + file_path without any
// Blob API calls at request time.
import { put, list } from '@vercel/blob';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');

const files = readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3'));
console.log(`Found ${files.length} local clips.`);

const existing = new Map();
let cursor;
do {
  const res = await list({ cursor, limit: 1000 });
  for (const b of res.blobs) existing.set(b.pathname, b.url);
  cursor = res.hasMore ? res.cursor : undefined;
} while (cursor);
console.log(`${existing.size} already in Blob storage.`);

let uploaded = 0;
let baseUrl = existing.size > 0 ? [...existing.values()][0].slice(0, [...existing.values()][0].lastIndexOf('/')) : null;

for (const file of files) {
  if (existing.has(file)) continue;
  const buffer = readFileSync(path.join(AUDIO_DIR, file));
  const blob = await put(file, buffer, { access: 'public', addRandomSuffix: false, contentType: 'audio/mpeg' });
  if (!baseUrl) baseUrl = blob.url.slice(0, blob.url.lastIndexOf('/'));
  uploaded++;
  if (uploaded % 50 === 0) console.log(`  ${uploaded} uploaded...`);
}

console.log(`\nUploaded ${uploaded} new clips (${existing.size + uploaded} total in Blob).`);
if (baseUrl) console.log(`Base URL: ${baseUrl}`);
