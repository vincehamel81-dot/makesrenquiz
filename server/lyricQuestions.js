// (Re)builds the 'lyric' question pool from lyrics_lines. Beyond picking
// substantial, distinctive, non-cross-song-shared lines, this also decides
// how many consecutive lines to bundle into one question: every candidate
// defaults to a 2-line window (a single line is rarely enough to place a
// song by), and lines that open with a continuation word ("'Cause we still
// got tonight") pull in whichever neighbor actually completes the thought —
// the line before it, or if it's the first line of its section (so there's
// no valid line before), the line after.
// Safe to call any time lyrics change.
import { db, batchWrite } from './db.js';

const LYRIC_QUESTIONS_PER_SONG = 6;
const MIN_LINE_LEN = 12;
const PREFIX_WORDS = 4;
const RARE_THRESHOLD = 15; // appears in <15 lines total across the whole catalog
const MIN_UNIQUE_WORDS = 4;
const MIN_UNIQUE_RATIO = 0.5;
const FRAGMENT_START = /^[^a-z]*('cause|cause|and|but|so|because|or|then|that|which|yet|for)\b/i;

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "Pt." in a title vs "Part" spelled out in the lyric itself shouldn't dodge
// the name-drop check.
function expandAbbrev(s) {
  return s.replace(/\bpt\b/g, 'part');
}

function prefixKey(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  if (words.length < PREFIX_WORDS) return null; // too short to judge distinctiveness
  return words.slice(0, PREFIX_WORDS).join(' ');
}

function isDistinctive(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  const unique = new Set(words);
  return unique.size >= MIN_UNIQUE_WORDS && unique.size / words.length >= MIN_UNIQUE_RATIO;
}

// Decides [startLineNo, contextLines] for a candidate line, given the full
// line-number -> row map for its song (including headers, so adjacency
// checks don't accidentally bundle across a section boundary).
//
// Chorus lines used to default to 1-line-alone on the assumption the hook
// itself is always memorable enough — wrong in practice: the opening line
// of a chorus is often just as unrecognizable alone as a verse line (the
// actually-iconic line is sometimes the *next* one, and can't be used solo
// if it name-drops the title). So everything defaults to 2-line context;
// 1 line only happens when there's genuinely no next line to pull in.
function chooseBundle(lineMap, lineNo) {
  const prev = lineMap.get(lineNo - 1);
  const next = lineMap.get(lineNo + 1);
  const isFragment = FRAGMENT_START.test(lineMap.get(lineNo).text);

  if (isFragment && prev && !prev.is_header) return [lineNo - 1, 2];
  if (isFragment && next && !next.is_header) return [lineNo, 2];
  if (next && !next.is_header) return [lineNo, 2];
  return [lineNo, 1];
}

export async function rebuildLyricQuestions() {
  const allRows = await db.prepare('SELECT song_id, line_no, text, is_header FROM lyrics_lines ORDER BY song_id, line_no').all();
  const nonHeaderLines = allRows.filter((l) => !l.is_header);

  const songRows = await db.prepare('SELECT id, title FROM songs').all();
  const titleById = new Map(songRows.map((s) => [s.id, expandAbbrev(normalize(s.title))]));
  function nameDropsOwnTitle(text, songId) {
    const title = titleById.get(songId);
    return title && expandAbbrev(normalize(text)).includes(title);
  }

  const wordCounts = new Map();
  for (const line of nonHeaderLines) {
    for (const w of new Set(normalize(line.text).split(' ').filter(Boolean))) {
      wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    }
  }
  function hasRareWord(prefix) {
    return prefix.split(' ').some((w) => (wordCounts.get(w) ?? 0) < RARE_THRESHOLD);
  }

  const prefixToSongs = new Map();
  for (const line of nonHeaderLines) {
    const key = prefixKey(line.text);
    if (!key || !hasRareWord(key)) continue;
    if (!prefixToSongs.has(key)) prefixToSongs.set(key, new Set());
    prefixToSongs.get(key).add(line.song_id);
  }
  function isSharedAcrossSongs(text, songId) {
    const key = prefixKey(text);
    if (!key) return false;
    const songs = prefixToSongs.get(key);
    return songs && [...songs].some((id) => id !== songId);
  }

  // Separate, stronger check: a line that's word-for-word identical in two
  // songs is disqualifying no matter how common its individual words are —
  // the prefix check above only fires when the shared prefix contains a rare
  // word, which misses lines built entirely from common words ("I think
  // about that sometimes, vividly" — shared verbatim between two songs, but
  // every one of "I/think/about/that" is far too common to trip the rare-
  // word gate). This checks the full normalized line, not just a prefix.
  const exactLineToSongs = new Map();
  for (const line of nonHeaderLines) {
    const key = normalize(line.text);
    if (!key) continue;
    if (!exactLineToSongs.has(key)) exactLineToSongs.set(key, new Set());
    exactLineToSongs.get(key).add(line.song_id);
  }
  function hasExactDuplicateLine(lines, songId) {
    return lines.some((text) => {
      const songs = exactLineToSongs.get(normalize(text));
      return songs && [...songs].some((id) => id !== songId);
    });
  }

  // Group full rows (incl. headers) per song for adjacency lookups, and
  // track which section each non-header line falls under.
  const rowsBySong = new Map();
  for (const row of allRows) {
    if (!rowsBySong.has(row.song_id)) rowsBySong.set(row.song_id, new Map());
    rowsBySong.get(row.song_id).set(row.line_no, row);
  }

  const candidatesBySong = new Map();
  for (const [songId, lineMap] of rowsBySong) {
    const candidates = [];
    for (const row of [...lineMap.values()].sort((a, b) => a.line_no - b.line_no)) {
      if (row.is_header) continue;
      const [startLineNo, contextLines] = chooseBundle(lineMap, row.line_no);
      const bundleLines = [];
      for (let n = startLineNo; n < startLineNo + contextLines; n++) {
        const r = lineMap.get(n);
        if (!r || r.is_header) break;
        bundleLines.push(r.text);
      }
      const bundledText = bundleLines.join(' ');
      candidates.push({ startLineNo, contextLines: bundleLines.length, bundledText, bundleLines, anchorLineNo: row.line_no });
    }
    candidatesBySong.set(songId, candidates);
  }

  // Retire (not delete) existing lyric questions — some may already have
  // quiz_attempts history referencing them via foreign key. Batched into one
  // network round-trip with the inserts below rather than one await per
  // statement — with ~150 songs x up to 6 questions each, that was ~900
  // sequential round-trips to the remote Turso DB (~50s), which is what a
  // lyrics save looked like it had hung on from the client's POV.
  const statements = [{ sql: `UPDATE questions SET status = 'retired' WHERE type = 'lyric'`, args: [] }];
  const insertSql = `INSERT INTO questions (type, song_id, start_line_no, context_lines, status) VALUES ('lyric', ?, ?, ?, 'pending')`;

  let totalAdded = 0;
  let excludedForOverlap = 0;
  const seenAnchors = new Set(); // avoid bundled neighbors double-counting the same line pair
  for (const [songId, rawCandidates] of candidatesBySong) {
    const qualifying = [];
    for (const c of rawCandidates) {
      const key = `${songId}:${c.startLineNo}:${c.contextLines}`;
      if (seenAnchors.has(key)) continue;
      if (c.bundledText.length < MIN_LINE_LEN) continue;
      if (!isDistinctive(c.bundledText)) continue;
      if (nameDropsOwnTitle(c.bundledText, songId)) continue;
      if (isSharedAcrossSongs(c.bundledText, songId) || hasExactDuplicateLine(c.bundleLines, songId)) {
        excludedForOverlap++;
        continue;
      }
      seenAnchors.add(key);
      qualifying.push(c);
    }

    const step = Math.max(1, Math.floor(qualifying.length / LYRIC_QUESTIONS_PER_SONG));
    let added = 0;
    for (let i = 0; i < qualifying.length && added < LYRIC_QUESTIONS_PER_SONG; i += step) {
      statements.push({ sql: insertSql, args: [songId, qualifying[i].startLineNo, qualifying[i].contextLines] });
      added++;
    }
    totalAdded += added;
  }

  await batchWrite(statements);
  return { totalAdded, songCount: candidatesBySong.size, excludedForOverlap };
}
