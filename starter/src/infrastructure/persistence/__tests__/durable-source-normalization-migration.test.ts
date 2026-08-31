import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/015_durable_source_normalization_acceptance.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("migration 015 durable source normalization acceptance", () => {
  it("stores text-free manifests and forbids evidence or instruction authority", () => {
    expect(migration).toContain("block_manifest jsonb");
    expect(migration).toContain("hostile_signals jsonb");
    expect(migration).toContain(
      "instruction_authority text not null check (instruction_authority = 'NONE')",
    );
    expect(migration).toContain(
      "evidence_status text not null check (evidence_status = 'NOT_EVIDENCE')",
    );
    expect(migration).not.toContain("normalized_text text");
    expect(migration).not.toContain("source_body");
    expect(migration).not.toContain("raw_html");
  });

  it("independently validates exact block and hostile-signal manifests", () => {
    expect(migration).toContain("af_jsonb_has_exact_keys");
    expect(migration).toContain("af_normalized_block_manifest_valid_v1");
    expect(migration).toContain("af_hostile_signal_manifest_valid_v1");
    expect(migration).toContain("text_length_sum");
    expect(migration).toContain("sourceByteEnd");
  });

  it("requires retrieval lineage, active lease authority, and exact replay", () => {
    expect(migration).toContain("references public.af_source_retrieval_records(id)");
    expect(migration).toContain("af_research_lease_cursor_matches");
    expect(migration).toContain("not attempt_row.private_content_included");
    expect(migration).toContain(
      "stored_normalization.record_json is distinct from p_record",
    );
    expect(migration).toContain("'status', 'REPLAY'");
  });

  it("enforces transient link-only and quarantined output", () => {
    expect(migration).toContain("receipt_json->>'rightsState' <> 'LINK_ONLY'");
    expect(migration).toContain("receipt_json->>'screeningState' <> 'QUARANTINED'");
    expect(migration).toContain("receipt_json->'storageRef' = 'null'::jsonb");
  });

  it("keeps the ledger default-deny behind actor-scoped RPCs", () => {
    expect(migration).toContain(
      "alter table public.af_source_normalization_records force row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.af_source_normalization_records\n  from public, anon, authenticated",
    );
    expect(migration).toContain("perform public.af_assert_actor_scope(p_actor_id)");
    expect(migration).toContain(
      "grant execute on function public.af_accept_source_normalization_v1",
    );
  });
});
