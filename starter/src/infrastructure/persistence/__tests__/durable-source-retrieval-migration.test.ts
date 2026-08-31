import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/014_durable_source_retrieval_acceptance.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("migration 014 durable source retrieval acceptance", () => {
  it("moves hostile content provenance from attempt-local to run/candidate identity", () => {
    expect(migration).toContain(
      "foreign key (run_id, candidate_id)\n  references public.af_source_candidates(run_id, id)",
    );
    expect(migration).not.toContain(
      "foreign key (run_id, job_id, attempt_id, candidate_id)\n    references public.af_source_candidates",
    );
  });

  it("requires active NORMALIZATION lease authority and private-content telemetry", () => {
    expect(migration).toContain("job_row.stage <> 'NORMALIZATION'");
    expect(migration).toContain("not attempt_row.private_content_included");
    expect(migration).toContain("af_research_lease_cursor_matches");
    expect(migration).toContain("lease_row.lease_expires_at <= observed_at");
  });

  it("makes link-only bytes transient and retains zero instruction/publication authority", () => {
    expect(migration).toContain("receipt_json->>'retention' = 'TRANSIENT_ONLY'");
    expect(migration).toContain("receipt_json->'storageRef' = 'null'::jsonb");
    expect(migration).toContain(
      "trust_boundary text not null check (trust_boundary = 'UNTRUSTED_SOURCE_DATA')",
    );
    expect(migration).toContain(
      "instruction_authority text not null check (instruction_authority = 'NONE')",
    );
    expect(migration).toContain(
      "publication_authority text not null check (publication_authority = 'NONE')",
    );
  });

  it("uses advisory serialization, immutable fingerprint identity, and exact replay", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain(
      "Content fingerprint already identifies another snapshot",
    );
    expect(migration).toContain(
      "stored_retrieval.record_json is distinct from p_record",
    );
    expect(migration).toContain("'status', 'REPLAY'");
  });

  it("keeps the new table default-deny and exposes only actor-scoped RPCs", () => {
    expect(migration).toContain(
      "alter table public.af_source_retrieval_records force row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.af_source_retrieval_records\n  from public, anon, authenticated",
    );
    expect(migration).toContain("perform public.af_assert_actor_scope(p_actor_id)");
    expect(migration).toContain(
      "grant execute on function public.af_accept_source_retrieval_v1",
    );
  });
});
