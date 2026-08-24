// Scrapes full lyrics per song from Genius (personal-use only — never
// committed, never redistributed) into lyrics_lines. Run
// tools/selectLyricQuestions.js afterwards to (re)build the quiz question
// pool from those lines.
//
// Usage: node tools/scrapeLyrics.js [limit]
//   limit - only process the first N songs still missing lyrics (for testing)
//
// Resumable: skips songs that already have lyrics_lines rows. Re-run any
// time to pick up newly added songs.
import * as cheerio from 'cheerio';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'lyrics_scrape_report.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REQUEST_DELAY_MS = 800;

const limitArg = Number(process.argv[2]);
const limit = Number.isFinite(limitArg) ? limitArg : Infinity;

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'is', 'my', 'your']);

function titleOverlap(wanted, actual) {
  if (actual.includes(wanted)) return 1;
  const words = wanted.split(' ').filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (words.length === 0) return 0;
  return words.filter((w) => actual.includes(w)).length / words.length;
}

async function searchGenius(query) {
  const res = await fetch(`https://genius.com/api/search/song?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA },
  });
  const json = await res.json();
  return json.response.sections[0]?.hits?.map((h) => h.result) ?? [];
}

// "Dream Life (Skinner Brothers)" -> the parenthetical is a collaborator/
// project tag (per user decision), not part of the literal song title, and
// Genius's title field never includes it — so it must be stripped before
// comparing, or every collab-tagged title in our list looks like a miss.
function stripParenthetical(title) {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function pickBest(hits, title) {
  const wantedTitle = normalize(stripParenthetical(title));
  let best = null;
  let bestOverlap = 0;
  let bestScore = -Infinity;
  for (const hit of hits) {
    const artists = normalize(hit.artist_names || '');
    if (!/\bren\b/.test(artists)) continue; // must credit Ren in some form (solo or collab)
    const hitTitle = normalize(hit.title || '');
    const overlap = titleOverlap(wantedTitle, hitTitle);
    const score = overlap;
    if (score > bestScore) {
      bestScore = score;
      bestOverlap = overlap;
      best = hit;
    }
  }
  return { best, confident: best ? bestOverlap >= 0.6 : false };
}

async function scrapeLyricsPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const lines = [];
  $('div[data-lyrics-container="true"]').each((_, el) => {
    const $el = $(el);
    $el.find('[data-exclude-from-selection]').remove();
    $el.find('br').replaceWith('\n');
    for (const raw of $el.text().split('\n')) {
      const text = raw.trim();
      if (text) lines.push(text);
    }
  });
  return lines;
}

const songs = await db.prepare('SELECT * FROM songs ORDER BY title').all();
const report = existsSync(REPORT_PATH) ? JSON.parse(readFileSync(REPORT_PATH, 'utf-8')) : {};
const hasLyrics = db.prepare('SELECT 1 FROM lyrics_lines WHERE song_id = ? LIMIT 1');
const insertLine = db.prepare('INSERT INTO lyrics_lines (song_id, line_no, text, is_header) VALUES (?, ?, ?, ?)');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let processed = 0;
for (const song of songs) {
  if (await hasLyrics.get(song.id)) continue;
  if (processed >= limit) break;
  processed++;
  console.log(`[${processed}/${Math.min(limit, songs.length)}] Matching: ${song.title}`);

  try {
    const hits = await searchGenius(`Ren ${song.title}`);
    const { best, confident } = pickBest(hits, song.title);
    if (!best || !confident) {
      console.warn(`  no confident match, needs manual review`);
      report[song.slug] = { title: song.title, matched: best?.full_title ?? null, needsReview: true };
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    await sleep(REQUEST_DELAY_MS);
    const lines = await scrapeLyricsPage(best.url);
    if (lines.length === 0) {
      console.warn(`  page matched but no lyrics extracted, needs manual review`);
      report[song.slug] = { title: song.title, matched: best.full_title, url: best.url, needsReview: true };
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    let lineNo = 0;
    for (const text of lines) {
      lineNo++;
      const isHeader =
        /^\[.*\]$/.test(text) ||
        /^(intro|outro|verse\s*\d*|chorus|pre-chorus|bridge|hook|refrain|interlude|breakdown|drop)s?:?\s*$/i.test(text);
      await insertLine.run(song.id, lineNo, text, isHeader ? 1 : 0);
    }

    // Question candidates aren't picked here — run tools/selectLyricQuestions.js
    // afterwards, which excludes lines that share an opening phrase with
    // another song (Ren reuses hooks/callbacks across tracks).
    report[song.slug] = { title: song.title, matched: best.full_title, url: best.url, needsReview: false };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`  ${lines.length} lines`);
  } catch (err) {
    console.warn(`  failed: ${err.message}`);
  }
  await sleep(REQUEST_DELAY_MS);
}

console.log(`\nDone. Report: ${REPORT_PATH}`);
const needsReview = Object.values(report).filter((r) => r.needsReview);
if (needsReview.length) {
  console.log(`\n${needsReview.length} song(s) need manual review (no confident Genius match):`);
  for (const r of needsReview) console.log(`  - ${r.title}${r.matched ? ` -> best guess: ${r.matched}` : ''}`);
}
