"use client";

import type { Evidence, InvestigationBranch } from "@/lib/types";
import { EvidenceWhisper } from "./EvidenceWhisper";

export function BranchExperience({
  branch,
  evidence,
  onReturn,
}: {
  branch: InvestigationBranch;
  evidence: Evidence[];
  onReturn: () => void;
}) {
  return (
    <section className="branch-experience" aria-labelledby="branch-title">
      <div className="branch-origin">
        <span>BRANCH ORIGIN · {branch.directionType}</span>
        <blockquote>“{branch.originText}”</blockquote>
      </div>
      <header className="branch-heading">
        <div>
          <span>CURRENT BRANCH</span>
          <h2 id="branch-title">{branch.title}</h2>
          <p>{branch.objective}</p>
        </div>
        <div className="branch-state">
          <span>STATE</span>
          <strong>{branch.supportState}</strong>
        </div>
      </header>

      <div className="branch-beats">
        {branch.beats.map((beat, index) => (
          <section className={`exploration-beat beat-${beat.type}`} key={beat.id}>
            <div className="beat-index">B{String(index + 1).padStart(2, "0")}</div>
            {beat.kicker && <p className="beat-kicker">{beat.kicker}</p>}
            <div className="beat-body">{beat.body}</div>
            {beat.prompt && <p className="beat-prompt">{beat.prompt}</p>}
            {beat.evidenceIds.length > 0 && (
              <div className="branch-evidence">
                {beat.evidenceIds.map((id) => {
                  const item = evidence.find((candidate) => candidate.id === id);
                  return item ? <EvidenceWhisper evidence={item} key={id} /> : null;
                })}
              </div>
            )}
          </section>
        ))}
      </div>

      <button className="branch-return" onClick={onReturn}>RETURN TO THE FAILURE CASCADE ↖</button>
    </section>
  );
}
