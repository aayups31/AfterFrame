import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/016_durable_pdf_normalization_acceptance.sql", import.meta.url)),
  "utf8",
);

describe("migration 016 durable PDF normalization acceptance", () => {
  it("stores text-free page/object/item manifests without fabricated byte anchors", () => {
    expect(migration).toContain("page_manifest jsonb");
    expect(migration).toContain("af_pdf_text_anchor_valid_v1");
    expect(migration).toContain("'pageNumber','pageObject','itemStart','itemEnd','boundingBox'");
    expect(migration).not.toContain("normalized_text text");
    expect(migration).not.toContain("sourceByteStart");
    expect(migration).not.toContain("raw_pdf");
  });

  it("independently validates complete pages, blocks, signals, and total length", () => {
    expect(migration).toContain("page_total <> (receipt_json->>'pageCount')::integer");
    expect(migration).toContain("pageTextFingerprint");
    expect(migration).toContain("length_total := length_total +");
    expect(migration).toContain("af_pdf_hostile_signal_valid_v1");
  });

  it("requires retrieval lineage, active lease authority, and exact replay", () => {
    expect(migration).toContain("references public.af_source_retrieval_records(id)");
    expect(migration).toContain("af_research_lease_cursor_matches");
    expect(migration).toContain("not attempt_row.private_content_included");
    expect(migration).toContain("stored_record.record_json is distinct from p_record");
    expect(migration).toContain("'status','REPLAY'");
  });

  it("keeps PDF output untrusted and the ledger default-deny", () => {
    expect(migration).toContain("instruction_authority text not null check (instruction_authority = 'NONE')");
    expect(migration).toContain("evidence_status text not null check (evidence_status = 'NOT_EVIDENCE')");
    expect(migration).toContain("alter table public.af_pdf_normalization_records force row level security");
    expect(migration).toContain("perform public.af_assert_actor_scope(p_actor_id)");
  });
});
