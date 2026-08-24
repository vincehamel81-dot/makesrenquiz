export function normalize(s) {
  return (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// A few song titles are "/"-delimited mashups/medleys (e.g. "Earned It /
// Man's World / Falling") — naming any one of the component songs is a
// reasonable answer, not just the full combined title verbatim.
export function answerMatches(userAnswer, correctAnswer) {
  const normUser = normalize(userAnswer);
  if (normUser === normalize(correctAnswer)) return true;
  return correctAnswer.includes('/') && correctAnswer.split('/').some((part) => normalize(part) === normUser);
}
