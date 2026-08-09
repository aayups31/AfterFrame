import { createHash } from "node:crypto";
import type { SubmitDirectionCommand } from "@/contracts/directions";
import type { DirectionFingerprintPort } from "@/application/submit-direction";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Hashes the exact private input into a one-way operational fingerprint. Raw
 * direction or selected text must never be copied into idempotency records.
 */
export class Sha256DirectionFingerprint implements DirectionFingerprintPort {
  fingerprintCommand(actorId: string, command: SubmitDirectionCommand): string {
    return sha256(
      JSON.stringify({
        actorId,
        caseId: command.caseId,
        expectedCaseVersion: command.expectedCaseVersion,
        sourceBranchId: command.sourceBranchId,
        userText: command.userText,
        anchor:
          command.anchor === null
            ? null
            : {
                beatId: command.anchor.beatId ?? null,
                evidenceId: command.anchor.evidenceId ?? null,
                selectedText: command.anchor.selectedText ?? null,
              },
        requestedAction: command.requestedAction,
      }),
    );
  }

  fingerprintExactText(text: string): string {
    return sha256(text);
  }
}
