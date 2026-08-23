// One-off: convert the plain-text song list into a seed JSON skeleton.
// Run: node tools/parseSongs.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(__dirname, '..', 'songs.txt');
const outPath = path.join(__dirname, 'songs.seed.json');

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const lines = readFileSync(srcPath, 'utf-8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

const existing = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, 'utf-8'))
  : [];
const existingBySlug = new Map(existing.map((s) => [s.slug, s]));

const songs = lines.map((title) => {
  const slug = slugify(title);
  // preserve any already-researched fields on re-run
  const prior = existingBySlug.get(slug) || {};
  return {
    title,
    slug,
    album: prior.album ?? null,
    release_date: prior.release_date ?? null,
    collaborators: prior.collaborators ?? [],
    themes: prior.themes ?? [],
    follow_up_to: prior.follow_up_to ?? null,
    youtube_url: prior.youtube_url ?? null,
    duration_sec: prior.duration_sec ?? null,
    notes: prior.notes ?? null,
  };
});

const dupes = songs.map((s) => s.slug).filter((s, i, a) => a.indexOf(s) !== i);
if (dupes.length) {
  console.warn('Duplicate slugs (check for near-duplicate titles):', [...new Set(dupes)]);
}

writeFileSync(outPath, JSON.stringify(songs, null, 2));
console.log(`Wrote ${songs.length} songs to ${outPath}`);
