"use client";

import { useState } from "react";
import type { ClosureMode } from "@/lib/types";

const outputs: ReadonlyArray<readonly [ClosureMode, string]> = [
  ["visual_script", "VISUAL DOCUMENTARY SCRIPT"],
  ["research_dossier", "RESEARCH DOSSIER"],
  ["outline", "VIDEO / ESSAY OUTLINE"],
  ["director_brief", "DIRECTOR / WRITER BRIEF"],
  ["case_world", "CLOSE AS CASE WORLD"],
] as const;

export function CloseInvestigation({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (mode: ClosureMode) => void;
}) {
  const [mode, setMode] = useState<ClosureMode>("visual_script");
  if (!open) return null;

  return (
    <div className="closure-layer" role="dialog" aria-modal="true" aria-labelledby="closure-title">
      <button className="note-backdrop" onClick={onClose} aria-label="Close investigation review" />
      <section className="closure-panel">
        <header>
          <span>CLOSURE REVIEW</span>
          <button onClick={onClose}>KEEP OPEN</button>
        </header>
        <h2 id="closure-title">Tie everything together?</h2>
        <div className="closure-audit">
          <p><strong>03</strong><span>UNRESOLVED BRANCHES</span></p>
          <p><strong>02</strong><span>MATERIAL CONTRADICTIONS</span></p>
          <p><strong>07</strong><span>USER NOTES NOT YET USED</span></p>
          <p><strong>01</strong><span>LOCATOR STILL APPROXIMATE</span></p>
        </div>
        <p className="closure-copy">Closing creates a versioned milestone. You can reopen the case, keep creating manually, or ask the investigator to assemble a sourced first structure.</p>
        <div className="closure-options">
          {outputs.map(([value, label]) => (
            <button key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{label}</button>
          ))}
        </div>
        <footer>
          <button onClick={onClose}>RETURN TO INVESTIGATION</button>
          <button onClick={() => onCreate(mode)}>CREATE CLOSURE ↗</button>
        </footer>
      </section>
    </div>
  );
}
