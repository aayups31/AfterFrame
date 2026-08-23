import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/011_terminal_provider_acceptance.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("terminal provider acceptance migration", () => {
  it("admits every provider state that may be observed synchronously", () => {
    for (const state of [
      "QUEUED",
      "IN_PROGRESS",
      "COMPLETED",
      "FAILED",
      "INCOMPLETE",
      "CANCELLED",
    ]) {
      expect(migration).toContain(`'${state}'`);
    }
    expect(migration).toContain(
      "add constraint af_provider_runs_state_check check",
    );
    expect(migration).toContain(
      "create or replace function public.af_research_provider_run_record_valid_v1(",
    );
  });

  it("changes only state validation and retains a body-free boundary", () => {
    expect(migration).not.toMatch(
      /(?:question|prompt|source|response|provider)_(?:body|excerpt|message|text)\s/i,
    );
    expect(migration).not.toMatch(/drop\s+(?:table|column)|truncate\s+/i);
    expect(migration).not.toMatch(/grant\s+/i);
    expect(migration).toContain(
      "value_to_check->'privateContentIncluded' = 'true'::jsonb",
    );
    expect(migration).toContain(
      "value_to_check->>'publicationAuthority' = 'NONE'",
    );
  });
});
