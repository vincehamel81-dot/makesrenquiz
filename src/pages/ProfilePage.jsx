import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePersistedState } from '../lib/usePersistedState';
import { useAuth } from '../lib/AuthContext';
import RankingModal from '../components/RankingModal';

const NO_ALBUM = 'Singles / Other';
const DISPLAY_NAME_PATTERN = /^[a-zA-Z0-9]{3,15}$/;

function sortValue(song, key) {
  return key === 'rating' ? song.rating : song.title.toLowerCase();
}

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState('');

  const [prefs, setPrefs] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [songs, setSongs] = useState(null);
  const [viewMode, setViewMode] = usePersistedState('renquiz.songsViewMode', 'album'); // 'album' | 'list'
  const [sortKey, setSortKey] = useState('title');
  const [sortDir, setSortDir] = useState(1);
  const [rankingOpen, setRankingOpen] = useState(false);

  function loadSongs() {
    fetch('/api/songs?stats=1')
      .then((r) => r.json())
      .then(setSongs);
  }

  useEffect(() => {
    if (user) setNameDraft(user.display_name);
  }, [user]);

  useEffect(() => {
    fetch('/api/preferences')
      .then((r) => r.json())
      .then((p) => {
        setPrefs(p);
        setDraft(p);
      });
    loadSongs();
  }, []);

  const albumGroups = useMemo(() => {
    if (!songs) return [];
    const groups = new Map();
    for (const s of songs) {
      const key = s.album_name ?? NO_ALBUM;
      if (!groups.has(key)) groups.set(key, { name: key, releaseDate: s.album_release_date, songs: [] });
      groups.get(key).songs.push(s);
    }
    for (const g of groups.values()) g.songs.sort((a, b) => a.title.localeCompare(b.title));
    return [...groups.values()].sort((a, b) => {
      if (a.name === NO_ALBUM) return 1;
      if (b.name === NO_ALBUM) return -1;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return b.releaseDate.localeCompare(a.releaseDate); // most recent album first
    });
  }, [songs]);

  const sortedList = useMemo(() => {
    if (!songs) return [];
    const arr = [...songs];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    });
    return arr;
  }, [songs, sortKey, sortDir]);

  if (!draft || !songs) return <p>Loading...</p>;

  const total = draft.audio_pct + draft.lyric_pct + draft.trivia_pct;
  const valid = total === 100;

  function update(key, value) {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: Math.max(0, Math.min(100, Number(value) || 0)) }));
  }

  async function saveDisplayName() {
    const trimmed = nameDraft.trim();
    if (!DISPLAY_NAME_PATTERN.test(trimmed)) return;
    setSavingName(true);
    setNameError('');
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: trimmed }),
    });
    setSavingName(false);
    if (!res.ok) {
      const data = await res.json();
      setNameError(data.error || 'Failed to save');
      return;
    }
    await refresh();
    setNameSaved(true);
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setPrefs(draft);
    setSaving(false);
    setSaved(true);
  }

  function toggleSong(song) {
    const known = !song.known;
    setSongs((prev) => prev.map((s) => (s.id === song.id ? { ...s, known } : s)));
    fetch(`/api/user-songs/${song.id}`, { method: known ? 'PUT' : 'DELETE' });
  }

  function setAlbum(albumSongs, known) {
    const ids = new Set(albumSongs.map((s) => s.id));
    setSongs((prev) => prev.map((s) => (ids.has(s.id) ? { ...s, known } : s)));
    for (const s of albumSongs) fetch(`/api/user-songs/${s.id}`, { method: known ? 'PUT' : 'DELETE' });
  }

  function toggleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => -d);
    } else {
      setSortKey(key);
      setSortDir(key === 'title' ? 1 : -1);
    }
  }

  const knownCount = songs.filter((s) => s.known).length;

  return (
    <div className="profile">
      <h2>Profile</h2>

      <h3>Display name</h3>
      <p className="song-meta">
        What shows in the topbar and on the Leaderboard — not your real name. 3-15 letters/numbers, no spaces, must
        be unique. Defaults to a random placeholder; change it to whatever you'd like.
      </p>
      <div className="rating-field">
        <input
          type="text"
          maxLength={15}
          value={nameDraft}
          onChange={(e) => {
            setNameDraft(e.target.value.replace(/[^a-zA-Z0-9]/g, ''));
            setNameSaved(false);
            setNameError('');
          }}
        />
        <button
          onClick={saveDisplayName}
          disabled={savingName || !DISPLAY_NAME_PATTERN.test(nameDraft) || nameDraft === user?.display_name}
        >
          {savingName ? 'Saving...' : 'Save'}
        </button>
        {nameSaved && <span className="save-confirm"> Saved.</span>}
        {nameError && <span className="title-error"> {nameError}</span>}
      </div>

      <h3>Quiz mix</h3>
      <p className="song-meta">
        How your quiz sessions are split between audio clips, lyric snippets, and other trivia (themes, bio facts,
        collaborators, album/follow-up questions). Must add up to 100%.
      </p>
      <div className="ratio-fields">
        <label>
          Audio clips
          <input type="number" min="0" max="100" value={draft.audio_pct} onChange={(e) => update('audio_pct', e.target.value)} />
        </label>
        <label>
          Lyrics
          <input type="number" min="0" max="100" value={draft.lyric_pct} onChange={(e) => update('lyric_pct', e.target.value)} />
        </label>
        <label>
          Trivia
          <input type="number" min="0" max="100" value={draft.trivia_pct} onChange={(e) => update('trivia_pct', e.target.value)} />
        </label>
      </div>
      <p className={valid ? 'ratio-total-ok' : 'ratio-total-bad'}>Total: {total}%{!valid && ' — must equal 100%'}</p>
      <button onClick={save} disabled={saving || !valid || JSON.stringify(draft) === JSON.stringify(prefs)}>
        {saving ? 'Saving...' : 'Save'}
      </button>
      {saved && <span className="save-confirm"> Saved.</span>}

      <h3>My ratings</h3>
      <p className="song-meta">
        Drag your favorite songs into order instead of typing a number per song — top of the list scores highest.
      </p>
      <button className="btn-secondary" onClick={() => setRankingOpen(true)}>
        Rank your songs
      </button>
      {rankingOpen && <RankingModal onClose={() => setRankingOpen(false)} onSaved={loadSongs} />}

      <h3>My songs</h3>
      <p className="song-meta">
        {knownCount} of {songs.length} songs checked — these are what the Quiz draws from. Browse full song details
        (lyrics, clips, easter eggs) on the <Link to="/songs">Songs</Link> tab.
      </p>
      <div className="songs-list-controls">
        <button className={`btn-secondary${viewMode === 'album' ? ' active' : ''}`} onClick={() => setViewMode('album')}>
          By album
        </button>
        <button className={`btn-secondary${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>
          List
        </button>
      </div>

      {viewMode === 'album' ? (
        <div className="album-groups">
          {albumGroups.map((g) => {
            const allKnown = g.songs.every((s) => s.known);
            return (
              <div key={g.name} className="album-group">
                <div className="album-group-header">
                  <strong>
                    {g.name}
                    {g.releaseDate && ` (${g.releaseDate.slice(0, 4)})`}
                  </strong>
                  <button className="btn-secondary" onClick={() => setAlbum(g.songs, !allKnown)}>
                    {allKnown ? 'Uncheck all' : 'Check all'}
                  </button>
                </div>
                <div className="album-group-songs">
                  {g.songs.map((s) => (
                    <label key={s.id} className="checklist-item">
                      <input type="checkbox" checked={!!s.known} onChange={() => toggleSong(s)} />
                      {s.title}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="data-table">
          <div className="data-table-row checklist-table-row data-table-header">
            <span />
            <span className={`sortable${sortKey === 'title' ? ' sort-active' : ''}`} onClick={() => toggleSort('title')}>
              Title {sortKey === 'title' ? (sortDir === 1 ? '▲' : '▼') : ''}
            </span>
            <span className={`sortable${sortKey === 'rating' ? ' sort-active' : ''}`} onClick={() => toggleSort('rating')}>
              Rating {sortKey === 'rating' ? (sortDir === 1 ? '▲' : '▼') : ''}
            </span>
          </div>
          {sortedList.map((s) => (
            <label key={s.id} className="data-table-row checklist-table-row">
              <input type="checkbox" checked={!!s.known} onChange={() => toggleSong(s)} />
              <span className="song-link-title">{s.title}</span>
              <span className={`mini-badge ${s.rating > 0 ? 'yes' : 'no'}`}>⭐ {s.rating || '-'}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
