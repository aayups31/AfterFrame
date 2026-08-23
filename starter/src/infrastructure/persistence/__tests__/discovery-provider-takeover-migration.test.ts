import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/010_discovery_provider_takeover_reader.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("discovery provider takeover migration", () => {
  it("returns recovery only for an actor-owned active DISCOVERY attempt", () => {
    expect(migration).toContain(
      "create function public.af_get_research_provider_run_v1(",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("perform public.af_assert_actor_scope(p_actor_id)");
    expect(migration).toContain("stored_case.owner_id = p_actor_id");
    expect(migration).toContain("stored_job.stage = 'DISCOVERY'");
    expect(migration).toContain("stored_job.status = 'RUNNING'");
    expect(migration).toContain(
      "stored_job.active_attempt_id = stored_attempt.id",
    );
    expect(migration).toContain("stored_attempt.status = 'RUNNING'");
  });

  it("requires the exact durable provider-accepted checkpoint", () => {
    expect(migration).toContain(
      "stored_checkpoint.kind = 'PROVIDER_ACCEPTED'",
    );
    expect(migration).toContain(
      "stored_checkpoint.provider_run_id = provider_row.provider_response_id",
    );
    expect(migration).toContain(
      "Accepted provider recovery state lacks its durable checkpoint",
    );
    expect(migration).toContain(
      "public.af_research_provider_run_record_json_v1(provider_row)",
    );
  });

  it("is service-only, body-free, and additive", () => {
    expect(migration).toMatch(
      /revoke all on function public\.af_get_research_provider_run_v1\([\s\S]*?from public, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.af_get_research_provider_run_v1\([\s\S]*?to service_role;/,
    );
    expect(migration).not.toMatch(/to authenticated/);
    expect(migration).not.toMatch(
      /(?:question|prompt|source|response|provider)_(?:body|excerpt|message|text)\s/i,
    );
    expect(migration).not.toMatch(/drop\s+|truncate\s+/i);
  });
});
