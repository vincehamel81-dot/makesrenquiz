import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import SongAutocomplete from '../components/SongAutocomplete';

export default function LookupPage() {
  const { isAdmin } = useAuth();
  const [word, setWord] = useState('');
  const [results, setResults] = useState(null);

  const [terms, setTerms] = useState(null);
  const [songs, setSongs] = useState([]);
  const [adding, setAdding] = useState(false);
  const [termDraft, setTermDraft] = useState('');
  const [songDraft, setSongDraft] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  function loadTerms() {
    fetch('/api/reference-terms')
      .then((r) => r.json())
      .then(setTerms);
  }

  useEffect(() => {
    loadTerms();
    fetch('/api/songs')
      .then((r) => r.json())
      .then(setSongs);
  }, []);

  async function search(e) {
    e.preventDefault();
    if (!word.trim()) return;
    const res = await fetch(`/api/lookup?word=${encodeURIComponent(word.trim())}`);
    setResults(await res.json());
  }

  async function submitTerm(e) {
    e.preventDefault();
    const term = termDraft.trim();
    const songTitle = songDraft.trim();
    if (!term || !songTitle) return;
    if (!songs.some((s) => s.title.toLowerCase() === songTitle.toLowerCase())) {
      setAddError('Pick a song from the list — no exact title match.');
      return;
    }
    setSaving(true);
    setAddError('');
    const res = await fetch('/api/reference-terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term, song_title: songTitle }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || 'Failed to add');
      return;
    }
    setSongDraft('');
    loadTerms();
  }

  const bySong = (results ?? []).reduce((acc, r) => {
    (acc[r.title] ??= []).push(r.text);
    return acc;
  }, {});

  return (
    <div className="lookup">
      <h2>Lyric word lookup</h2>
      <form onSubmit={search}>
        <input
          type="text"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="e.g. Jimmy"
        />
        <button type="submit">Search</button>
      </form>
      {results !== null && (
        <>
          <p>{results.length} matching line(s) across {Object.keys(bySong).length} song(s)</p>
          {Object.entries(bySong).map(([title, lines]) => (
            <div key={title} className="lookup-song">
              <strong>{title}</strong>
              <ul>
                {lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      <h3>Reference terms</h3>
      <p className="song-meta">
        Recurring names/terms and every song that mentions them — curated by hand, separate from each song's own
        Gems.
      </p>
      {terms === null ? (
        <p>Loading...</p>
      ) : terms.length === 0 ? (
        <p>None catalogued yet.</p>
      ) : (
        <ul className="easter-eggs">
          {terms.map((t) => (
            <li key={t.term}>
              <div className="gem-content">
                <strong>{t.term}</strong> —{' '}
                {t.songs.map((s, i) => (
                  <span key={s.slug}>
                    {i > 0 && ', '}
                    <Link to={`/songs/${s.slug}`}>{s.title}</Link>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isAdmin ? null : !adding ? (
        <button onClick={() => setAdding(true)}>+ Add</button>
      ) : (
        <form className="egg-form" onSubmit={submitTerm}>
          <input
            type="text"
            placeholder="Term (e.g. Jimmy)"
            value={termDraft}
            onChange={(e) => setTermDraft(e.target.value)}
          />
          <SongAutocomplete
            songTitles={songs.map((s) => s.title)}
            value={songDraft}
            onChange={(v) => {
              setSongDraft(v);
              setAddError('');
            }}
            onSubmit={submitTerm}
          />
          <div className="actions">
            <button type="submit" disabled={saving || !termDraft.trim() || !songDraft.trim()}>
              {saving ? 'Adding...' : 'Add song to term'}
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Done
            </button>
          </div>
          {addError && <p className="title-error">{addError}</p>}
        </form>
      )}
    </div>
  );
}
