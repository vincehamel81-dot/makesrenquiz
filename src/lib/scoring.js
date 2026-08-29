// Single source of truth for quiz point values, shared between QuizPage
// (which awards them) and the Leaderboard's scoring-key tooltip (which just
// displays them) so the two can't drift out of sync when these get tuned.

// Hardcoded per-type point values. Audio's Expert Mode value (95) is a fixed
// number, not a multiplier on the normal value — a flat 2x let hard-mode
// scores blow past the max_points denominator server-side (see
// server/index.js's MAX_POINTS_SQL), showing >100% accuracy on History.
export const DEFAULT_POINTS = 40; // theme/follow-up/album/collaborator/reference
export const BIO_POINTS = 60;
export function pointsForType(type, expertMode) {
  if (type === 'audio') return expertMode ? 95 : 60;
  if (type === 'bio') return BIO_POINTS;
  return DEFAULT_POINTS;
}
// Lyric points still drop with each "...more" reveal — full credit for
// nailing it cold, less for peeking at more context first.
export const LYRIC_REVEAL_POINTS = [100, 70, 50];
export const MAX_LYRIC_REVEAL_TIER = LYRIC_REVEAL_POINTS.length - 1;
// Audio's parallel to the lyric reveal ladder: instead of revealing more of
// the same content, "try another clip" swaps in a different clip from the
// same song at a discount (-15/try, matching the lyric ladder's spirit of
// trading points for an easier ask). Same tier count as lyric's ladder for
// consistency, though the two are otherwise independent mechanics.
export const AUDIO_RETRY_POINTS = { normal: [60, 45, 30], hard: [95, 80, 65] };
export const MAX_AUDIO_RETRY_TIER = AUDIO_RETRY_POINTS.normal.length - 1;
export function audioPointsForTier(expertMode, tier) {
  return (expertMode ? AUDIO_RETRY_POINTS.hard : AUDIO_RETRY_POINTS.normal)[tier];
}
// A correct pick from the 4-choice fallback (gave up on free-text first)
// earns a flat consolation score reflecting recognition, not recall. It
// still varies by type/difficulty — a bigger "cold" value implies a bigger
// gap to the fallback value too.
export const CHOICE_FALLBACK_POINTS = 20; // theme/follow-up/album/collaborator/reference
export const LYRIC_CHOICE_FALLBACK_POINTS = 45;
export const BIO_CHOICE_FALLBACK_POINTS = 30;
export function choiceFallbackPoints(type, expertMode) {
  if (type === 'audio') return expertMode ? 40 : 25;
  if (type === 'lyric') return LYRIC_CHOICE_FALLBACK_POINTS;
  if (type === 'bio') return BIO_CHOICE_FALLBACK_POINTS;
  return CHOICE_FALLBACK_POINTS;
}

// Flat table for the Leaderboard's scoring-key tooltip — one row per
// row-worthy distinction (not every type/mode combo collapses cleanly into
// the functions above, so this is hand-assembled rather than derived).
export const SCORING_TABLE = [
  { label: 'Lyric — cold', points: LYRIC_REVEAL_POINTS[0] },
  { label: 'Lyric — after 1 reveal', points: LYRIC_REVEAL_POINTS[1] },
  { label: 'Lyric — after max reveal', points: LYRIC_REVEAL_POINTS[2] },
  { label: 'Lyric — 4 choices', points: LYRIC_CHOICE_FALLBACK_POINTS },
  { label: 'Song, Normal mode — cold', points: AUDIO_RETRY_POINTS.normal[0] },
  { label: 'Song, Normal mode — try another clip', points: AUDIO_RETRY_POINTS.normal[1] },
  { label: 'Song, Normal mode — 2nd retry', points: AUDIO_RETRY_POINTS.normal[2] },
  { label: 'Song, Normal mode — 4 choices', points: choiceFallbackPoints('audio', false) },
  { label: 'Song, Expert mode — cold', points: AUDIO_RETRY_POINTS.hard[0] },
  { label: 'Song, Expert mode — try another clip', points: AUDIO_RETRY_POINTS.hard[1] },
  { label: 'Song, Expert mode — 2nd retry', points: AUDIO_RETRY_POINTS.hard[2] },
  { label: 'Song, Expert mode — 4 choices', points: choiceFallbackPoints('audio', true) },
  { label: 'Bio — typed', points: BIO_POINTS },
  { label: 'Bio — 4 choices', points: BIO_CHOICE_FALLBACK_POINTS },
  { label: 'Theme / follow-up / album / collaborator / reference', points: DEFAULT_POINTS },
  { label: 'Theme / follow-up / album / collaborator / reference — 4 choices', points: CHOICE_FALLBACK_POINTS },
];
