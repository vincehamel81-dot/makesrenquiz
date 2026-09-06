import { useState } from 'react';

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 46 };

// Score progression — a lightweight dependency-free inline-SVG line chart.
// One point per daily row, plotted as the same scaled score the Leaderboard
// and live quiz score already use ((active_song_count / 2) * points) — that
// scaling exists specifically to make scores comparable across different
// song-counts, so reusing it here means a single continuous line still means
// something even if you toggle your checked-songs list often. An earlier
// version split into one line per distinct active_song_count, which fell
// apart the same way raw accuracy would: toggling your list a lot produces
// a line per count (potentially dozens), and even a repeated count doesn't
// guarantee the same set of songs was checked both times, so treating it as
// one stable "cohort" was shaky to begin with.
function scaledScore(row) {
  return Math.round(((row.active_song_count ?? 0) / 2) * row.points);
}

export default function TrendChart({ daily }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (daily.length === 0) return <p>No attempts logged yet — play a session first.</p>;

  // API returns newest-first; the chart reads left-to-right chronologically.
  // Same-day multiple sessions each still get their own point, in whatever
  // order they came back in — the day label just repeats for that stretch.
  const points = [...daily].reverse().map((d) => ({ ...d, score: scaledScore(d) }));

  if (points.length === 1) {
    return (
      <p>
        {points[0].day}: score {points[0].score}. Play another day to see a trend.
      </p>
    );
  }

  const scores = points.map((p) => p.score);
  const minScore = Math.min(0, ...scores);
  const maxScore = Math.max(...scores) || 1;
  const range = maxScore - minScore || 1;

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (innerW * i) / (points.length - 1);
  const y = (score) => PAD.top + innerH * (1 - (score - minScore) / range);

  // 5 evenly-spaced grid lines from minScore to maxScore, rounded to whole
  // numbers so the axis doesn't show fractional scores.
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(minScore + range * t));

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.score)}`).join(' ');

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Score progression over time">
        {gridLines.map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(g)} y2={y(g)} className="trend-grid" />
            <text x={PAD.left - 8} y={y(g)} className="trend-axis-label" textAnchor="end" dominantBaseline="middle">
              {g}
            </text>
          </g>
        ))}

        <path d={path} className="trend-line" fill="none" />

        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.score)} r={hoverIndex === i ? 5 : 3} className="trend-dot" />
        ))}

        {points.map((p, i) => (
          <rect
            key={i}
            x={x(i) - innerW / points.length / 2}
            y={PAD.top}
            width={innerW / points.length}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
          />
        ))}

        {hoverIndex !== null && (
          <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="trend-crosshair" />
        )}

        {points.map(
          (p, i) =>
            (i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0) && (
              <text key={i} x={x(i)} y={HEIGHT - PAD.bottom + 16} className="trend-axis-label" textAnchor="middle">
                {p.day.slice(5)}
              </text>
            )
        )}
      </svg>

      {hoverIndex !== null && (
        <div className="trend-tooltip">
          <strong>{points[hoverIndex].day}</strong> — score {points[hoverIndex].score} (
          {points[hoverIndex].active_song_count ?? '—'} songs, {points[hoverIndex].points}/
          {points[hoverIndex].max_points} pts,{' '}
          {Math.round((100 * points[hoverIndex].points) / points[hoverIndex].max_points)}% accuracy)
        </div>
      )}
    </div>
  );
}
