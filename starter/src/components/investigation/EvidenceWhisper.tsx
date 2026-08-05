"use client";

import { useState } from "react";
import type { Evidence } from "@/lib/types";

export function EvidenceWhisper({ evidence }: { evidence: Evidence }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`evidence-whisper ${open ? "is-open" : ""}`}>
      <button onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{evidence.index}</span>
        <span>{evidence.shortLabel}</span>
      </button>
      {open && (
        <div className="evidence-detail">
          <p>{evidence.whySurfaced}</p>
          <dl>
            <div><dt>TYPE</dt><dd>{evidence.type}</dd></div>
            <div><dt>LOCATOR</dt><dd>{evidence.locator}</dd></div>
            <div><dt>STATE</dt><dd>{evidence.status}</dd></div>
          </dl>
          <a href={evidence.url} target="_blank" rel="noreferrer">
            OPEN ORIGINAL ↗
          </a>
        </div>
      )}
    </div>
  );
}
