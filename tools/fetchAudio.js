// Downloads raw audio per song and slices multiple candidate timestamps into
// the question bank, so the quiz never repeats the exact same 5s of a song.
//
// Matching strategy: YouTube's search relevance buries deep-cut titles under
// Ren's popular hits, so per-song search is unreliable. Instead we pull his
// *entire* channel upload list once (cached in tools/channel_videos.json) and
// match song titles locally against that closed set — much higher precision,
// and it naturally avoids homonym channels (other artists also go by "Ren").
//
// Usage: node tools/fetchAudio.js [limit] [--refresh-channel]
//   limit             - only process the first N songs still missing raw audio (for testing)
//   --refresh-channel - re-fetch the channel video index instead of using the cache
//
// Resumable: skips songs that already have audio_raw/<slug>.mp3. Re-run any
// time to pick up newly added songs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';
import { resolveBin } from '../server/lib/ffmpeg.js';
import { sliceClip } from '../server/lib/clipAudio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'audio_raw');
mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(path.join(ROOT, 'public', 'audio'), { recursive: true });

// Ren's solo channel plus the side-project channels he performs/collabs on —
// early covers and collab tracks (Big Push, Skinner Brothers, Trick the Fox)
// often live on THEIR channel, not his, which is why those were missed
// initially.
const CHANNELS = {
  Ren: 'https://www.youtube.com/@RenMakesMusic/videos',
  'The Big Push': 'https://www.youtube.com/channel/UCLuR_dea3ed8KbIoyvHUB0w/videos',
  'The Skinner Brothers': 'https://www.youtube.com/@theskinnerbrothers/videos',
  'Trick the Fox': 'https://www.youtube.com/user/trickthefox/videos',
};
const CHANNEL_CACHE_PATH = path.join(__dirname, 'channel_videos.json');
// 0 = a dedicated "intro" clip, always the literal first 5s of the track —
// for training on recognizing how songs open, distinct from the other 7
// which are deliberately spread across the body of the song.
const CLIP_FRACTIONS = [0, 0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9];
const CLIP_SLICE_SEC = 10; // raw slice length; playback duration is tuned separately via the ladder
const DEFAULT_PLAYBACK_SEC = 5;
const REPORT_PATH = path.join(__dirname, 'audio_fetch_report.json');

// Videos that bundle many songs (or aren't songs at all) — matching one of
// these would corrupt clip timestamps entirely, so they're excluded outright.
const EXCLUDE_PATTERNS = /full album|documentary|reaction|compilation|behind the scenes|\bbts\b|interview|episode|trailer|megamix|mashup medley/i;
const DEPRIORITIZE_PATTERNS = /\blive\b|acoustic|cover|remix|instrumental|karaoke|sped up|slowed/i;

const args = process.argv.slice(2);
const refreshChannel = args.includes('--refresh-channel');
const limitArg = Number(args.find((a) => /^\d+$/.test(a)));
const limit = Number.isFinite(limitArg) ? limitArg : Infinity;

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function loadChannelIndex() {
  if (!refreshChannel && existsSync(CHANNEL_CACHE_PATH)) {
    return JSON.parse(readFileSync(CHANNEL_CACHE_PATH, 'utf-8'));
  }
  console.log('Fetching channel video indexes (one-time, then cached)...');
  const videos = [];
  for (const [channel, url] of Object.entries(CHANNELS)) {
    const raw = execFileSync(resolveBin('yt-dlp'), ['--flat-playlist', '-j', url], {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 50,
    });
    const channelVideos = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const j = JSON.parse(line);
        return { id: j.id, title: j.title, duration: j.duration, channel };
      });
    console.log(`  ${channel}: ${channelVideos.length} videos`);
    videos.push(...channelVideos);
  }
  writeFileSync(CHANNEL_CACHE_PATH, JSON.stringify(videos, null, 2));
  return videos;
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'is', 'my', 'your']);
// "Part 2" vs "Part 3" — the actual identifying token for multi-part songs.
const PART_MARKER_RE = /^(\d+|i|ii|iii|iv|v)$/;
// Video titles are almost always "<Channel name> - <Title> (<descriptor>)" —
// e.g. "Ren - Hi Ren (Official Music Video)" or "Ren x Sam Tompkins - What
// Went Wrong (Official)". Stripping the channel-attribution prefix AND the
// trailing descriptor parenthetical (stripParenthetical, below) leaves just
// the real title on both ends, so a short title like "Hi Ren" — where "Ren"
// is *also* the channel name — doesn't get swamped by boilerplate that used
// to require a hardcoded word-blacklist (which broke "Love Music" by also
// blacklisting the literal word "music").
const CHANNEL_PREFIX_RE = /^(ren|the big push|the skinner brothers|trick the fox)\b[^-–]*[-–]\s*/i;

// A bare number is exactly what disambiguates "Money Game" from "Money Game,
// Pt. 2" from "Money Game, Pt. 3" — the old length>=3 filter dropped "2"/"3"
// as too short, so every part of a multi-part song scored an identical
// overlap and matched whichever part's video happened to be seen first.
// Numbers (and roman numerals) must always count as significant.
function isSignificant(w) {
  if (STOPWORDS.has(w)) return false;
  return w.length >= 2 || /^\d+$/.test(w); // single-digit part numbers ("2") must survive
}

// "Pt." in our titles vs "Part" spelled out in the actual video title
// shouldn't dodge the (now digit-aware) overlap check.
function expandAbbrev(s) {
  return s.replace(/\bpt\b/gi, 'part');
}

function contentWords(text) {
  return text.split(' ').filter(isSignificant);
}

// "Dream Life (Skinner Brothers)" -> the parenthetical is a collaborator/
// project tag, not part of the literal video title (which is often
// "Ren x The Skinner Brothers - Dream Life"), so it must be stripped before
// comparing or every collab-tagged title in our list looks like a miss. Also
// used on the actual video title to drop its trailing "(Official ...)" tag.
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

// Recall (how much of the wanted title is covered) gates confidence, same as
// before. Precision (how much of the candidate's own content is accounted
// for) only breaks ties — e.g. "Money Game" and "Money Game Part 3" both have
// 100% recall against the plain "Money Game" video's title, but the Part 3
// video also matches with 100% recall against ITS candidate too; precision
// is what lets the exact, no-extra-words match win instead of the wrong
// sibling. A part-marker conflict (wanted says "Part 2", candidate says
// "Part 3") is disqualifying outright, not just a tiebreak nudge.
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
    if (conflict) continue; // a different numbered part of the same song
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

function downloadAudio(videoId, outBasePath) {
  const ffmpegBin = resolveBin('ffmpeg');
  const args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--quiet', '--no-warnings', '-o', `${outBasePath}.%(ext)s`];
  if (path.isAbsolute(ffmpegBin)) args.push('--ffmpeg-location', path.dirname(ffmpegBin));
  args.push(`https://www.youtube.com/watch?v=${videoId}`);
  execFileSync(resolveBin('yt-dlp'), args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function probeDuration(filePath) {
  const out = execFileSync(
    resolveBin('ffprobe'),
    ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath],
    { encoding: 'utf-8' }
  );
  return Number(JSON.parse(out).format.duration);
}

const channelIndex = loadChannelIndex();
const songs = db.prepare('SELECT * FROM songs ORDER BY title').all();
const report = existsSync(REPORT_PATH) ? JSON.parse(readFileSync(REPORT_PATH, 'utf-8')) : {};

const insertQuestion = db.prepare(
  `INSERT INTO questions (type, song_id, start_sec, duration_sec, file_path, status) VALUES ('audio', ?, ?, ?, ?, 'pending')`
);
const existingQuestion = db.prepare(`SELECT 1 FROM questions WHERE type = 'audio' AND song_id = ? AND start_sec = ?`);
const updateSongUrl = db.prepare('UPDATE songs SET youtube_url = ? WHERE id = ?');
const updateSongDuration = db.prepare('UPDATE songs SET duration_sec = ? WHERE id = ?');

let processed = 0;
for (const song of songs) {
  if (processed >= limit) break;
  const rawPath = path.join(RAW_DIR, `${song.slug}.mp3`);

  if (!existsSync(rawPath)) {
    processed++;
    console.log(`[${processed}/${Math.min(limit, songs.length)}] Matching: ${song.title}`);
    try {
      // song.youtube_url may already be manually confirmed (e.g. after a
      // review pass) — trust it over the channel index in that case.
      let videoId, matchedTitle;
      if (song.youtube_url) {
        videoId = song.youtube_url.split('v=')[1];
        matchedTitle = '(manually confirmed URL)';
      } else {
        const { best, confident } = pickBest(channelIndex, song.title);
        if (!best) {
          console.warn(`  no plausible match on the channel, skipping`);
          report[song.slug] = { title: song.title, matched: null, needsReview: true };
          writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
          continue;
        }
        if (!confident) {
          console.warn(`  low-confidence match, SKIPPING auto-download — needs manual review`);
          report[song.slug] = {
            title: song.title,
            matched: best.title,
            url: `https://www.youtube.com/watch?v=${best.id}`,
            needsReview: true,
          };
          writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
          continue;
        }
        videoId = best.id;
        matchedTitle = best.title;
      }

      report[song.slug] = {
        title: song.title,
        matched: matchedTitle,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        needsReview: false,
      };
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

      downloadAudio(videoId, path.join(RAW_DIR, song.slug));
      updateSongUrl.run(`https://www.youtube.com/watch?v=${videoId}`, song.id);
      console.log(`  downloaded`);
    } catch (err) {
      const detail = err.stderr ? err.stderr.toString().trim().split('\n').slice(-3).join(' | ') : err.message;
      console.warn(`  failed: ${detail}`);
      continue;
    }
  }

  if (!existsSync(rawPath)) continue; // no source audio (skipped or failed above)

  let duration;
  try {
    duration = probeDuration(rawPath);
    updateSongDuration.run(duration, song.id);
  } catch {
    console.warn(`  could not probe duration for ${song.slug}, skipping clip generation`);
    continue;
  }

  let clipsAdded = 0;
  for (const frac of CLIP_FRACTIONS) {
    const startSec = Math.round(frac * duration);
    if (startSec + 3 > duration) continue; // too close to the end for a usable clip
    if (existingQuestion.get(song.id, startSec)) continue;
    const sliceLen = Math.min(CLIP_SLICE_SEC, duration - startSec);
    const fileName = sliceClip(song.slug, startSec, sliceLen);
    if (!fileName) continue;
    insertQuestion.run(song.id, startSec, DEFAULT_PLAYBACK_SEC, fileName);
    clipsAdded++;
  }
  if (clipsAdded) console.log(`  +${clipsAdded} audio question(s) for "${song.title}"`);
}

console.log(`\nDone. Report: ${REPORT_PATH}`);
const needsReview = Object.values(report).filter((r) => r.needsReview);
if (needsReview.length) {
  console.log(`\n${needsReview.length} song(s) not on the official channel (or ambiguous) — need manual review:`);
  for (const r of needsReview) console.log(`  - ${r.title}${r.matched ? ` -> best guess: ${r.matched}` : ' (no plausible match at all)'}`);
  console.log(`\nThese are likely collabs on another artist's channel, or tracks without a standalone YouTube upload.`);
  console.log(`To resolve: set the correct youtube_url on that song (tools/songs.seed.json + npm run seed:songs), then re-run this script.`);
}
