"use client";

import type { ClosureMode, VisualScriptBlock } from "@/lib/types";

const blocks: VisualScriptBlock[] = [
  {
    id: "vs-01",
    sequence: "01",
    purpose: "Establish the promise of speed",
    narration: "The plan was protected by one assumption: the city would not have enough time to reorganize around the raid.",
    visualDirection: "Minimal map animation. Compress the intended route into one clean movement before introducing friction.",
    sourceLabels: ["Bowden · ch. 3", "After-action record"],
    caveat: "Exact book pages remain edition-dependent in this mock.",
  },
  {
    id: "vs-02",
    sequence: "02",
    purpose: "Reveal the dependency chain",
    narration: "Speed was not one advantage. It was a stack of dependencies that all had to stay true together.",
    visualDirection: "Build a thin-line dependency flow from insertion to extraction. No node cards.",
    sourceLabels: ["After-action record", "Participant oral history"],
  },
  {
    id: "vs-03",
    sequence: "03",
    purpose: "Introduce the theory branch",
    narration: "The mission may have been fragile before the first helicopter was lost—not because failure was certain, but because ordinary failures had nowhere to go.",
    visualDirection: "Return to the route map. Let each dependency recede as the branch thesis appears.",
    sourceLabels: ["User theory branch", "Claim graph"],
    caveat: "Interpretation; preserve counterevidence in the next sequence.",
  },
];

const labels: Record<Exclude<ClosureMode, "case_world">, string> = {
  visual_script: "VISUAL SCRIPT",
  research_dossier: "RESEARCH DOSSIER",
  outline: "VIDEO / ESSAY OUTLINE",
  director_brief: "DIRECTOR / WRITER BRIEF",
  evidence_appendix: "EVIDENCE APPENDIX",
};

export function VisualScriptPreview({
  mode,
  onClose,
}: {
  mode: Exclude<ClosureMode, "case_world">;
  onClose: () => void;
}) {
  return (
    <section className="visual-script" aria-labelledby="visual-script-title">
      <header>
        <div>
          <span>CLOSURE 01 · {labels[mode]}</span>
          <h2 id="visual-script-title">WHY THE PLAN HAD NO ROOM TO BEND</h2>
        </div>
        <button onClick={onClose}>BACK TO CASE</button>
      </header>
      <p className="visual-script-intro">This is an editable structural mock. Every block keeps its source and theory origins attached.</p>
      {blocks.map((block) => (
        <article key={block.id} className="script-block">
          <span className="script-sequence">{block.sequence}</span>
          <div>
            <p className="script-purpose">{block.purpose}</p>
            <h3>{block.narration}</h3>
            <p><strong>VISUAL</strong> {block.visualDirection}</p>
            <p><strong>SOURCES</strong> {block.sourceLabels.join(" · ")}</p>
            {block.caveat && <p><strong>CAVEAT</strong> {block.caveat}</p>}
          </div>
        </article>
      ))}
    </section>
  );
}
