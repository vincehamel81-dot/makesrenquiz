// Fills in songs.youtube_url for songs missing it, without downloading
// anything. Most of the catalog's audio was fetched before URL-saving was
// added (or via one-off manual scripts that never wrote the URL back), so
// youtube_url ended up null even for songs whose audio came straight from
// the cached channel index. This just replays the same title-matching logic
// fetchAudio.js already trusts (confidence >= 0.6) against that cache and
// records the match — no re-download, no clip changes.
//
// Usage: node tools/backfillYoutubeUrls.js
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHANNEL_CACHE_PATH = path.join(__dirname, 'channel_videos.json');
const RAW_DIR = path.join(__dirname, '..', 'audio_raw');

const EXCLUDE_PATTERNS = /full album|documentary|reaction|compilation|behind the scenes|\bbts\b|interview|episode|trailer|megamix|mashup medley/i;
const DEPRIORITIZE_PATTERNS = /\blive\b|acoustic|cover|remix|instrumental|karaoke|sped up|slowed/i;
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'is', 'my', 'your']);
const PART_MARKER_RE = /^(\d+|i|ii|iii|iv|v)$/;
const CHANNEL_PREFIX_RE = /^(ren|the big push|the skinner brothers|trick the fox)\b[^-–]*[-–]\s*/i;

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripParenthetical(title) {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function coreTitle(title) {
  let t = title;
  let prev;
  do {
    prev = t;
    t = stripParenthetical(t).replace(CHANNEL_PREFIX_RE, '').trim();
  } while (t !== prev);
  return t;
}

function expandAbbrev(s) {
  return s.replace(/\bpt\b/gi, 'part');
}

function isSignificant(w) {
  if (STOPWORDS.has(w)) return false;
  return w.length >= 2 || /^\d+$/.test(w); // single-digit part numbers ("2") must survive
}

function contentWords(text) {
  return text.split(' ').filter(isSignificant);
}

function matchScore(wanted, actual) {
  const wantedWords = contentWords(wanted);
  const actualWords = contentWords(actual);
  if (wantedWords.length === 0) return { recall: 0, precision: 0, conflict: false };
  const actualSet = new Set(actualWords);
  const matched = wantedWords.filter((w) => actualSet.has(w));
  const recall = matched.length / wantedWords.length;
  const precision = matched.length / Math.max(1, actualWords.length);
  const wantedMarkers = wantedWords.filter((w) => PART_MARKER_RE.test(w));
  const actualMarkers = actualWords.filter((w) => PART_MARKER_RE.test(w));
  const conflict =
    wantedMarkers.length > 0 && actualMarkers.length > 0 && !wantedMarkers.some((m) => actualMarkers.includes(m));
  return { recall, precision, conflict };
}

function pickBest(channelIndex, title) {
  const wantedTitle = normalize(expandAbbrev(coreTitle(title)));
  let best = null;
  let bestScore = -Infinity;
  let bestRecall = 0;
  for (const v of channelIndex) {
    if (EXCLUDE_PATTERNS.test(v.title)) continue;
    const vidTitle = normalize(coreTitle(v.title || ''));
    const { recall, precision, conflict } = matchScore(wantedTitle, vidTitle);
    if (conflict) continue;
    let score = recall * 10 + precision * 2;
    if (/official audio|official music video/i.test(v.title)) score += 2;
    if (DEPRIORITIZE_PATTERNS.test(v.title)) score -= 3;
    if (score > bestScore) {
      bestScore = score;
      bestRecall = recall;
      best = v;
    }
  }
  const confident = best ? bestRecall >= 0.6 : false;
  return { best, confident };
}

if (!existsSync(CHANNEL_CACHE_PATH)) {
  console.error('No cached channel index at tools/channel_videos.json — run fetchAudio.js first.');
  process.exit(1);
}
const channelIndex = JSON.parse(readFileSync(CHANNEL_CACHE_PATH, 'utf-8'));

const songs = db.prepare('SELECT id, title, slug, youtube_url FROM songs WHERE youtube_url IS NULL ORDER BY title').all();
const updateUrl = db.prepare('UPDATE songs SET youtube_url = ? WHERE id = ?');

let filled = 0;
const stillMissing = [];
for (const song of songs) {
  const { best, confident } = pickBest(channelIndex, song.title);
  const hasLocalAudio = existsSync(path.join(RAW_DIR, `${song.slug}.mp3`));
  if (confident) {
    const url = `https://www.youtube.com/watch?v=${best.id}`;
    updateUrl.run(url, song.id);
    filled++;
    console.log(`${hasLocalAudio ? '[verified]' : '[new match]'} ${song.title} -> ${best.title}`);
  } else {
    stillMissing.push(song.title);
  }
}

console.log(`\nFilled ${filled} of ${songs.length} missing youtube_url values.`);
console.log(`${stillMissing.length} still missing (no confident channel match):`);
for (const t of stillMissing) console.log(`  - ${t}`);
