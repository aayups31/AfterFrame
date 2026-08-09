"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ClosureMode, DirectionType, Investigation, InvestigationBranch } from "@/lib/types";
import { BranchExperience } from "./BranchExperience";
import { CloseInvestigation } from "./CloseInvestigation";
import { DirectionConsole } from "./DirectionConsole";
import { EvidenceWhisper } from "./EvidenceWhisper";
import { NoteComposer } from "./NoteComposer";
import { SoundtrackLine } from "./SoundtrackLine";
import { VisualScriptPreview } from "./VisualScriptPreview";

function inferDirectionType(text: string): DirectionType {
  const value = text.toLowerCase();
  if (value.includes("i think") || value.includes("theory")) return "THEORY";
  if (value.includes("compare")) return "COMPARE";
  if (value.includes("challenge")) return "CHALLENGE";
  if (value.includes("connect")) return "CONNECT";
  if (value.includes("follow")) return "LEAD";
  return "QUESTION";
}

function buildMockBranch(text: string): InvestigationBranch {
  const directionType = inferDirectionType(text);
  const title = directionType === "THEORY" ? "THE PLAN WAS FRAGILE BEFORE IMPACT" : "A NEW LINE OF INQUIRY";

  return {
    id: `branch-${Date.now()}`,
    parentBranchId: "root",
    originText: text,
    title,
    objective:
      directionType === "THEORY"
        ? "Test whether the mission depended on a chain of assumptions that left ordinary failures with no safe place to go."
        : "Follow the user’s direction through film, production, and independent context before returning a conclusion.",
    directionType,
    acknowledgement: "Whoa—let me get in on that.",
    supportState: "RESEARCHING",
    evidenceIds: ["ev-book", "ev-report", "ev-interview"],
    beats: [
      {
        id: "branch-beat-01",
        type: "opening",
        kicker: "THE THEORY",
        body: "The strongest version of this idea is not that failure was inevitable. It is that the plan had almost no capacity to absorb normal friction.",
        evidenceIds: [],
      },
      {
        id: "branch-beat-02",
        type: "evidence",
        kicker: "SUPPORT LANE",
        body: "The source trail points toward several linked dependencies: speed, aircraft availability, route clarity, communication, and a short exposure window.",
        evidenceIds: ["ev-book", "ev-report"],
      },
      {
        id: "branch-beat-03",
        type: "contradiction",
        kicker: "PRESSURE TEST",
        body: "A fragile plan is not the same as a doomed plan. The branch must still explain which failures were foreseeable, which were contingent, and whether later accounts exaggerate the coherence of the warning signs.",
        prompt: "The production system would now run a targeted adversarial search before updating the branch state.",
        evidenceIds: ["ev-interview"],
      },
      {
        id: "branch-beat-04",
        type: "lead",
        kicker: "NEXT RESEARCH PASS",
        body: "Compare operational assumptions, route constraints, and participant accounts without treating repeated retellings as independent evidence.",
        evidenceIds: [],
      },
    ],
  };
}

export function InvestigationExperience({ investigation }: { investigation: Investigation }) {
  const [activeBeat, setActiveBeat] = useState(investigation.beats[0]?.id ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [activeBranch, setActiveBranch] = useState<InvestigationBranch | null>(null);
  const [closureOpen, setClosureOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [closureMode, setClosureMode] = useState<Exclude<ClosureMode, "case_world">>("visual_script");
  const activeIndex = useMemo(
    () => investigation.beats.findIndex((beat) => beat.id === activeBeat),
    [activeBeat, investigation.beats],
  );

  useEffect(() => {
    if (activeBranch || artifactOpen) return;
    const elements = [...document.querySelectorAll<HTMLElement>("[data-beat-id]")];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveBeat((visible.target as HTMLElement).dataset.beatId ?? "");
      },
      { rootMargin: "-34% 0px -48% 0px", threshold: [0.15, 0.4, 0.7] },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [activeBranch, artifactOpen]);

  return (
    <main className="case-shell">
      <header className="case-masthead">
        <Link href="/" className="case-brand">AFTERFRAME</Link>
        <div className="case-identity">
          <span>CASE 001</span>
          <strong>{investigation.film}</strong>
        </div>
        <div className="case-progress" aria-label={`Beat ${activeIndex + 1} of ${investigation.beats.length}`}>
          <span>{activeBranch ? "BR" : String(Math.max(activeIndex + 1, 1)).padStart(2, "0")}</span>
          <i />
          <span>{activeBranch ? "01" : String(investigation.beats.length).padStart(2, "0")}</span>
        </div>
      </header>

      {artifactOpen ? (
        <VisualScriptPreview mode={closureMode} onClose={() => setArtifactOpen(false)} />
      ) : activeBranch ? (
        <BranchExperience branch={activeBranch} evidence={investigation.evidence} onReturn={() => setActiveBranch(null)} />
      ) : (
        <>
          <section className="case-opening">
            <p>CASE INTENT</p>
            <h1>{investigation.intent}</h1>
            <blockquote>“{investigation.curiosity}”</blockquote>
          </section>

          <div className="case-reading-grid">
            <aside className="trail-rail" aria-label="Current trail">
              <span>CURRENT TRAIL</span>
              <strong>{investigation.currentTrail}</strong>
              <button onClick={() => setNoteOpen(true)}>+ NOTE</button>
            </aside>

            <article className="exploration-stream">
              {investigation.beats.map((beat, index) => (
                <section
                  className={`exploration-beat beat-${beat.type}`}
                  data-beat-id={beat.id}
                  key={beat.id}
                >
                  <div className="beat-index">{String(index + 1).padStart(2, "0")}</div>
                  {beat.kicker && <p className="beat-kicker">{beat.kicker}</p>}
                  <div className="beat-body">{beat.body}</div>
                  {beat.prompt && <p className="beat-prompt">{beat.prompt}</p>}
                  {beat.evidenceIds.length > 0 && (
                    <div className="inline-evidence-mobile">
                      {beat.evidenceIds.map((id) => {
                        const evidence = investigation.evidence.find((item) => item.id === id);
                        return evidence ? <EvidenceWhisper evidence={evidence} key={id} /> : null;
                      })}
                    </div>
                  )}
                </section>
              ))}
              <button className="close-investigation-action" onClick={() => setClosureOpen(true)}>
                CLOSE INVESTIGATION <span>↘</span>
              </button>
            </article>

            <aside className="evidence-rail" aria-label="Evidence for active passage">
              <span>EVIDENCE</span>
              {investigation.beats
                .find((beat) => beat.id === activeBeat)
                ?.evidenceIds.map((id) => {
                  const evidence = investigation.evidence.find((item) => item.id === id);
                  return evidence ? <EvidenceWhisper evidence={evidence} key={id} /> : null;
                })}
            </aside>
          </div>
        </>
      )}

      {!artifactOpen && <SoundtrackLine />}
      {!artifactOpen && (
        <DirectionConsole caseId={investigation.id} onDirection={(text) => setActiveBranch(buildMockBranch(text))} />
      )}
      <NoteComposer open={noteOpen} onClose={() => setNoteOpen(false)} activeBeatId={activeBeat} />
      <CloseInvestigation
        open={closureOpen}
        onClose={() => setClosureOpen(false)}
        onCreate={(mode) => {
          setClosureOpen(false);
          if (mode === "case_world") return;
          setClosureMode(mode);
          setArtifactOpen(true);
        }}
      />
    </main>
  );
}
