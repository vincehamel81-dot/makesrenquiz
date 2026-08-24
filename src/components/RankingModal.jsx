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

function byTitle(a, b) {
  return a.title.localeCompare(b.title);
}

function RankedRow({ song, index, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="rank-row" {...attributes} {...listeners}>
      <span className="rank-position">{index + 1}</span>
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

function AvailableRow({ song }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: song.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="avail-row" {...attributes} {...listeners}>
      {song.title}
    </div>
  );
}

function RankedColumn({ ranked, onRemove }) {
  const { setNodeRef } = useDroppable({ id: 'ranked-dropzone' });
  return (
    <div ref={setNodeRef} className="rank-list">
      <SortableContext items={ranked.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        {ranked.length === 0 && <p className="rank-empty">Drag songs here to rank them.</p>}
        {ranked.map((song, i) => (
          <RankedRow key={song.id} song={song} index={i} onRemove={onRemove} />
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
    const { active, over } = event;
    if (!over) return;

    const isFromRanked = rankedIndexOf(active.id) !== -1;

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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setDraggingId(e.active.id)}
        onDragEnd={handleDragEnd}
      >
        <div className="rank-columns">
          <div className="rank-column">
            <h3>Ranked ({ranked.length})</h3>
            <RankedColumn ranked={ranked} onRemove={handleRemove} />
          </div>
          <div className="rank-column">
            <h3>Available ({available.length})</h3>
            <input type="text" placeholder="Filter songs..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="avail-list">
              {filteredAvailable.map((song) => (
                <AvailableRow key={song.id} song={song} />
              ))}
            </div>
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
