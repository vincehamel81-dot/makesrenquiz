import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'lyrics', label: 'Lyrics' },
  { key: 'clips', label: 'Clips' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'rating', label: 'Rating' },
  { key: 'yt', label: 'YT' },
];

function sortValue(song, key) {
  switch (key) {
    case 'title':
      return song.title.toLowerCase();
    case 'lyrics':
      return song.lyricLineCount;
    case 'clips':
      return song.clipCount;
    case 'eggs':
      return song.easterEggCount;
    case 'rating':
      return song.personal_rating;
    case 'yt':
      return song.youtube_url ? 1 : 0;
    default:
      return 0;
  }
}

export default function SongsListPage() {
  const [songs, setSongs] = useState([]);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState('title');
  const [sortDir, setSortDir] = useState(1);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/songs?stats=1')
      .then((r) => r.json())
      .then(setSongs);
  }, []);

  function toggleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => -d);
    } else {
      setSortKey(key);
      setSortDir(key === 'title' ? 1 : -1); // default to highest-first for count/rating columns
    }
  }

  const visible = useMemo(() => {
    const filtered = songs.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()));
    filtered.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    });
    return filtered;
  }, [songs, filter, sortKey, sortDir]);

  return (
    <div className="songs-list">
      <input type="text" placeholder="Filter songs..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="data-table">
        <div className="data-table-row songs-table-row data-table-header">
          {COLUMNS.map((c) => (
            <span key={c.key} className={`sortable${sortKey === c.key ? ' sort-active' : ''}`} onClick={() => toggleSort(c.key)}>
              {c.label} {sortKey === c.key ? (sortDir === 1 ? '▲' : '▼') : ''}
            </span>
          ))}
        </div>
        {visible.map((s) => (
          <div
            key={s.slug}
            className="data-table-row songs-table-row"
            role="button"
            onClick={() => navigate(`/songs/${s.slug}`)}
          >
            <span className="song-link-title">
              {s.title}
              {s.album_name && <span className="song-link-album">{s.album_name}</span>}
            </span>
            <span className={`mini-badge ${s.lyricLineCount > 0 ? 'yes' : 'no'}`} title="Lyrics">
              📝 {s.lyricLineCount > 0 ? 'yes' : 'no'}
            </span>
            <span className={`mini-badge ${s.clipCount > 0 ? 'yes' : 'no'}`} title="Audio clips">
              🎵 {s.clipCount}
            </span>
            <span className={`mini-badge ${s.easterEggCount > 0 ? 'yes' : 'no'}`} title="Easter eggs">
              🥚 {s.easterEggCount}
            </span>
            <span className={`mini-badge ${s.personal_rating > 0 ? 'yes' : 'no'}`} title="Your rating">
              ⭐ {s.personal_rating || '-'}
            </span>
            {s.youtube_url ? (
              <a
                className="mini-badge yes"
                href={s.youtube_url}
                target="_blank"
                rel="noreferrer"
                title="Open on YouTube"
                onClick={(e) => e.stopPropagation()}
              >
                ▶
              </a>
            ) : (
              <span className="mini-badge no" title="No YouTube link yet">
                ▶
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
