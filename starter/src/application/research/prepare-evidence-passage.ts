import type { ExactLocatorVerifier, ExactLocatorVerificationRecordReader } from "@/application/research/exact-locator-verification-port";
import type { PdfDocumentExtractor, DurablePdfNormalizationRecordReader } from "@/application/research/pdf-normalization-port";
import type { DurableNormalizationRetrievalContextReader } from "@/application/research/source-retrieval-port";
import type { SourceDocumentNormalizer, DurableSourceNormalizationRecordReader } from "@/application/research/source-normalization-port";
import {
  EvidencePassageReceiptSchema, EvidencePassageTelemetrySchema,
  PrepareEvidencePassageCommandSchema,
  type EvidencePassageFailureCode, type PrepareEvidencePassageResult,
} from "@/core/research/evidence-passage";
import { StoredExactLocatorVerificationRecordSchema } from "@/core/research/exact-locator-verification";
import { StoredPdfNormalizationRecordSchema } from "@/core/research/pdf-normalization";
import { DurableNormalizationRetrievalContextSchema } from "@/core/research/source-retrieval";
import { StoredSourceNormalizationRecordSchema } from "@/core/research/source-normalization";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "@/core/shared/schemas";

type Dependencies = Readonly<{
  actorId: string;
  contextReader: DurableNormalizationRetrievalContextReader;
  locatorReader: ExactLocatorVerificationRecordReader;
  webReader: DurableSourceNormalizationRecordReader;
  pdfReader: DurablePdfNormalizationRecordReader;
  webNormalizer: SourceDocumentNormalizer;
  pdfExtractor: PdfDocumentExtractor;
  verifier: ExactLocatorVerifier;
  fingerprint(value: string | Uint8Array): string;
  now(): string;
  monotonicNow(): number;
}>;

class PassageFailure extends Error {
  constructor(readonly code: EvidencePassageFailureCode) { super(code); }
}

function requireCondition(condition: boolean, code: EvidencePassageFailureCode): asserts condition {
  if (!condition) throw new PassageFailure(code);
}

// Key ordering is irrelevant; all fields and array positions remain authoritative.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function splitsSurrogate(text: string, index: number) {
  return index > 0 && index < text.length &&
    /[\uD800-\uDBFF]/.test(text[index - 1]!) && /[\uDC00-\uDFFF]/.test(text[index]!);
}

/** Discard late reads/parser results immediately on cancellation. The existing
 * adapters remain responsible for their own IO/resource deadlines. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new PassageFailure("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { signal.removeEventListener("abort", abort); abort(); }
    operation.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

/** Server-only use. Actor comes from authenticated composition, never model output.
 * Reads accepted records; returns ephemeral source text, never an accepted fact.
 * Repeating a command has no database mutation or model/provider cost.
 */
export function createPrepareEvidencePassageService(dependencies: Dependencies) {
  const actorId = EntityIdSchema.parse(dependencies.actorId);
  return async (commandInput: unknown, body: Uint8Array, signal: AbortSignal): Promise<PrepareEvidencePassageResult> => {
    const startedAt = dependencies.monotonicNow();
    const telemetry = (outcome: "PREPARED" | "UNAVAILABLE", code: EvidencePassageFailureCode | null) =>
      EvidencePassageTelemetrySchema.parse({
        operation: "prepare-evidence-passage", version: "1.0.0", outcome, code,
        latencyMs: Math.max(0, dependencies.monotonicNow() - startedAt),
        model: null, modelCalls: 0, providerCostUsd: 0, privateContentIncluded: false,
      });
    const checkCancelled = () => requireCondition(!signal.aborted, "cancelled");
    try {
      checkCancelled();
      const commandResult = PrepareEvidencePassageCommandSchema.safeParse(commandInput);
      requireCondition(commandResult.success && body instanceof Uint8Array, "invalid-contract");
      const command = commandResult.data;
      const scope = { actorId, runId: command.runId, jobId: command.jobId, attemptId: command.attemptId };
      const matchesScope = (record: { caseId: string; runId: string; jobId: string; attemptId: string; manifestFingerprint: string }) =>
        record.caseId === command.caseId && record.runId === command.runId &&
        record.jobId === command.jobId && record.attemptId === command.attemptId &&
        record.manifestFingerprint === command.manifestFingerprint;
      const contextResult = DurableNormalizationRetrievalContextSchema.safeParse(
        await abortable(dependencies.contextReader.getNormalizationRetrievalContext(scope), signal));
      checkCancelled();
      requireCondition(contextResult.success, "context-unavailable");
      const context = contextResult.data;
      requireCondition(matchesScope(context), "lineage-mismatch");
      const verifications = await abortable(dependencies.locatorReader.listAcceptedExactLocatorVerifications(scope), signal);
      checkCancelled();
      const matching = verifications.filter((record) => record.id === command.verificationRecordId);
      requireCondition(matching.length === 1, "locator-unavailable");
      const stored = StoredExactLocatorVerificationRecordSchema.safeParse(matching[0]);
      requireCondition(stored.success, "locator-unavailable");
      const verification = stored.data;
      requireCondition(matchesScope(verification), "lineage-mismatch");
      requireCondition(verification.result.status === "VERIFIED_EXACT", "locator-unavailable");
      const verified = verification.result.receipt;
      const sources = context.sources.filter((entry) => entry.source.id === verified.sourceId && entry.locator.id === verified.previousLocatorId);
      requireCondition(sources.length === 1, "lineage-mismatch");
      const sourceContext = sources[0]!;
      const { source, locator } = sourceContext;
      requireCondition(source.accessState === "OPEN" && !["UNKNOWN", "PROHIBITED"].includes(source.rightsState), "rights-unavailable");
      const isPdf = verified.target.kind === "PDF";
      const normalizations = isPdf
        ? await abortable(dependencies.pdfReader.listAcceptedPdfNormalizations(scope), signal)
        : await abortable(dependencies.webReader.listAcceptedNormalizations(scope), signal);
      checkCancelled();
      const matchingNormalizations = normalizations.filter((record) => record.id === verification.normalizationRecordId);
      requireCondition(matchingNormalizations.length === 1, "normalization-unavailable");
      const normalized = (isPdf ? StoredPdfNormalizationRecordSchema : StoredSourceNormalizationRecordSchema)
        .safeParse(matchingNormalizations[0]);
      requireCondition(normalized.success, "normalization-unavailable");
      const normalization = normalized.data;
      requireCondition(matchesScope(normalization), "lineage-mismatch");
      requireCondition(normalization.result.status === "NORMALIZED", "normalization-unavailable");
      const receipt = normalization.result.receipt;
      requireCondition(receipt.sourceId === source.id && receipt.sourceLocatorId === locator.id &&
        receipt.snapshotId === verified.snapshotId && receipt.retrievalRecordId === verified.retrievalRecordId &&
        receipt.candidateId === sourceContext.candidate.id && receipt.runId === command.runId, "lineage-mismatch");
      requireCondition(receipt.screeningState === "PASSED", "source-quarantined");
      requireCondition(receipt.rightsState === source.rightsState && receipt.accessState === source.accessState, "rights-unavailable");
      // Own the bytes across await boundaries; caller mutation cannot change the verified passage.
      requireCondition(body.byteLength <= 50_000_000, "invalid-contract");
      const snapshotBody = body.slice();
      requireCondition(dependencies.fingerprint(snapshotBody) === receipt.contentFingerprint &&
        snapshotBody.byteLength === receipt.sourceByteLength, "source-changed");
      const preparedAt = IsoDateTimeSchema.parse(dependencies.now());
      const common = {
        id: verified.id, normalizationRecordId: normalization.id, source, currentLocator: locator,
        body: snapshotBody, verifiedAt: verified.verifiedAt,
        proposal: {
          schemaVersion: 1 as const, normalizationRecordId: normalization.id,
          blockOrdinal: verified.target.blockOrdinal,
          expectedDocumentFingerprint: verified.target.documentFingerprint,
          expectedTextFingerprint: verified.target.textFingerprint,
          expectedAnchorFingerprint: verified.target.kind === "PDF"
            ? verified.target.anchor.anchorFingerprint : verified.target.sourceRangeFingerprint,
          instructionAuthority: "NONE" as const, publicationAuthority: "NONE" as const,
        },
      };
      const parserInput = {
        snapshotId: receipt.snapshotId, sourceId: source.id, sourceLocatorId: locator.id,
        contentFingerprint: receipt.contentFingerprint, verifiedMediaType: receipt.verifiedMediaType,
        body: snapshotBody, normalizedAt: preparedAt,
      };
      let text: string;
      try {
        const reverified = "pageManifests" in receipt
          ? await abortable(dependencies.verifier.verifyPdf({ ...common, normalizationReceipt: receipt }), signal)
          : dependencies.verifier.verifyWeb({ ...common, normalizationReceipt: receipt });
        checkCancelled();
        requireCondition(canonical(reverified) === canonical(verified), "target-mismatch");
        const document = "pageManifests" in receipt
          ? await abortable(dependencies.pdfExtractor.extract(parserInput), signal)
          : dependencies.webNormalizer.normalize(parserInput);
        checkCancelled();
        requireCondition(document.screeningState === "PASSED", "source-quarantined");
        const block = document.blocks[verified.target.blockOrdinal];
        requireCondition(block !== undefined && document.documentFingerprint === verified.target.documentFingerprint &&
          block.textFingerprint === verified.target.textFingerprint, "target-mismatch");
        text = block.text;
        requireCondition(dependencies.fingerprint(text) === verified.target.textFingerprint, "target-mismatch");
      } catch (error) {
        if (error instanceof PassageFailure) throw error;
        throw new PassageFailure("target-mismatch");
      }
      const { start, end, expectedTextFingerprint } = command.selection;
      requireCondition(end <= text.length && !splitsSurrogate(text, start) && !splitsSurrogate(text, end), "selection-invalid");
      const passage = text.slice(start, end);
      requireCondition(passage.trim().length > 0, "selection-invalid");
      const passageFingerprint = Sha256Schema.parse(dependencies.fingerprint(passage));
      requireCondition(passageFingerprint === expectedTextFingerprint, "passage-mismatch");
      checkCancelled();
      const preparedReceipt = EvidencePassageReceiptSchema.parse({
        schemaVersion: 1, ...command,
        verificationFingerprint: verification.verificationFingerprint,
        normalizationRecordId: normalization.id, retrievalRecordId: receipt.retrievalRecordId,
        snapshotId: receipt.snapshotId, sourceId: source.id, locatorId: verified.verifiedLocator.id,
        contentFingerprint: receipt.contentFingerprint, target: verified.target, passageFingerprint,
        rightsState: source.rightsState, retention: "TRANSIENT_ONLY",
        trustBoundary: "UNTRUSTED_SOURCE_DATA", instructionAuthority: "NONE",
        evidenceStatus: "NOT_EVIDENCE", reviewState: "PROPOSED", publicationAuthority: "NONE", preparedAt,
      });
      return { status: "PREPARED", passage, receipt: preparedReceipt, telemetry: telemetry("PREPARED", null) };
    } catch (error) {
      const code = signal.aborted ? "cancelled" : error instanceof PassageFailure ? error.code : "dependency-unavailable";
      return { status: "UNAVAILABLE", code, telemetry: telemetry("UNAVAILABLE", code) };
    }
  };
}
