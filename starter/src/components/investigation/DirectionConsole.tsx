"use client";

import { FormEvent, useState } from "react";

export function DirectionConsole({
  caseId,
  onDirection,
}: {
  caseId: string;
  onDirection: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setAcknowledgement("Whoa—let me get in on that.");
    onDirection(value);
    setText("");
    window.setTimeout(() => {
      setAcknowledgement("");
      setOpen(false);
    }, 1600);
  }

  return (
    <section className={`direction-console ${open ? "is-open" : ""}`} aria-label="Direct the investigator">
      <button className="dock-toggle" onClick={() => setOpen((value) => !value)}>
        <span>INVESTIGATOR</span>
        <span>{open ? "CLOSE" : "GIVE A DIRECTION"}</span>
      </button>
      {open && (
        <div className="dock-body">
          {acknowledgement ? (
            <p className="direction-ack" role="status">{acknowledgement}</p>
          ) : (
            <form onSubmit={submit}>
              <label htmlFor={`direction-${caseId}`}>Give a theory, idea, lead, question, or change of direction.</label>
              <textarea
                id={`direction-${caseId}`}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="I think the mission was already fragile before the first helicopter went down…"
              />
              <div className="dock-modes" aria-label="Direction shortcuts">
                <button type="button" onClick={() => setText((value) => `Challenge this: ${value}`.trim())}>CHALLENGE</button>
                <button type="button" onClick={() => setText((value) => `Compare this: ${value}`.trim())}>COMPARE</button>
                <button type="button" onClick={() => setText((value) => `Follow this: ${value}`.trim())}>FOLLOW</button>
                <button type="submit">OPEN BRANCH ↗</button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
