import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePersistedState } from '../lib/usePersistedState';
import { useAuth } from '../lib/AuthContext';

const COLUMNS = [
  { key: 'known', label: '' },
  { key: 'title', label: 'Title' },
  { key: 'lyrics', label: 'Lyrics' },
  { key: 'clips', label: 'Clips' },
  { key: 'eggs', label: 'Gems' },
  { key: 'rating', label: 'Rating' },
  { key: 'yt', label: 'YT' },
];

function sortValue(song, key) {
  switch (key) {
    case 'known':
      return song.known ? 1 : 0;
    case 'title':
      return song.title.toLowerCase();
    case 'lyrics':
      return song.lyricLineCount;
    case 'clips':
      return song.clipCount;
    case 'eggs':
      return song.easterEggCount;
    case 'rating':
      return song.rating;
    case 'yt':
      return song.youtube_url ? 1 : 0;
    default:
      return 0;
  }
}

const EMPTY_ADD_FORM = { title: '', youtube_url: '', album: '', collaborators: '' };

const CSV_COLUMNS = [
  ['title', 'Title'],
  ['slug', 'Slug'],
  ['album_name', 'Album'],
  ['known', 'Known'],
  ['lyricLineCount', 'Lyric lines'],
  ['clipCount', 'Clips'],
  ['easterEggCount', 'Gems'],
  ['rating', 'Rating'],
  ['youtube_url', 'YouTube URL'],
];

function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportSongsCsv(songs) {
  const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const rows = songs.map((s) =>
    CSV_COLUMNS.map(([key]) => csvField(key === 'known' ? (s.known ? 'yes' : 'no') : s[key])).join(',')
  );
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `renquiz-songs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SongsListPage() {
  const { isAdmin } = useAuth();
  const [songs, setSongs] = useState([]);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState('title');
  const [sortDir, setSortDir] = useState(1);
  const [hideUnchecked, setHideUnchecked] = usePersistedState('renquiz.hideUnchecked', true);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addError, setAddError] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);
  const navigate = useNavigate();

  function load() {
    fetch('/api/songs?stats=1')
      .then((r) => r.json())
      .then(setSongs);
  }

  useEffect(load, []);

  async function submitAdd(e) {
    e.preventDefault();
    const title = addForm.title.trim();
    if (!title) return;
    setSavingAdd(true);
    setAddError('');
    const res = await fetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        youtube_url: addForm.youtube_url.trim(),
        album: addForm.album.trim(),
        collaborators: addForm.collaborators.split(',').map((c) => c.trim()).filter(Boolean),
      }),
    });
    setSavingAdd(false);
    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || 'Failed to add song');
      return;
    }
    setAddForm(EMPTY_ADD_FORM);
    load(); // stays open — adding several in a row is the common case
  }

  function toggleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => -d);
    } else {
      setSortKey(key);
      setSortDir(key === 'title' ? 1 : -1); // default to highest-first for count/rating columns
    }
  }

  const anyKnown = songs.some((s) => s.known);

  const visible = useMemo(() => {
    let filtered = songs.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()));
    if (hideUnchecked && anyKnown) filtered = filtered.filter((s) => s.known);
    filtered.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    });
    return filtered;
  }, [songs, filter, sortKey, sortDir, hideUnchecked, anyKnown]);

  return (
    <div className="songs-list">
      <div className="songs-list-controls">
        <input type="text" placeholder="Filter songs..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        {anyKnown && (
          <label className="checkbox-toggle">
            <input type="checkbox" checked={hideUnchecked} onChange={(e) => setHideUnchecked(e.target.checked)} />
            Show only my songs
          </label>
        )}
        {isAdmin && (
          <button className="btn-secondary" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : '+ Add song'}
          </button>
        )}
        <button className="btn-secondary" onClick={() => exportSongsCsv(songs)} disabled={songs.length === 0}>
          Export CSV
        </button>
      </div>
      <p className="song-meta song-list-hint">
        {songs.length} songs total{visible.length !== songs.length ? ` (${visible.length} shown)` : ''} — manage
        which songs you're quizzed on from <Link to="/profile">Profile</Link>.
      </p>

      {isAdmin && adding && (
        <form className="egg-form" onSubmit={submitAdd}>
          <input
            type="text"
            placeholder="Title (required)"
            value={addForm.title}
            onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
            autoFocus
          />
          <input
            type="text"
            placeholder="YouTube URL"
            value={addForm.youtube_url}
            onChange={(e) => setAddForm((f) => ({ ...f, youtube_url: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Album (optional — creates it if new)"
            value={addForm.album}
            onChange={(e) => setAddForm((f) => ({ ...f, album: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Collaborators, comma-separated (optional)"
            value={addForm.collaborators}
            onChange={(e) => setAddForm((f) => ({ ...f, collaborators: e.target.value }))}
          />
          <div className="actions">
            <button type="submit" disabled={savingAdd || !addForm.title.trim()}>
              {savingAdd ? 'Adding...' : 'Add song'}
            </button>
          </div>
          {addError && <p className="title-error">{addError}</p>}
        </form>
      )}
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
            <span className={`mini-badge ${s.known ? 'yes' : 'no'}`} title={s.known ? 'You quiz on this song' : 'Not in your quiz rotation'}>
              {s.known ? '✓' : ''}
            </span>
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
            <span className={`mini-badge ${s.easterEggCount > 0 ? 'yes' : 'no'}`} title="Gems">
              💎 {s.easterEggCount}
            </span>
            <span className={`mini-badge ${s.rating > 0 ? 'yes' : 'no'}`} title="Your rating">
              ⭐ {s.rating || '-'}
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
