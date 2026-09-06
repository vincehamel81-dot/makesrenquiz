// Starter experience for any brand-new account — guest or a real first-time
// Google sign-in alike, both go through the same seeding (see googleAuth.js's
// seedDefaultsForNewUser). Picked to be a small, thematically coherent
// "sample" of the catalog's story-driven songs rather than either an empty
// checklist (today's old behavior — needsOnboarding forced manual setup
// before the quiz worked at all) or the full 194-song catalog at once.
export const DEFAULT_SONG_SLUGS = [
  'asylum',
  'sick-boi',
  'sick-boi-pt-2',
  'jenny-s-tale',
  'screech-s-tale',
  'violet-s-tale',
  'richard-s-tale-acceptance',
  'richard-s-tale-locked-up',
  'richard-s-tale-set-the-scene',
  'richard-s-tale-the-five-stages-of-grief',
  'vincent-s-tale-01-sunflowers-prologue',
  'vincent-s-tale-02-self-portrait',
  'vincent-s-tale-03-the-bedroom',
  'vincent-s-tale-act-i',
  'vincent-s-tale-act-ii',
  'vincent-s-tale-act-iii',
  'vincent-s-tale-act-iv',
];

export const DEFAULT_PREFERENCES = { audio_pct: 75, lyric_pct: 20, trivia_pct: 5, expert_mode: false };
