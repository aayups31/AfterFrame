import { createHash } from "node:crypto";
import type { ResearchRunFingerprintPort } from "@/core/research-runs/ports";
import { Sha256Schema } from "@/core/shared/schemas";

type JsonPrimitive = string | number | boolean | null;
type CanonicalValue =
  | JsonPrimitive
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function canonicalize(value: unknown, seen: Set<object>): CanonicalValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Fingerprint input numbers must be finite");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Fingerprint inputs must be JSON-compatible values");
  }
  if (seen.has(value)) {
    throw new TypeError("Fingerprint inputs cannot contain cycles");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalize(item, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Fingerprint objects must be plain records");
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key], seen),
        ]),
    );
  } finally {
    seen.delete(value);
  }
}

function fingerprint(purpose: string, value: unknown) {
  const canonical = JSON.stringify(canonicalize(value, new Set()));
  return Sha256Schema.parse(
    createHash("sha256")
      .update(`afterframe:${purpose}:v1\0`, "utf8")
      .update(canonical, "utf8")
      .digest("hex"),
  );
}

/**
 * Body-free SHA-256 fingerprints with domain separation and canonical object
 * ordering. Arrays and exact strings retain their order/bytes; no private body
 * is returned or logged by this adapter.
 */
export class Sha256ResearchRunFingerprintAdapter
  implements ResearchRunFingerprintPort
{
  fingerprintStartRequest(
    actorId: string,
    input: Readonly<{
      caseId: string;
      branchId: string | null;
      expectedCaseVersion: number;
      idempotencyKey: string;
    }>,
  ) {
    return fingerprint("research-start-request", { actorId, ...input });
  }

  fingerprintObjective(exactObjective: string) {
    return fingerprint("research-objective", exactObjective);
  }

  fingerprintPlan(plan: unknown) {
    return fingerprint("research-plan", plan);
  }

  fingerprintStageInput(input: Readonly<{
    runId: string;
    stage: string;
    objectiveFingerprint: string;
    planFingerprint: string;
  }>) {
    return fingerprint("research-stage-input", input);
  }

  fingerprintAttemptRequest(
    runId: string,
    jobId: string,
    idempotencyKey: string,
  ) {
    return fingerprint("research-attempt-request", {
      runId,
      jobId,
      idempotencyKey,
    });
  }

  fingerprintExecutionOutput(output: unknown) {
    return fingerprint("research-execution-output", output);
  }
}
