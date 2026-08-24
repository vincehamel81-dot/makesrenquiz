import { useState } from 'react';

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 36 };
const PALETTE = ['#aa3bff', '#2dd4bf', '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#e879f9', '#a3a300'];

function seriesLabel(count) {
  return count === null ? 'Before tracking' : `${count} song${count === 1 ? '' : 's'}`;
}

// Daily accuracy trend — a lightweight dependency-free inline-SVG line chart.
// One line per distinct `active_song_count` value (how many songs were
// checked at quiz time), since accuracy on 5 songs isn't comparable to
// accuracy on 50. Rows from before session-tracking existed carry a null
// count and group into their own "Before tracking" line rather than being
// dropped.
export default function TrendChart({ daily }) {
  const [hoverDay, setHoverDay] = useState(null);

  if (daily.length === 0) return <p>No attempts logged yet — play a session first.</p>;

  const days = [...new Set(daily.map((d) => d.day))].sort();

  if (days.length === 1) {
    const totals = daily.reduce(
      (acc, d) => ({ correct: acc.correct + d.correct, attempts: acc.attempts + d.attempts }),
      { correct: 0, attempts: 0 }
    );
    const pct = Math.round((100 * totals.correct) / totals.attempts);
    return (
      <p>
        {days[0]}: {pct}% accuracy ({totals.correct}/{totals.attempts}). Play another day to see a trend.
      </p>
    );
  }

  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const seriesKeys = [...new Set(daily.map((d) => d.active_song_count))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));

  const series = seriesKeys.map((key, si) => ({
    key,
    label: seriesLabel(key),
    color: PALETTE[si % PALETTE.length],
    points: daily
      .filter((d) => d.active_song_count === key)
      .map((d) => ({ ...d, i: dayIndex.get(d.day), pct: (100 * d.correct) / d.attempts }))
      .sort((a, b) => a.i - b.i),
  }));

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (innerW * i) / (days.length - 1);
  const y = (pct) => PAD.top + innerH * (1 - pct / 100);
  const gridLines = [0, 25, 50, 75, 100];

  const hoverRows = hoverDay === null ? [] : daily.filter((d) => d.day === days[hoverDay]);

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Daily accuracy trend by number of songs">
        {gridLines.map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(g)} y2={y(g)} className="trend-grid" />
            <text x={PAD.left - 8} y={y(g)} className="trend-axis-label" textAnchor="end" dominantBaseline="middle">
              {g}%
            </text>
          </g>
        ))}

        {series.map((s) => (
          <path
            key={s.key ?? 'legacy'}
            d={s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.i)} ${y(p.pct)}`).join(' ')}
            className="trend-line"
            style={{ stroke: s.color }}
            fill="none"
          />
        ))}

        {series.map((s) =>
          s.points.map((p) => (
            <circle
              key={`${s.key ?? 'legacy'}-${p.day}`}
              cx={x(p.i)}
              cy={y(p.pct)}
              r={hoverDay === p.i ? 5 : 3}
              className="trend-dot"
              style={{ fill: s.color }}
            />
          ))
        )}

        {days.map((day, i) => (
          <rect
            key={day}
            x={x(i) - innerW / days.length / 2}
            y={PAD.top}
            width={innerW / days.length}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverDay(i)}
            onMouseLeave={() => setHoverDay((h) => (h === i ? null : h))}
          />
        ))}

        {hoverDay !== null && (
          <line x1={x(hoverDay)} x2={x(hoverDay)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="trend-crosshair" />
        )}

        {days.map(
          (day, i) =>
            (i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 6) === 0) && (
              <text key={day} x={x(i)} y={HEIGHT - PAD.bottom + 16} className="trend-axis-label" textAnchor="middle">
                {day.slice(5)}
              </text>
            )
        )}
      </svg>

      <div className="trend-legend">
        {series.map((s) => (
          <span key={s.key ?? 'legacy'} className="trend-legend-item">
            <span className="trend-legend-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      {hoverDay !== null && (
        <div className="trend-tooltip">
          <strong>{days[hoverDay]}</strong>
          {hoverRows.map((r) => (
            <div key={r.active_song_count ?? 'legacy'}>
              {seriesLabel(r.active_song_count)}: {Math.round((100 * r.correct) / r.attempts)}% ({r.correct}/{r.attempts}),{' '}
              {r.points} pts
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
