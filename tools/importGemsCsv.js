// Bulk-imports gems (easter eggs / references / wordplay / facts) from a
// research CSV. Handles both CSV shapes in use so far:
//   song,category,subtype,description,confidence,source_url,status
//   song,category,subtype,fact_or_observation,evidence_level,source_type,source_url,auto_import,notes
// Only rows whose status/auto_import column is exactly "YES" are imported —
// everything else (REVIEW, NO, blank) is left for manual entry through the
// UI, same as before. Idempotent: re-running the same file (or an
// overlapping later batch) skips rows already present for that song.
//
// Usage: node tools/importGemsCsv.js path/to/file.csv
import { readFileSync } from 'node:fs';
import { db } from '../server/db.js';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node tools/importGemsCsv.js <path-to-csv>');
  process.exit(1);
}

// Minimal RFC4180-ish CSV parser — handles quoted fields with embedded
// commas/newlines/escaped quotes, which a plain split(',') can't.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '') // drop a trailing "(Album Name)" style suffix
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapCategory(raw) {
  const c = (raw || '').toLowerCase();
  if (c.includes('egg')) return 'easter_egg';
  if (c.includes('word') || c.includes('entendre') || c.includes('pun')) return 'wordplay';
  if (c.includes('fact')) return 'fact';
  if (c.includes('reference')) return 'reference';
  return 'easter_egg';
}

function mapConfidence(raw) {
  return /confirm/i.test(raw || '') ? 'confirmed' : 'theory';
}

function shouldImport(rec) {
  return (rec.status || rec.auto_import || '').trim().toUpperCase() === 'YES';
}

const raw = readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
const table = parseCsv(raw);
const header = table[0].map((h) => h.trim().toLowerCase());
const records = table
  .slice(1)
  .filter((r) => r.length > 1 || r[0])
  .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));

const songs = await db.prepare('SELECT id, title FROM songs').all();
const byNormalizedTitle = new Map();
for (const s of songs) {
  const key = normalizeTitle(s.title);
  if (!byNormalizedTitle.has(key)) byNormalizedTitle.set(key, []);
  byNormalizedTitle.get(key).push(s);
}

const existingRows = await db.prepare('SELECT song_id, term, description FROM easter_eggs WHERE deleted = 0').all();
const existingKeys = new Set(existingRows.map((e) => `${e.song_id}::${(e.term || '').toLowerCase()}::${e.description.toLowerCase()}`));

let inserted = 0;
let skippedStatus = 0;
let skippedDup = 0;
const unmatched = [];

for (const rec of records) {
  if (!shouldImport(rec)) {
    skippedStatus++;
    continue;
  }
  const songName = rec.song;
  if (!songName) continue;

  const key = normalizeTitle(songName);
  const matches = byNormalizedTitle.get(key);
  if (!matches || matches.length !== 1) {
    unmatched.push({ song: songName, reason: !matches ? 'no match' : 'ambiguous match' });
    continue;
  }
  const song = matches[0];

  const description = rec.description || rec.fact_or_observation || '';
  if (!description) continue;

  const term = rec.subtype || null;
  const category = mapCategory(rec.category);
  const confidence = mapConfidence(rec.confidence || rec.evidence_level);
  const source_url = rec.source_url || null;

  const dedupeKey = `${song.id}::${(term || '').toLowerCase()}::${description.toLowerCase()}`;
  if (existingKeys.has(dedupeKey)) {
    skippedDup++;
    continue;
  }

  await db
    .prepare(
      `INSERT INTO easter_eggs (song_id, term, description, category, confidence, quizzable, source_url)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    )
    .run(song.id, term, description, category, confidence, source_url);
  existingKeys.add(dedupeKey);
  inserted++;
}

console.log(`Inserted ${inserted} gem(s).`);
console.log(`Skipped ${skippedStatus} row(s) not marked YES.`);
console.log(`Skipped ${skippedDup} duplicate(s) already present.`);
if (unmatched.length) {
  console.log(`${unmatched.length} unmatched song name(s) — fix the CSV or check the exact title in the app:`);
  for (const u of unmatched) console.log(`  - "${u.song}" (${u.reason})`);
}
