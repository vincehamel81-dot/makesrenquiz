// CLI wrapper around server/lyricQuestions.js — safe to re-run any time
// lyrics are added/edited (via scraping or the in-app editor).
import { rebuildLyricQuestions } from '../server/lyricQuestions.js';

const { totalAdded, songCount, excludedForOverlap } = rebuildLyricQuestions();
console.log(`Rebuilt lyric question pool: ${totalAdded} questions across ${songCount} songs.`);
console.log(`Excluded ${excludedForOverlap} line(s) that share an opening phrase with another song.`);
