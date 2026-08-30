// Surfaces candidate lyric callbacks/references between songs: words or
// short phrases that repeat across a small number of *distinct* songs.
// Deliberately doesn't need a hand-picked blocklist for thematically common
// words (faith, god, depression, sad...) — those naturally show up in many
// songs across the catalog, so a document-frequency ceiling filters them out
// on its own, leaving the rarer overlaps (names, specific phrases) that are
// actually worth eyeballing for an intentional callback.
//
// Usage: node tools/findLyricCallbacks.js [--min-songs=2] [--max-songs=8] [--limit=150] [--out=path.json]
import { writeFileSync } from 'node:fs';
import { db } from '../server/db.js';

const args = process.argv.slice(2);
function argNum(name, def) {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? Number(m.split('=')[1]) : def;
}
const MIN_SONGS = argNum('min-songs', 2);
const MAX_SONGS = argNum('max-songs', 8);
const LIMIT = argNum('limit', 150);
const OUT_PATH = args.find((a) => a.startsWith('--out='))?.split('=')[1];

// Function words + Ren's own filler/ad-lib vocabulary — this is about
// pruning noise, not thematic content, so it stays short and mechanical.
const STOPWORDS = new Set(
  `a an the and or but if then than so because as until while of at by for with
   about against between into through during before after above below to from
   up down in out on off over under again further once here there when where
   why how all any both each few more most other some such no nor not only own
   same too very s t can will just don should now i me my myself we our ours
   ourselves you your yours yourself yourselves he him his himself she her
   hers herself it its itself they them their theirs themselves what which
   who whom this that these those am is are was were be been being have has
   had having do does did doing would could ain aint gonna wanna gotta yeah
   ooh oh ah uh huh na la em ya cause till im ive youre youve youll id ill
   dont didnt doesnt isnt wasnt werent cant couldnt wouldnt shouldnt aint
   got get let lets know knew think thought like just still even back one
   two never always really something someone somebody nothing everything
   anything everyone go going went come coming came take took make made say
   said tell told see saw look looked want wanted need needed feel felt`
    .split(/\s+/)
    .filter(Boolean)
);

function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const rows = await db
  .prepare(
    `SELECT s.id as song_id, s.slug, s.title, l.line_no, l.text
     FROM songs s JOIN lyrics_lines l ON l.song_id = s.id
     WHERE l.is_header = 0
     ORDER BY s.id, l.line_no`
  )
  .all();

const songMeta = new Map(); // song_id -> {slug, title}
const linesBySong = new Map(); // song_id -> [text...]
for (const r of rows) {
  songMeta.set(r.song_id, { slug: r.slug, title: r.title });
  if (!linesBySong.has(r.song_id)) linesBySong.set(r.song_id, []);
  linesBySong.get(r.song_id).push(r.text);
}
console.log(`Loaded lyrics for ${songMeta.size} songs (${rows.length} lines).`);

// ---------- word-level ----------
const wordSongs = new Map(); // word -> Set<song_id>
const wordCapitalized = new Map(); // word -> seen capitalized at least once
const wordExample = new Map(); // word -> Map<song_id, line>

for (const [songId, lines] of linesBySong) {
  for (const line of lines) {
    const rawWords = line.split(/\s+/);
    rawWords.forEach((raw, i) => {
      const clean = raw.replace(/[^a-zA-Z0-9']/g, '');
      if (!clean) return;
      const word = clean.toLowerCase();
      if (word.length < 4 || STOPWORDS.has(word) || /^\d+$/.test(word)) return;
      // Every lyric line is capitalized at position 0 regardless of the word
      // there, so that tells us nothing about it being a proper noun — only
      // count capitalization that shows up mid-line as a signal.
      if (i > 0 && /^[A-Z]/.test(clean)) wordCapitalized.set(word, true);
      if (!wordSongs.has(word)) wordSongs.set(word, new Set());
      wordSongs.get(word).add(songId);
      if (!wordExample.has(word)) wordExample.set(word, new Map());
      if (!wordExample.get(word).has(songId)) wordExample.get(word).set(songId, line.trim());
    });
  }
}

const wordCandidates = [...wordSongs.entries()]
  .filter(([, songs]) => songs.size >= MIN_SONGS && songs.size <= MAX_SONGS)
  .map(([word, songs]) => ({
    word,
    capitalized: !!wordCapitalized.get(word),
    songCount: songs.size,
    songs: [...songs].map((id) => ({ ...songMeta.get(id), line: wordExample.get(word).get(id) })),
  }))
  .sort((a, b) => (b.capitalized - a.capitalized) || a.songCount - b.songCount || a.word.localeCompare(b.word));

// ---------- phrase-level (4-6 word windows) ----------
// Short 3-word windows turned out too noisy for rap lyrics specifically —
// stock phrasing/rhyme-scheme filler ("'em hit 'em like") coincidentally
// repeats across unrelated songs often enough to bury real callbacks. An
// exact 4+ word match across different songs is far less likely by chance.
const phraseSongs = new Map(); // phrase -> Set<song_id>
const phraseExample = new Map(); // phrase -> Map<song_id, line>

for (const [songId, lines] of linesBySong) {
  const seenThisSong = new Set();
  for (const line of lines) {
    const words = tokenize(line);
    for (const n of [6, 5, 4]) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (gram.every((w) => STOPWORDS.has(w) || w.length < 3)) continue; // skip all-filler grams
        const phrase = gram.join(' ');
        if (seenThisSong.has(phrase)) continue; // count each song once per phrase
        seenThisSong.add(phrase);
        if (!phraseSongs.has(phrase)) phraseSongs.set(phrase, new Set());
        phraseSongs.get(phrase).add(songId);
        if (!phraseExample.has(phrase)) phraseExample.set(phrase, new Map());
        if (!phraseExample.get(phrase).has(songId)) phraseExample.get(phrase).set(songId, line.trim());
      }
    }
  }
}

const phraseCandidates = [...phraseSongs.entries()]
  .filter(([, songs]) => songs.size >= 2)
  .map(([phrase, songs]) => ({
    phrase,
    wordCount: phrase.split(' ').length,
    songCount: songs.size,
    songs: [...songs].map((id) => ({ ...songMeta.get(id), line: phraseExample.get(phrase).get(id) })),
  }))
  .sort((a, b) => b.wordCount - a.wordCount || a.songCount - b.songCount || a.phrase.localeCompare(b.phrase));

console.log(`\n=== Word candidates (appear in ${MIN_SONGS}-${MAX_SONGS} distinct songs) ===`);
console.log(`${wordCandidates.length} total, showing top ${Math.min(LIMIT, wordCandidates.length)}\n`);
for (const c of wordCandidates.slice(0, LIMIT)) {
  console.log(`${c.capitalized ? '*' : ' '} "${c.word}" — ${c.songCount} songs`);
  for (const s of c.songs) console.log(`    ${s.title}: "${s.line}"`);
}

console.log(`\n=== Phrase candidates (3-4 words, repeated verbatim across songs) ===`);
console.log(`${phraseCandidates.length} total, showing top ${Math.min(LIMIT, phraseCandidates.length)}\n`);
for (const c of phraseCandidates.slice(0, LIMIT)) {
  console.log(`"${c.phrase}" — ${c.songCount} songs`);
  for (const s of c.songs) console.log(`    ${s.title}: "${s.line}"`);
}

if (OUT_PATH) {
  writeFileSync(OUT_PATH, JSON.stringify({ wordCandidates, phraseCandidates }, null, 2));
  console.log(`\nFull results written to ${OUT_PATH}`);
}
