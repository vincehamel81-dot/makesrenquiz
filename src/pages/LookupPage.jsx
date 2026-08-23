import { useState } from 'react';

export default function LookupPage() {
  const [word, setWord] = useState('');
  const [results, setResults] = useState(null);

  async function search(e) {
    e.preventDefault();
    if (!word.trim()) return;
    const res = await fetch(`/api/lookup?word=${encodeURIComponent(word.trim())}`);
    setResults(await res.json());
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
    </div>
  );
}
