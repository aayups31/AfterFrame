"use client";

import { useState } from "react";

export function SoundtrackLine() {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="soundtrack-line">
      <button onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>
        {playing ? "PAUSE" : "PLAY"}
      </button>
      <span>INVESTIGATION PLAYLIST</span>
      <i className={playing ? "is-playing" : ""} />
      <span>YOUR AMBIENT SET · 01</span>
    </div>
  );
}
