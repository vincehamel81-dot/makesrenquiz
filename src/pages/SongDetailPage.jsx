import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ClipPlayer from '../components/ClipPlayer';
import { useAuth } from '../lib/AuthContext';
import { youtubeVideoId } from '../lib/youtube';

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Gem timestamps are always MM:SS with both parts zero-padded (so they sort
// and scan as plain text too), unlike formatTime()'s bare-minutes format
// used for audio clip offsets elsewhere on this page.
function formatMMSS(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseMMSS(text) {
  const match = (text || '').trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isSoundCloudUrl(url) {
  return !!url && /(^|\/\/)(www\.)?soundcloud\.com\//.test(url);
}

const EMPTY_EGG_FORM = {
  term: '',
  description: '',
  category: 'easter_egg',
  confidence: 'theory',
  quizzable: false,
  source_url: '',
  timestamp: '',
};

const GEM_CATEGORY_LABELS = {
  easter_egg: 'Easter Egg',
  reference: 'Reference',
  wordplay: 'Wordplay',
  fact: 'Fact',
  analysis: 'Analysis',
};

export default function SongDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [addingEgg, setAddingEgg] = useState(false);
  const [eggForm, setEggForm] = useState(EMPTY_EGG_FORM);
  const [showVideo, setShowVideo] = useState(false);
  const [videoStartSec, setVideoStartSec] = useState(0);
  const videoBlockRef = useRef(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [albumDraft, setAlbumDraft] = useState('');
  const [savingAlbum, setSavingAlbum] = useState(false);

  function load() {
    setDetail(null);
    fetch(`/api/songs/${slug}/detail`)
      .then((r) => r.json())
      .then(setDetail);
  }

  useEffect(load, [slug]);
  useEffect(() => setShowVideo(false), [slug]);

  useEffect(() => {
    if (showVideo && videoStartSec > 0) {
      videoBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showVideo, videoStartSec]);

  useEffect(() => {
    if (detail) setUrlDraft(detail.youtube_url ?? '');
  }, [detail?.youtube_url]);

  useEffect(() => {
    if (detail) setTitleDraft(detail.title);
  }, [detail?.title]);

  useEffect(() => {
    if (detail) setAlbumDraft(detail.album_name ?? '');
  }, [detail?.album_name]);

  if (!detail) return <p>Loading...</p>;

  async function saveTitle() {
    if (!titleDraft.trim()) return;
    setSavingTitle(true);
    setTitleError('');
    const res = await fetch(`/api/songs/${slug}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    const data = await res.json();
    setSavingTitle(false);
    if (!res.ok) {
      setTitleError(data.error || 'Failed to save');
      return;
    }
    setDetail((d) => ({ ...d, title: data.title }));
    setEditingTitle(false);
  }

  async function saveUrl() {
    setSavingUrl(true);
    await fetch(`/api/songs/${slug}/youtube-url`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtube_url: urlDraft }),
    });
    setDetail((d) => ({ ...d, youtube_url: urlDraft.trim() || null }));
    setSavingUrl(false);
  }

  async function saveAlbum() {
    setSavingAlbum(true);
    await fetch(`/api/songs/${slug}/album`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album: albumDraft }),
    });
    setDetail((d) => ({ ...d, album_name: albumDraft.trim() || null }));
    setSavingAlbum(false);
  }

  function startEditing() {
    setDraft(detail.lyrics.map((l) => l.text).join('\n'));
    setEditing(true);
  }

  async function saveLyrics() {
    setSaving(true);
    await fetch(`/api/songs/${slug}/lyrics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: draft }),
    });
    setSaving(false);
    setEditing(false);
    load();
  }

  async function deleteSong() {
    if (!confirm(`Delete "${detail.title}" permanently? This removes its lyrics, clips, and gems.`)) return;
    await fetch(`/api/songs/${slug}`, { method: 'DELETE' });
    navigate('/songs');
  }

  async function deleteEgg(id) {
    await fetch(`/api/easter-eggs/${id}`, { method: 'DELETE' });
    setDetail((d) => ({ ...d, easterEggs: d.easterEggs.filter((e) => e.id !== id) }));
  }

  function jumpToTimestamp(sec) {
    setVideoStartSec(sec);
    setShowVideo(true);
  }

  async function deleteClip(id) {
    await fetch(`/api/questions/${id}`, { method: 'DELETE' });
    setDetail((d) => ({ ...d, clips: d.clips.filter((c) => c.id !== id) }));
  }

  async function submitEgg(e) {
    e.preventDefault();
    if (!eggForm.description.trim()) return;
    if (eggForm.timestamp.trim() && parseMMSS(eggForm.timestamp) === null) return;
    await fetch(`/api/songs/${slug}/easter-eggs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...eggForm, timestamp_sec: parseMMSS(eggForm.timestamp) }),
    });
    setEggForm(EMPTY_EGG_FORM);
    setAddingEgg(false);
    load();
  }

  return (
    <div className="song-detail">
      <div className="song-detail-topbar">
        <Link to="/songs">&larr; Back to songs</Link>
        {isAdmin && (
          <button className="danger-link" onClick={deleteSong}>
            Delete song
          </button>
        )}
      </div>
      {isAdmin && editingTitle ? (
        <div className="title-editor">
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
            autoFocus
          />
          <button onClick={saveTitle} disabled={savingTitle}>
            {savingTitle ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => {
              setEditingTitle(false);
              setTitleDraft(detail.title);
              setTitleError('');
            }}
            disabled={savingTitle}
          >
            Cancel
          </button>
          {titleError && <span className="title-error">{titleError}</span>}
        </div>
      ) : (
        <h2>
          {detail.title}{' '}
          {isAdmin && (
            <button className="edit-title-btn" onClick={() => setEditingTitle(true)} title="Rename song">
              ✎
            </button>
          )}
        </h2>
      )}
      {isAdmin ? (
        <div className="rating-field">
          <label>
            Album:
            <input
              type="text"
              placeholder="No album"
              value={albumDraft}
              onChange={(e) => setAlbumDraft(e.target.value)}
              className="youtube-url-input"
            />
          </label>
          <button onClick={saveAlbum} disabled={savingAlbum || albumDraft === (detail.album_name ?? '')}>
            {savingAlbum ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : (
        detail.album_name && <p className="song-meta">Album: {detail.album_name}</p>
      )}

      <div className="video-embed-block" ref={videoBlockRef}>
        {isAdmin && (
          <div className="rating-field">
            <label>
              Audio link (YouTube/SoundCloud):
              <input
                type="text"
                placeholder="https://www.youtube.com/watch?v=... or https://soundcloud.com/..."
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                className="youtube-url-input"
              />
            </label>
            <button onClick={saveUrl} disabled={savingUrl || urlDraft === (detail.youtube_url ?? '')}>
              {savingUrl ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
        {detail.youtube_url && (
          <>
            <button onClick={() => setShowVideo((v) => !v)}>
              {showVideo ? 'Hide player' : isSoundCloudUrl(detail.youtube_url) ? '▶ Play on SoundCloud' : '▶ Watch on YouTube'}
            </button>
            {showVideo &&
              (youtubeVideoId(detail.youtube_url) ? (
                <div className="video-embed">
                  <iframe
                    src={`https://www.youtube.com/embed/${youtubeVideoId(detail.youtube_url)}${videoStartSec ? `?start=${videoStartSec}` : ''}`}
                    title={`${detail.title} on YouTube`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : isSoundCloudUrl(detail.youtube_url) ? (
                <div className="video-embed soundcloud-embed">
                  <iframe
                    src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(detail.youtube_url)}&color=%23ff5500&auto_play=false&show_teaser=true`}
                    title={`${detail.title} on SoundCloud`}
                    allow="autoplay"
                  />
                </div>
              ) : (
                <p>
                  <a href={detail.youtube_url} target="_blank" rel="noreferrer">
                    Open link
                  </a>
                </p>
              ))}
          </>
        )}
      </div>

      {user && (
        <p className="song-meta">
          Your rating: {detail.rating > 0 ? detail.rating : 'not ranked yet'} — manage it from{' '}
          <Link to="/profile">Profile</Link>.
        </p>
      )}

      <h3>Audio clips</h3>
      {detail.clips.length === 0 ? (
        <p>No clips yet.</p>
      ) : (
        <div className="clip-list">
          {detail.clips.map((c) => (
            <div key={c.id} className="clip-list-item">
              <span>{formatTime(c.start_sec)}</span>
              <ClipPlayer src={c.audio_url} durationSec={c.duration_sec} />
              {isAdmin && (
                <button className="egg-delete" onClick={() => deleteClip(c.id)} title="Remove this clip">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <h3>Lyrics</h3>
      {!editing ? (
        <>
          {detail.lyrics.length === 0 ? <p>No lyrics loaded yet.</p> : null}
          <div className="lyrics">
            {detail.lyrics.map((l) => (
              <p key={l.line_no} className={l.is_header ? 'lyric-header' : ''}>
                {l.text}
              </p>
            ))}
          </div>
          {isAdmin && (
            <button onClick={startEditing}>{detail.lyrics.length === 0 ? 'Add lyrics' : 'Edit lyrics'}</button>
          )}
        </>
      ) : (
        <>
          <textarea
            className="lyrics-editor"
            rows={16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste lyrics or a transcript, one line per line. Section headers like [Chorus] are recognized automatically."
          />
          <div className="actions">
            <button onClick={saveLyrics} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </>
      )}

      <h3>💎 Gems</h3>
      {detail.easterEggs.length === 0 ? (
        <p>None catalogued yet.</p>
      ) : (
        <ul className="easter-eggs">
          {detail.easterEggs.map((e) => (
            <li key={e.id}>
              <div className="gem-content">
                {e.timestamp_sec !== null && (
                  <button type="button" className="badge timestamp" onClick={() => jumpToTimestamp(e.timestamp_sec)}>
                    {formatMMSS(e.timestamp_sec)}
                  </button>
                )}{' '}
                <span className="badge category">{GEM_CATEGORY_LABELS[e.category] ?? e.category}</span>{' '}
                <span className={`badge ${e.confidence}`}>{e.confidence}</span>
                {e.term && <strong> "{e.term}" — </strong>}
                <span className="gem-description">{e.description}</span>
                {e.source_url && (
                  <>
                    {' '}
                    <a href={e.source_url} target="_blank" rel="noreferrer">
                      Source &gt;
                    </a>
                  </>
                )}
              </div>
              {isAdmin && (
                <button className="egg-delete" onClick={() => deleteEgg(e.id)} title="Remove this gem">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isAdmin ? null : !addingEgg ? (
        <button onClick={() => setAddingEgg(true)}>+ Add gem</button>
      ) : (
        <form className="egg-form" onSubmit={submitEgg}>
          <input
            type="text"
            placeholder="Term (optional, e.g. a specific word/phrase)"
            value={eggForm.term}
            onChange={(e) => setEggForm((f) => ({ ...f, term: e.target.value }))}
          />
          <textarea
            rows={eggForm.category === 'analysis' ? 10 : 3}
            placeholder="Description — what's the reference/wordplay/theory/analysis?"
            value={eggForm.description}
            onChange={(e) => setEggForm((f) => ({ ...f, description: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Source URL (optional)"
            value={eggForm.source_url}
            onChange={(e) => setEggForm((f) => ({ ...f, source_url: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Timestamp MM:SS (optional)"
            value={eggForm.timestamp}
            onChange={(e) => setEggForm((f) => ({ ...f, timestamp: e.target.value }))}
          />
          {eggForm.timestamp.trim() && parseMMSS(eggForm.timestamp) === null && (
            <p className="title-error">Timestamp must look like MM:SS, e.g. 02:15</p>
          )}
          <label>
            <select value={eggForm.category} onChange={(e) => setEggForm((f) => ({ ...f, category: e.target.value }))}>
              {Object.entries(GEM_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <select
              value={eggForm.confidence}
              onChange={(e) => setEggForm((f) => ({ ...f, confidence: e.target.value }))}
            >
              <option value="theory">Theory</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </label>
          <label className="egg-form-checkbox">
            <input
              type="checkbox"
              checked={eggForm.quizzable}
              onChange={(e) => setEggForm((f) => ({ ...f, quizzable: e.target.checked }))}
              disabled={!eggForm.term}
            />
            Use as a quiz question ("Which song mentions '{eggForm.term || '...'}' ?") — needs a term
          </label>
          <div className="actions">
            <button type="submit">Save</button>
            <button
              type="button"
              onClick={() => {
                setAddingEgg(false);
                setEggForm(EMPTY_EGG_FORM);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
