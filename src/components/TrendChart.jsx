import { useState } from 'react';

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 36 };

// Daily accuracy trend — a lightweight dependency-free inline-SVG line chart
// (no charting library needed for one series). Points/attempts are surfaced
// in the tooltip rather than as a second axis.
export default function TrendChart({ daily }) {
  const [hover, setHover] = useState(null);

  if (daily.length === 0) return <p>No attempts logged yet — play a session first.</p>;
  if (daily.length === 1) {
    const d = daily[0];
    const pct = Math.round((100 * d.correct) / d.attempts);
    return (
      <p>
        {d.day}: {pct}% accuracy ({d.correct}/{d.attempts}). Play another day to see a trend.
      </p>
    );
  }

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const points = daily.map((d) => ({ ...d, pct: (100 * d.correct) / d.attempts }));

  const x = (i) => PAD.left + (innerW * i) / (points.length - 1);
  const y = (pct) => PAD.top + innerH * (1 - pct / 100);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.pct)}`).join(' ');
  const gridLines = [0, 25, 50, 75, 100];

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Daily accuracy trend">
        {gridLines.map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(g)} y2={y(g)} className="trend-grid" />
            <text x={PAD.left - 8} y={y(g)} className="trend-axis-label" textAnchor="end" dominantBaseline="middle">
              {g}%
            </text>
          </g>
        ))}

        <path d={linePath} className="trend-line" fill="none" />

        {points.map((p, i) => (
          <g key={p.day}>
            <circle cx={x(i)} cy={y(p.pct)} r={hover === i ? 5 : 3} className="trend-dot" />
            <rect
              x={x(i) - innerW / points.length / 2}
              y={PAD.top}
              width={innerW / points.length}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          </g>
        ))}

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="trend-crosshair" />
        )}

        {points.map(
          (p, i) =>
            (i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0) && (
              <text key={p.day} x={x(i)} y={HEIGHT - PAD.bottom + 16} className="trend-axis-label" textAnchor="middle">
                {p.day.slice(5)}
              </text>
            )
        )}
      </svg>

      {hover !== null && (
        <div className="trend-tooltip">
          <strong>{points[hover].day}</strong> — {Math.round(points[hover].pct)}% accuracy (
          {points[hover].correct}/{points[hover].attempts}), {points[hover].points} pts
        </div>
      )}
    </div>
  );
}
