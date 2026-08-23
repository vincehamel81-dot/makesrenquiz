import { useEffect, useMemo, useRef, useState } from 'react';
import { normalize } from '../lib/normalize';

export default function SongAutocomplete({ songTitles, value, onChange, onSubmit, disabled, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef(null);

  const matches = useMemo(() => {
    const q = normalize(value);
    if (!q) return [];
    return songTitles.filter((t) => normalize(t).startsWith(q)).slice(0, 8);
  }, [value, songTitles]);

  useEffect(() => setHighlight(0), [value]);

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function selectMatch(title) {
    onChange(title);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      if (open && matches[highlight]) {
        e.preventDefault();
        selectMatch(matches[highlight]);
      } else {
        onSubmit?.();
      }
      return;
    }
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="autocomplete" ref={containerRef}>
      <input
        type="text"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder="Type a song title..."
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <ul className="autocomplete-list">
          {matches.map((title, i) => (
            <li
              key={title}
              className={i === highlight ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                selectMatch(title);
              }}
            >
              {title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
