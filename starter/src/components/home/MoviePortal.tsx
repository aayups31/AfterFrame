"use client";

import { FormEvent, PointerEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const films = [
  "BLACK HAWK DOWN",
  "HEREDITARY",
  "TROY",
  "THE ODYSSEY",
  "INTERSTELLAR",
  "THE CONJURING",
  "ZODIAC",
  "OPPENHEIMER",
];

export function MoviePortal() {
  const router = useRouter();
  const [film, setFilm] = useState("BLACK HAWK DOWN");
  const [stage, setStage] = useState<"select" | "curiosity">("select");
  const [curiosity, setCuriosity] = useState("");

  const orbit = useMemo(() => [...films, ...films], []);

  function handlePointer(event: PointerEvent<HTMLElement>) {
    const x = event.clientX / window.innerWidth - 0.5;
    const y = event.clientY / window.innerHeight - 0.5;
    event.currentTarget.style.setProperty("--pointer-x", `${x}`);
    event.currentTarget.style.setProperty("--pointer-y", `${y}`);
  }

  function openCase(event: FormEvent) {
    event.preventDefault();
    const query = encodeURIComponent(
      curiosity.trim() || "I want to understand why everything went wrong.",
    );
    router.push(`/case/black-hawk-down?curiosity=${query}`);
  }

  return (
    <main className="portal" onPointerMove={handlePointer}>
      <div className="portal-noise" aria-hidden="true" />
      <div className="portal-orbit" aria-hidden="true">
        {orbit.map((title, index) => (
          <span key={`${title}-${index}`}>{title}</span>
        ))}
      </div>

      <header className="portal-brand">
        <span>AFTERFRAME</span>
        <span>AN INVESTIGATION ENGINE</span>
      </header>

      {stage === "select" ? (
        <section className="portal-stage" aria-labelledby="portal-title">
          <p className="eyebrow">THE FILM ENDS.</p>
          <h1 id="portal-title">THE WORLD OPENS.</h1>
          <p className="portal-intro">Choose the film that left a question behind.</p>

          <label className="film-line">
            <span className="sr-only">Choose a film</span>
            <select value={film} onChange={(event) => setFilm(event.target.value)}>
              {films.map((title) => (
                <option value={title} key={title}>
                  {title}
                </option>
              ))}
            </select>
          </label>

          <button className="text-action" onClick={() => setStage("curiosity")}>
            ENTER <span aria-hidden="true">↘</span>
          </button>
        </section>
      ) : (
        <section className="portal-stage portal-curiosity" aria-labelledby="curiosity-title">
          <p className="eyebrow">{film}</p>
          <h1 id="curiosity-title">WHAT STAYED WITH YOU?</h1>
          <form onSubmit={openCase}>
            <textarea
              autoFocus
              value={curiosity}
              onChange={(event) => setCuriosity(event.target.value)}
              placeholder="I want to understand why everything went wrong…"
              aria-label="Describe what made you curious"
            />
            <div className="curiosity-actions">
              <button type="button" className="text-action quiet" onClick={() => setStage("select")}>
                BACK
              </button>
              <button type="submit" className="text-action">
                OPEN THE CASE <span aria-hidden="true">↘</span>
              </button>
            </div>
          </form>
        </section>
      )}

      <footer className="portal-footer">
        <span>FILM · EVIDENCE · CURIOSITY</span>
        <span>SCROLL / TYPE / CONNECT</span>
      </footer>
    </main>
  );
}
