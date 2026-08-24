import { db } from './db.js';

// Playback duration ladder for audio questions. The underlying clip file is
// always sliced generously (see tools/fetchAudio.js) at build time; dialing
// difficulty up/down here just changes how many seconds of it get played,
// so feedback is instant and never needs to touch ffmpeg.
const AUDIO_DURATION_LADDER = [0.5, 1, 2, 3, 4, 5, 10];
const LYRIC_MAX_CONTEXT = 4;

function stepLadder(ladder, current, direction) {
  const idx = ladder.reduce(
    (closest, val, i) => (Math.abs(val - current) < Math.abs(ladder[closest] - current) ? i : closest),
    0
  );
  const next = idx + direction;
  return ladder[Math.min(Math.max(next, 0), ladder.length - 1)];
}

// Applies one of the 4 calibration actions to a question bank row.
// Returns the updated row, or throws if the question doesn't exist.
export async function applyFeedback(questionId, action) {
  const row = await db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (!row) throw new Error('question not found');

  if (action === 'not_relevant') {
    await db.prepare(`UPDATE questions SET status = 'retired' WHERE id = ?`).run(questionId);
    return { ...row, status: 'retired' };
  }

  if (action === 'perfect') {
    await db.prepare(`UPDATE questions SET status = 'active' WHERE id = ?`).run(questionId);
    return { ...row, status: 'active' };
  }

  if (action !== 'too_hard' && action !== 'too_easy') {
    throw new Error(`unknown feedback action: ${action}`);
  }

  if (row.type === 'audio') {
    const nextDuration = stepLadder(AUDIO_DURATION_LADDER, row.duration_sec, action === 'too_hard' ? 1 : -1);
    await db.prepare(`UPDATE questions SET status = 'active', duration_sec = ? WHERE id = ?`).run(nextDuration, questionId);
    return { ...row, status: 'active', duration_sec: nextDuration };
  }

  if (row.type === 'lyric') {
    const nextContext =
      action === 'too_hard' ? Math.min(row.context_lines + 1, LYRIC_MAX_CONTEXT) : Math.max(row.context_lines - 1, 1);
    await db.prepare(`UPDATE questions SET status = 'active', context_lines = ? WHERE id = ?`).run(nextContext, questionId);
    return { ...row, status: 'active', context_lines: nextContext };
  }

  // theme / follow-up / album / collaborator / bio: adjust how often it's asked
  const nextWeight = action === 'too_hard' ? Math.min(row.weight * 1.5, 5) : Math.max(row.weight * 0.5, 0.2);
  await db.prepare(`UPDATE questions SET status = 'active', weight = ? WHERE id = ?`).run(nextWeight, questionId);
  return { ...row, status: 'active', weight: nextWeight };
}
