import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '../lib/usePersistedState';

const COLUMNS = [
  { key: 'title', label: 'Song' },
  { key: 'lyrics', label: 'Lyrics' },
  { key: 'video', label: 'Video' },
  { key: 'other', label: 'Other' },
  { key: 'rating', label: 'Rating' },
];

function pct(bucket) {
  return bucket.total === 0 ? -1 : bucket.correct / bucket.total;
}

function sortValue(song, key) {
  if (key === 'title') return song.title.toLowerCase();
  if (key === 'rating') return song.rating;
  return pct(song[key]);
}

function formatBucket(bucket) {
  if (bucket.total === 0) return '0/0 (-)';
  return `${bucket.correct}/${bucket.total} (${Math.round((100 * bucket.correct) / bucket.total)}%)`;
}

export default function SongKnowledgePage() {
  const [songs, setSongs] = useState(null);
  const [sortKey, setSortKey] = useState('title');
  const [sortDir, setSortDir] = useState(1);
  const [hideUnchecked, setHideUnchecked] = usePersistedState('renquiz.hideUnchecked', true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/stats/songs')
      .then((r) => r.json())
      .then(setSongs);
  }, []);

  const anyKnown = songs?.some((s) => s.known) ?? false;

  const sorted = useMemo(() => {
    if (!songs) return [];
    const arr = hideUnchecked && anyKnown ? songs.filter((s) => s.known) : [...songs];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      // Tie-break same-percentage buckets by sample size (higher first), so
      // e.g. 4/4 (100%) sits above 1/1 (100%) regardless of sort direction —
      // more attempts at the same accuracy is the more meaningful result.
      if (sortKey !== 'title') {
        return b[sortKey].total - a[sortKey].total;
      }
      return 0;
    });
    return arr;
  }, [songs, sortKey, sortDir, hideUnchecked, anyKnown]);

  function toggleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => -d);
    } else {
      setSortKey(key);
      setSortDir(key === 'title' ? 1 : -1); // default to worst-first for accuracy columns
    }
  }

  if (!songs) return <p>Loading...</p>;

  return (
    <div className="song-knowledge">
      <h2>Song Knowledge</h2>
      <p className="song-meta">Click a column header to sort. Click a row to open that song.</p>
      {anyKnown && (
        <button className="btn-secondary" onClick={() => setHideUnchecked((v) => !v)}>
          {hideUnchecked ? 'Show all songs' : 'Show only my songs'}
        </button>
      )}
      <div className="data-table">
        <div className="data-table-row knowledge-table-row data-table-header">
          {COLUMNS.map((c) => (
            <span
              key={c.key}
              className={`sortable${sortKey === c.key ? ' sort-active' : ''}`}
              onClick={() => toggleSort(c.key)}
            >
              {c.label} {sortKey === c.key ? (sortDir === 1 ? '▲' : '▼') : ''}
            </span>
          ))}
        </div>
        {sorted.map((s) => (
          <div
            key={s.slug}
            className="data-table-row knowledge-table-row"
            role="button"
            onClick={() => navigate(`/songs/${s.slug}`)}
          >
            <span className="song-link-title">{s.title}</span>
            {['lyrics', 'video', 'other'].map((key) => (
              <span key={key} className="mini-badge yes">
                {formatBucket(s[key])}
              </span>
            ))}
            <span className="mini-badge yes">{s.rating || '-'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
