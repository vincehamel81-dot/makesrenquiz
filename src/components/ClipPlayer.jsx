import { useEffect, useRef, useState } from 'react';

// Plays only the first `durationSec` seconds of the underlying audio file,
// with no seek bar exposed — the file itself may be longer (sliced generously
// at build time) so difficulty can be tuned via calibration without re-encoding.
export default function ClipPlayer({ src, durationSec }) {
  const audioRef = useRef(null);
  const timeoutRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  function play() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play();
    setPlaying(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      audio.pause();
      setPlaying(false);
    }, durationSec * 1000);
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    clearTimeout(timeoutRef.current);
    audio.pause();
    setPlaying(false);
  }

  return (
    <div className="clip-player">
      <audio ref={audioRef} src={src} preload="auto" onEnded={() => setPlaying(false)} />
      {playing ? (
        <button onClick={stop}>■ Stop</button>
      ) : (
        <button onClick={play}>▶ Play clip ({durationSec}s)</button>
      )}
    </div>
  );
}
