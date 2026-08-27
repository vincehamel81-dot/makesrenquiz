import { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from './Modal';
import { youtubeVideoId } from '../lib/youtube';

function byTitle(a, b) {
  return a.title.localeCompare(b.title);
}

// Toggles the shared "now playing" embed (see RankingModal) rather than
// managing its own audio — a full video makes more sense for recognizing
// a song you're ranking than a blind 5s clip did. Rows spread dnd-kit's
// drag {...listeners} across the whole element, so this needs its own
// pointerdown stopPropagation like the remove button below, or a click
// here would start a drag instead.
function PlayButton({ song, nowPlayingId, onToggle }) {
  const videoId = youtubeVideoId(song.youtube_url);
  if (!videoId) return <span className="rank-play rank-play-empty" />;
  const playing = nowPlayingId === song.id;
  return (
    <button
      type="button"
      className="rank-play"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onToggle(playing ? null : song)}
      title={playing ? 'Stop' : 'Play video'}
      aria-label={playing ? 'Stop' : 'Play video'}
    >
      {playing ? '■' : '▶'}
    </button>
  );
}

function RankedRow({ song, index, onRemove, isOver, nowPlayingId, onTogglePlay }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rank-row${isOver ? ' rank-row-over' : ''}`}
      {...attributes}
      {...listeners}
    >
      <span className="rank-position">{index + 1}</span>
      <PlayButton song={song} nowPlayingId={nowPlayingId} onToggle={onTogglePlay} />
      <span className="rank-title">{song.title}</span>
      <button
        type="button"
        className="rank-remove"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemove(song)}
        aria-label={`Remove ${song.title} from ranking`}
      >
        ✕
      </button>
    </div>
  );
}

function AvailableRow({ song, nowPlayingId, onTogglePlay }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: song.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="avail-row" {...attributes} {...listeners}>
      <PlayButton song={song} nowPlayingId={nowPlayingId} onToggle={onTogglePlay} />
      {song.title}
    </div>
  );
}

// Its own component (not just a ref inline in the parent) so useDroppable
// stays a normal top-level hook call regardless of the parent's loading-state
// early return — hooks can't follow a conditional return in the same
// component.
function AvailableColumn({ songs, nowPlayingId, onTogglePlay }) {
  const { setNodeRef } = useDroppable({ id: 'available-dropzone' });
  return (
    <div ref={setNodeRef} className="avail-list">
      {songs.map((song) => (
        <AvailableRow key={song.id} song={song} nowPlayingId={nowPlayingId} onTogglePlay={onTogglePlay} />
      ))}
    </div>
  );
}

function RankedColumn({ ranked, onRemove, overId, nowPlayingId, onTogglePlay }) {
  const { setNodeRef, isOver: isOverEmptyZone } = useDroppable({ id: 'ranked-dropzone' });
  return (
    <div ref={setNodeRef} className={`rank-list${isOverEmptyZone && ranked.length === 0 ? ' rank-list-over' : ''}`}>
      <SortableContext items={ranked.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        {ranked.length === 0 && <p className="rank-empty">Drag songs here to rank them.</p>}
        {ranked.map((song, i) => (
          <RankedRow
            key={song.id}
            song={song}
            index={i}
            onRemove={onRemove}
            isOver={overId === song.id}
            nowPlayingId={nowPlayingId}
            onTogglePlay={onTogglePlay}
          />
        ))}
      </SortableContext>
    </div>
  );
}

// Rank-based replacement for the old free-typed 0-1000 rating: drag songs
// from Available into Ranked, top-to-bottom order of preference. On save,
// position becomes score (999, 998, 997...) via PUT /api/ratings — see that
// route for why this needed a bulk endpoint instead of the old per-song one.
export default function RankingModal({ onClose, onSaved }) {
  const [songs, setSongs] = useState(null);
  const [ranked, setRanked] = useState([]);
  const [available, setAvailable] = useState([]);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [nowPlaying, setNowPlaying] = useState(null);

  useEffect(() => {
    fetch('/api/songs?stats=1')
      .then((r) => r.json())
      .then((data) => {
        setSongs(data);
        setRanked(data.filter((s) => s.rating > 0).sort((a, b) => b.rating - a.rating));
        setAvailable(data.filter((s) => s.rating === 0).sort(byTitle));
      });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function rankedIndexOf(id) {
    return ranked.findIndex((s) => s.id === id);
  }

  function handleDragEnd(event) {
    setDraggingId(null);
    setOverId(null);
    const { active, over } = event;
    if (!over) return;

    const isFromRanked = rankedIndexOf(active.id) !== -1;

    // Dropping back on Available cancels the move — whether that's an
    // already-ranked song being sent back out, or a song you were about to
    // add but changed your mind on. Matches the "drag it back where it came
    // from to cancel" convention most sortable-list UIs use.
    if (over.id === 'available-dropzone') {
      if (isFromRanked) {
        const song = ranked.find((s) => s.id === active.id);
        if (song) handleRemove(song);
      }
      return;
    }

    if (isFromRanked) {
      if (over.id === 'ranked-dropzone') return;
      const oldIndex = rankedIndexOf(active.id);
      const newIndex = rankedIndexOf(over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      setRanked((r) => arrayMove(r, oldIndex, newIndex));
      return;
    }

    const song = available.find((s) => s.id === active.id);
    if (!song) return;
    const targetIndex = over.id === 'ranked-dropzone' ? ranked.length : rankedIndexOf(over.id);
    const insertAt = targetIndex === -1 ? ranked.length : targetIndex;

    setAvailable((a) => a.filter((s) => s.id !== active.id));
    setRanked((r) => {
      const next = [...r];
      next.splice(insertAt, 0, song);
      return next;
    });
  }

  function handleRemove(song) {
    setRanked((r) => r.filter((s) => s.id !== song.id));
    setAvailable((a) => [...a, song].sort(byTitle));
  }

  async function handleSave() {
    setSaving(true);
    await fetch('/api/ratings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ranked_song_ids: ranked.map((s) => s.id) }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  if (!songs) {
    return (
      <Modal title="Rank your songs" onClose={onClose}>
        <p>Loading...</p>
      </Modal>
    );
  }

  const filteredAvailable = available.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()));
  const activeSong = songs.find((s) => s.id === draggingId);

  return (
    <Modal title="Rank your songs" onClose={onClose}>
      <p className="song-meta">Drag songs from Available into Ranked, top to bottom in order of preference.</p>
      {nowPlaying && (
        <div className="rank-now-playing">
          <div className="rank-now-playing-header">
            <span>Now playing: {nowPlaying.title}</span>
            <button type="button" onClick={() => setNowPlaying(null)} aria-label="Close video">
              ✕
            </button>
          </div>
          <div className="video-embed">
            <iframe
              src={`https://www.youtube.com/embed/${youtubeVideoId(nowPlaying.youtube_url)}?autoplay=1`}
              title={`${nowPlaying.title} on YouTube`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setDraggingId(e.active.id)}
        onDragOver={(e) => setOverId(e.over?.id !== 'ranked-dropzone' ? (e.over?.id ?? null) : null)}
        onDragEnd={handleDragEnd}
      >
        <div className="rank-columns">
          <div className="rank-column">
            <h3>Ranked ({ranked.length})</h3>
            <RankedColumn
              ranked={ranked}
              onRemove={handleRemove}
              overId={overId}
              nowPlayingId={nowPlaying?.id}
              onTogglePlay={setNowPlaying}
            />
          </div>
          <div className="rank-column">
            <h3>Available ({available.length})</h3>
            <input type="text" placeholder="Filter songs..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <AvailableColumn songs={filteredAvailable} nowPlayingId={nowPlaying?.id} onTogglePlay={setNowPlaying} />
          </div>
        </div>
        <DragOverlay>{activeSong && <div className="rank-row drag-overlay">{activeSong.title}</div>}</DragOverlay>
      </DndContext>
      <div className="actions modal-actions">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
