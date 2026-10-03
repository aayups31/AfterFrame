import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPrepareEvidencePassageService } from "@/application/research/prepare-evidence-passage";
import { createNormalizedDocumentReceipt } from "@/application/research/create-normalized-document-receipt";
import { createPdfDocumentReceipt } from "@/application/research/create-pdf-document-receipt";
import { EvidencePassageReceiptSchema, EvidencePassageTelemetrySchema } from "@/core/research/evidence-passage";
import { DurableNormalizationRetrievalContextSchema } from "@/core/research/source-retrieval";
import { StoredExactLocatorVerificationRecordSchema } from "@/core/research/exact-locator-verification";
import { StoredSourceNormalizationRecordSchema } from "@/core/research/source-normalization";
import { StoredPdfNormalizationRecordSchema } from "@/core/research/pdf-normalization";
import { SourceRecordSchema, SourceLocatorSchema } from "@/core/research/schemas";
import { BLACK_HAWK_DOWN_SPINE_IDS } from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import { DeterministicHostileDocumentNormalizer } from "@/infrastructure/research/deterministic-hostile-document-normalizer";
import { DeterministicExactLocatorVerifier } from "@/infrastructure/research/deterministic-exact-locator-verifier";
import { PdfJsHostileDocumentExtractor } from "@/infrastructure/research/pdfjs-hostile-document-extractor";

const id = (n: number) => `99100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = "2026-09-17T12:00:00.000Z";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const passageText = "Synthetic Black Hawk Down research fixture; this is not a historical claim.";

function pdfBytes(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let textPdf = "%PDF-1.7\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(textPdf);
    textPdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(textPdf);
  textPdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  textPdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(textPdf);
}

async function fixture(kind: "WEBPAGE" | "PDF" = "WEBPAGE", text = passageText) {
  const actorId = BLACK_HAWK_DOWN_SPINE_IDS.owner;
  const scope = { caseId: BLACK_HAWK_DOWN_SPINE_IDS.case, runId: id(1), jobId: id(2), attemptId: id(3), manifestFingerprint: hash("manifest") };
  const url = kind === "PDF" ? "https://example.org/fixture.pdf" : "https://example.org/fixture";
  const source = SourceRecordSchema.parse({
    id: id(4), canonicalKey: "synthetic-fixture", canonicalUrl: url, title: "Synthetic fixture",
    contributors: [], publisher: null, publishedAt: null, medium: kind, sourceClass: "primary-document",
    accessState: "OPEN", rightsState: "LINK_ONLY", independenceGroupId: null,
    origin: { kind: "RESOLVER", actorId: null, version: "1.0.0" }, createdAt: time,
  });
  const locator = SourceLocatorSchema.parse({
    id: id(5), sourceId: source.id, kind, status: "SOURCE_ONLY",
    resolver: { id: "source-metadata-resolver", version: "1.0.0" }, revision: 1,
    supersedesLocatorId: null, openUrl: url, resolvedAt: time, lastVerifiedAt: null, createdAt: time,
    ...(kind === "PDF"
      ? { documentVersionId: null, pageIndex: null, printedPageLabel: null, section: null, heading: null, textFingerprint: null }
      : { headingPath: [], paragraphIndex: null, textFingerprint: null, textFragmentUrl: null }),
  });
  const body = kind === "PDF" ? pdfBytes(text) : new TextEncoder().encode(`<h1>Fixture</h1><p>${text}</p>`);
  const parserInput = { snapshotId: id(6), sourceId: source.id, sourceLocatorId: locator.id,
    contentFingerprint: hash(body), verifiedMediaType: kind === "PDF" ? "application/pdf" : "text/html", body, normalizedAt: time };
  const webNormalizer = new DeterministicHostileDocumentNormalizer();
  const pdfExtractor = new PdfJsHostileDocumentExtractor();
  const receiptBase = { id: id(7), runId: scope.runId, candidateId: id(8), retrievalRecordId: id(9),
    accessState: "OPEN", rightsState: "LINK_ONLY", retention: "TRANSIENT_ONLY" as const, storageRef: null };
  const receipt = kind === "PDF"
    ? createPdfDocumentReceipt({ ...receiptBase, document: await pdfExtractor.extract(parserInput) })
    : createNormalizedDocumentReceipt({ ...receiptBase, document: webNormalizer.normalize(parserInput) });
  const manifest = receipt.blockManifests.find((block) => block.kind === "PARAGRAPH")!;
  const verifier = new DeterministicExactLocatorVerifier();
  const verifyInput = { id: id(10), normalizationRecordId: id(11), source, currentLocator: locator, body, verifiedAt: time,
    proposal: { schemaVersion: 1 as const, normalizationRecordId: id(11), blockOrdinal: manifest.ordinal,
      expectedDocumentFingerprint: receipt.documentFingerprint, expectedTextFingerprint: manifest.textFingerprint,
      expectedAnchorFingerprint: "anchor" in manifest ? manifest.anchor.anchorFingerprint : manifest.sourceRangeFingerprint,
      instructionAuthority: "NONE" as const, publicationAuthority: "NONE" as const } };
  const verified = "pageManifests" in receipt
    ? await verifier.verifyPdf({ ...verifyInput, normalizationReceipt: receipt })
    : verifier.verifyWeb({ ...verifyInput, normalizationReceipt: receipt });
  const verification = StoredExactLocatorVerificationRecordSchema.parse({
    schemaVersion: 1, id: id(12), ...scope, normalizationRecordId: id(11), targetBlockOrdinal: manifest.ordinal,
    idempotencyKey: "fixture:locator", verifier: verified.verifier,
    result: { status: "VERIFIED_EXACT", receipt: verified }, createdAt: time,
    verificationFingerprint: hash("verification"), acceptedAt: time,
  });
  const normalization = (kind === "PDF" ? StoredPdfNormalizationRecordSchema : StoredSourceNormalizationRecordSchema).parse({
    schemaVersion: 1, id: id(11), ...scope, retrievalRecordId: receipt.retrievalRecordId,
    idempotencyKey: "fixture:normalization", normalizer: receipt.normalizer,
    result: { status: "NORMALIZED", receipt }, createdAt: time, normalizationFingerprint: hash("normalization"), acceptedAt: time,
  });
  const context = DurableNormalizationRetrievalContextSchema.parse({ schemaVersion: 1, ...scope, sources: [{
    resolutionRecordId: id(13), resolutionFingerprint: hash("resolution"), source, locator,
    candidate: { schemaVersion: 1, id: receipt.candidateId, runId: scope.runId, jobId: id(14), attemptId: id(15),
      candidateKey: "fixture:candidate", title: "Synthetic fixture", canonicalUrl: url, medium: kind,
      sourceClass: source.sourceClass, axisIds: ["production-history"], accessState: "UNKNOWN", rightsState: "UNKNOWN",
      discoveryInputFingerprint: hash("discovery"), contentTrust: "UNTRUSTED", evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED", publicationAuthority: "NONE", createdAt: time },
  }] });
  const dependencies = {
    actorId, contextReader: { getNormalizationRetrievalContext: vi.fn().mockResolvedValue(context) },
    locatorReader: { listAcceptedExactLocatorVerifications: vi.fn().mockResolvedValue([verification]) },
    webReader: { listAcceptedNormalizations: vi.fn().mockResolvedValue([normalization]) },
    pdfReader: { listAcceptedPdfNormalizations: vi.fn().mockResolvedValue([normalization]) },
    webNormalizer, pdfExtractor, verifier, fingerprint: hash, now: () => time, monotonicNow: () => 10,
  };
  const command = { ...scope, verificationRecordId: verification.id,
    selection: { start: 0, end: text.length, expectedTextFingerprint: hash(text) } };
  const controller = new AbortController();
  const prepare = () => createPrepareEvidencePassageService(dependencies)(command, body, controller.signal);
  return { actorId, context, receipt, normalization, verification, verified, dependencies, command, body, controller, prepare };
}

describe("verified passage preparation", () => {
  it.each(["WEBPAGE", "PDF"] as const)("rechecks %s bytes and returns transient text with complete provenance", async (kind) => {
    const f = await fixture(kind);
    const result = await f.prepare();
    expect(result.status).toBe("PREPARED");
    if (result.status !== "PREPARED") return;
    expect(result.passage).toBe(passageText);
    expect(result.receipt).toMatchObject({ sourceId: id(4), snapshotId: id(6), locatorId: id(10),
      normalizationRecordId: id(11), verificationRecordId: id(12), retention: "TRANSIENT_ONLY",
      evidenceStatus: "NOT_EVIDENCE", reviewState: "PROPOSED", publicationAuthority: "NONE" });
    expect(JSON.stringify(result.receipt)).not.toContain(passageText);
    expect(JSON.stringify(result.telemetry)).not.toContain("Black Hawk Down");
    expect(result.telemetry).toMatchObject({ modelCalls: 0, providerCostUsd: 0, privateContentIncluded: false });
    expect(f.dependencies.locatorReader.listAcceptedExactLocatorVerifications).toHaveBeenCalledWith({
      actorId: f.actorId, runId: f.command.runId, jobId: f.command.jobId, attemptId: f.command.attemptId });
    expect(await f.prepare()).toEqual(result);
  });

  it("rejects a passage supplied by a model instead of source offsets", async () => {
    const f = await fixture();
    const result = await createPrepareEvidencePassageService(f.dependencies)(
      { ...f.command, passage: "invented quote" }, f.body, f.controller.signal);
    expect(result).toMatchObject({ status: "UNAVAILABLE", code: "invalid-contract" });
    expect(f.dependencies.contextReader.getNormalizationRetrievalContext).not.toHaveBeenCalled();
  });

  it.each(["caseId", "runId", "jobId", "attemptId", "manifestFingerprint"] as const)("rejects mismatched %s in accepted records", async (key) => {
    const f = await fixture();
    f.verification[key] = key === "manifestFingerprint" ? hash("other") : id(99);
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "lineage-mismatch" });
  });

  it("rejects missing actor context before reading private locator records", async () => {
    const f = await fixture();
    f.dependencies.contextReader.getNormalizationRetrievalContext.mockResolvedValue(null);
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "context-unavailable" });
    expect(f.dependencies.locatorReader.listAcceptedExactLocatorVerifications).not.toHaveBeenCalled();
  });

  it.each(["UNKNOWN", "PROHIBITED"] as const)("refuses %s rights before extracting text", async (rights) => {
    const f = await fixture();
    f.context.sources[0]!.source.rightsState = rights;
    if (rights === "PROHIBITED") f.context.sources[0]!.source.accessState = "UNAVAILABLE";
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "rights-unavailable" });
  });

  it("refuses rights drift between normalization and current source", async () => {
    const f = await fixture();
    f.context.sources[0]!.source.rightsState = "PERMITTED";
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "rights-unavailable" });
  });

  it("detects changed source bytes even when a verified locator exists", async () => {
    const f = await fixture();
    f.body[30] = 88;
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "source-changed" });
  });

  it.each(["WEBPAGE", "PDF"] as const)("rejects altered %s geometry even if fingerprints were copied", async (kind) => {
    const f = await fixture(kind);
    if (f.verification.result.status !== "VERIFIED_EXACT") throw new Error("fixture");
    const target = f.verification.result.receipt.target;
    if (target.kind === "PDF") target.anchor.boundingBox.x += 1;
    else target.sourceByteStart += 1;
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "target-mismatch" });
  });

  it("rejects an exact passage whose selection fingerprint does not match", async () => {
    const f = await fixture();
    f.command.selection.expectedTextFingerprint = hash("fabricated quotation");
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "passage-mismatch" });
  });

  it("rejects oversized, out-of-bounds and split-Unicode selections", async () => {
    const f = await fixture("WEBPAGE", "A 🎬 film fixture.");
    f.command.selection.end = 501;
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "invalid-contract" });
    f.command.selection.end = 100;
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "selection-invalid" });
    f.command.selection.end = 3;
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "selection-invalid" });
    f.command.selection.end = 4;
    f.command.selection.expectedTextFingerprint = hash("A 🎬");
    expect(await f.prepare()).toMatchObject({ status: "PREPARED", passage: "A 🎬" });
  });

  it("cancels before work and after an asynchronous database read", async () => {
    const f = await fixture();
    f.controller.abort();
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "cancelled" });
    expect(f.dependencies.contextReader.getNormalizationRetrievalContext).not.toHaveBeenCalled();
    const g = await fixture();
    g.dependencies.locatorReader.listAcceptedExactLocatorVerifications.mockImplementation(async () => {
      g.controller.abort(); return [g.verification];
    });
    expect(await g.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "cancelled" });
  });

  it("never leaks adapter errors or source text into failure output", async () => {
    const f = await fixture();
    f.dependencies.webReader.listAcceptedNormalizations.mockRejectedValue(new Error(`secret ${passageText}`));
    const result = await f.prepare();
    expect(result).toMatchObject({ status: "UNAVAILABLE", code: "dependency-unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain(passageText);
  });

  it("returns cancellation even while a reader has not completed", async () => {
    const f = await fixture();
    f.dependencies.contextReader.getNormalizationRetrievalContext.mockReturnValue(new Promise(() => {}));
    const pending = f.prepare();
    f.controller.abort();
    expect(await pending).toMatchObject({ status: "UNAVAILABLE", code: "cancelled" });
  });

  it("rejects quarantined accepted normalization before verification", async () => {
    const f = await fixture();
    if (f.normalization.result.status !== "NORMALIZED") throw new Error("fixture");
    const receipt = f.normalization.result.receipt;
    if ("pageManifests" in receipt) throw new Error("fixture");
    receipt.screeningState = "QUARANTINED";
    receipt.hostileSignals = [{ schemaVersion: 1, code: "INSTRUCTION_OVERRIDE", severity: "HIGH",
      sourceByteStart: 0, sourceByteEnd: 1, sourceRangeFingerprint: hash("signal"),
      detectorId: "hostile-content-screen", detectorVersion: "1.0.0",
      instructionAuthority: "NONE", publicationAuthority: "NONE" }];
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "source-quarantined" });
  });

  it("rejects absent and ambiguous accepted locator records", async () => {
    const f = await fixture();
    f.dependencies.locatorReader.listAcceptedExactLocatorVerifications.mockResolvedValue([]);
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "locator-unavailable" });
    f.dependencies.locatorReader.listAcceptedExactLocatorVerifications.mockResolvedValue([f.verification, f.verification]);
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "locator-unavailable" });
  });

  it("rejects a normalization from a different case", async () => {
    const f = await fixture();
    f.normalization.caseId = id(99);
    expect(await f.prepare()).toMatchObject({ status: "UNAVAILABLE", code: "lineage-mismatch" });
  });

  it("does not allow prose to be appended to durable receipts or telemetry", async () => {
    const f = await fixture();
    const result = await f.prepare();
    if (result.status !== "PREPARED") throw new Error("fixture");
    expect(EvidencePassageReceiptSchema.safeParse({ ...result.receipt, passage: result.passage }).success).toBe(false);
    expect(EvidencePassageTelemetrySchema.safeParse({ ...result.telemetry, sourceText: result.passage }).success).toBe(false);
  });
});
