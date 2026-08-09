"use client";

import { useState } from "react";

const kinds = ["THOUGHT", "STICKY", "QUESTION", "CLAIM", "CONNECTION", "FLOW STEP"];

export function NoteComposer({
  open,
  onClose,
  activeBeatId,
}: {
  open: boolean;
  onClose: () => void;
  activeBeatId: string;
}) {
  const [kind, setKind] = useState("THOUGHT");
  const [body, setBody] = useState("");

  const closeComposer = () => {
    setBody("");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="note-layer" role="dialog" aria-modal="true" aria-label="Create a note">
      <button className="note-backdrop" onClick={closeComposer} aria-label="Close note composer" />
      <section className="note-composer">
        <header>
          <span>NEW NOTE · {activeBeatId}</span>
          <button onClick={closeComposer}>CLOSE</button>
        </header>
        <nav aria-label="Note type">
          {kinds.map((item) => (
            <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>
              {item}
            </button>
          ))}
        </nav>
        <textarea
          autoFocus
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What does this change?"
        />
        <footer>
          <span>Anchored to the active passage</span>
          <button onClick={closeComposer}>PLACE NOTE ↗</button>
        </footer>
      </section>
    </div>
  );
}
