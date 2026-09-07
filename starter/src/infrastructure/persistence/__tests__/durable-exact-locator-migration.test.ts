import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/017_durable_exact_locator_verification.sql", import.meta.url)),
  "utf8",
);

describe("migration 017 durable exact locator verification", () => {
  it("stores text-free exact targets without granting evidence authority", () => {
    expect(migration).toContain("target_block_ordinal");
    expect(migration).toContain("pageTextFingerprint");
    expect(migration).toContain("sourceRangeFingerprint");
    expect(migration).toContain("evidence_status text not null check (evidence_status = 'NOT_EVIDENCE')");
    expect(migration).not.toContain("source_excerpt");
    expect(migration).not.toContain("normalized_text text");
  });

  it("accepts only authoritative normalization fingerprints under an active lease", () => {
    expect(migration).toContain("af_research_lease_cursor_matches");
    expect(migration).toContain("af_source_normalization_records");
    expect(migration).toContain("af_pdf_normalization_records");
    expect(migration).toContain("screeningState}'<>'PASSED'");
    expect(migration).toContain("blockManifests");
  });

  it("creates a superseding source locator revision atomically", () => {
    expect(migration).toContain("insert into public.af_source_locators");
    expect(migration).toContain("previous_locator.revision+1");
    expect(migration).toContain("supersedes_locator_id");
    expect(migration).toContain("#page=");
  });

  it("fences idempotency by normalization target and defaults the ledger to deny", () => {
    expect(migration).toContain("normalization_record_id,target_block_ordinal");
    expect(migration).toContain("stored_record.record_json is distinct from p_record");
    expect(migration).toContain("alter table public.af_exact_locator_verification_records force row level security");
    expect(migration).toContain("perform public.af_assert_actor_scope(p_actor_id)");
  });
});
