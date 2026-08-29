// Per-clip accuracy report — times_asked/times_correct already live on each
// questions row (updated by server/questionTypes.js's markAsked after every
// attempt), this just surfaces them sorted worst-first so bad hard clips are
// easy to spot and retire. Song-level stats hide this: a song can look fine
// overall while one specific clip is consistently missed.
//
// Usage: node tools/clipStats.js [slug] [--difficulty=hard|normal|all] [--min-asked=N]
import { db } from '../server/db.js';

const args = process.argv.slice(2);
const slugArg = args.find((a) => !a.startsWith('--'));
const difficultyArg = (args.find((a) => a.startsWith('--difficulty='))?.split('=')[1]) || 'hard';
const minAsked = Number(args.find((a) => a.startsWith('--min-asked='))?.split('=')[1] ?? 1);

let where = `q.type = 'audio' AND q.status != 'retired'`;
const params = [];
if (difficultyArg !== 'all') {
  where += ` AND q.difficulty = ?`;
  params.push(difficultyArg);
}
if (slugArg) {
  where += ` AND s.slug = ?`;
  params.push(slugArg);
}

const rows = await db
  .prepare(
    `SELECT s.title, s.slug, q.id, q.file_path, q.start_sec, q.difficulty, q.times_asked, q.times_correct
     FROM questions q JOIN songs s ON s.id = q.song_id
     WHERE ${where}
     ORDER BY s.title, q.start_sec`
  )
  .all(...params);

const withStats = rows.filter((r) => r.times_asked >= minAsked);
const unasked = rows.filter((r) => r.times_asked === 0);

withStats.sort((a, b) => a.times_correct / a.times_asked - b.times_correct / b.times_asked);

console.log(`${difficultyArg} clips with >= ${minAsked} attempt(s), worst accuracy first:\n`);
console.log('accuracy  asked  correct  song                                    clip');
for (const r of withStats) {
  const acc = Math.round((100 * r.times_correct) / r.times_asked);
  console.log(
    `${String(acc + '%').padStart(7)}   ${String(r.times_asked).padStart(4)}   ${String(r.times_correct).padStart(6)}   ${r.title.slice(0, 38).padEnd(38)}  ${r.file_path} (id ${r.id})`
  );
}

console.log(`\n${withStats.length} clip(s) with data, ${unasked.length} never asked yet.`);
