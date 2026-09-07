import type {
  ExactLocatorVerifier,
  PdfExactLocatorVerificationInput,
  WebExactLocatorVerificationInput,
} from "@/application/research/exact-locator-verification-port";
import {
  ExactLocatorProposalSchema,
  ExactLocatorVerificationFailureCodeSchema,
  ExactLocatorVerificationReceiptSchema,
  type ExactLocatorVerificationFailureCode,
} from "@/core/research/exact-locator-verification";
import { PdfDocumentReceiptSchema } from "@/core/research/pdf-normalization";
import { SourceLocatorSchema, SourceRecordSchema } from "@/core/research/schemas";
import { NormalizedDocumentReceiptSchema } from "@/core/research/source-normalization";
import { EntityIdSchema, IsoDateTimeSchema } from "@/core/shared/schemas";
import { DeterministicHostileDocumentNormalizer } from "@/infrastructure/research/deterministic-hostile-document-normalizer";
import { PdfJsHostileDocumentExtractor } from "@/infrastructure/research/pdfjs-hostile-document-extractor";

const VERIFIER = { id: "deterministic-exact-locator-verifier", version: "1.0.0" } as const;

export class ExactLocatorVerificationError extends Error {
  readonly code: ExactLocatorVerificationFailureCode;
  constructor(codeValue: ExactLocatorVerificationFailureCode) {
    const code = ExactLocatorVerificationFailureCodeSchema.parse(codeValue);
    super(`Exact locator verification rejected: ${code}`);
    this.name = "ExactLocatorVerificationError";
    this.code = code;
  }
}

function validatedBase(input: WebExactLocatorVerificationInput | PdfExactLocatorVerificationInput) {
  const id = EntityIdSchema.parse(input.id);
  const normalizationRecordId = EntityIdSchema.parse(input.normalizationRecordId);
  const source = SourceRecordSchema.parse(input.source);
  const locator = SourceLocatorSchema.parse(input.currentLocator);
  const proposal = ExactLocatorProposalSchema.parse(input.proposal);
  const verifiedAt = IsoDateTimeSchema.parse(input.verifiedAt);
  if (!(input.body instanceof Uint8Array)) throw new ExactLocatorVerificationError("locator-contract-invalid");
  const openUrl = source.canonicalUrl;
  if (
    locator.sourceId !== source.id || locator.kind !== source.medium ||
    openUrl === null || locator.openUrl !== openUrl ||
    locator.status === "UNAVAILABLE"
  ) throw new ExactLocatorVerificationError("locator-source-mismatch");
  if (proposal.normalizationRecordId !== normalizationRecordId) {
    throw new ExactLocatorVerificationError("locator-normalization-mismatch");
  }
  if (openUrl === null) throw new ExactLocatorVerificationError("locator-source-mismatch");
  return { id, normalizationRecordId, source, locator, proposal, verifiedAt, openUrl };
}

function pdfOpenUrl(value: string, pageNumber: number) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    url.hash = `page=${pageNumber}`;
    return url.toString();
  } catch {
    throw new ExactLocatorVerificationError("locator-open-target-invalid");
  }
}

export class DeterministicExactLocatorVerifier implements ExactLocatorVerifier {
  readonly #webNormalizer: DeterministicHostileDocumentNormalizer;
  readonly #pdfExtractor: PdfJsHostileDocumentExtractor;

  constructor(dependencies: Readonly<{
    webNormalizer?: DeterministicHostileDocumentNormalizer;
    pdfExtractor?: PdfJsHostileDocumentExtractor;
  }> = {}) {
    this.#webNormalizer = dependencies.webNormalizer ?? new DeterministicHostileDocumentNormalizer();
    this.#pdfExtractor = dependencies.pdfExtractor ?? new PdfJsHostileDocumentExtractor();
  }

  verifyWeb(input: WebExactLocatorVerificationInput) {
    const { id, normalizationRecordId, source, locator, proposal, verifiedAt, openUrl } = validatedBase(input);
    const receipt = NormalizedDocumentReceiptSchema.parse(input.normalizationReceipt);
    if (!(["ARTICLE", "WEBPAGE"] as const).includes(source.medium as "ARTICLE" | "WEBPAGE")) {
      throw new ExactLocatorVerificationError("locator-unsupported-medium");
    }
    if (
      receipt.sourceId !== source.id ||
      receipt.sourceLocatorId !== locator.id || receipt.screeningState !== "PASSED" ||
      receipt.documentFingerprint !== proposal.expectedDocumentFingerprint
    ) {
      throw new ExactLocatorVerificationError(
        receipt.screeningState === "QUARANTINED" ? "locator-document-quarantined" : "locator-normalization-mismatch",
      );
    }
    let document;
    try {
      document = this.#webNormalizer.normalize({
        snapshotId: receipt.snapshotId,
        sourceId: receipt.sourceId,
        sourceLocatorId: receipt.sourceLocatorId,
        contentFingerprint: receipt.contentFingerprint,
        verifiedMediaType: receipt.verifiedMediaType,
        body: input.body,
        normalizedAt: verifiedAt,
      });
    } catch {
      throw new ExactLocatorVerificationError("locator-reparse-failed");
    }
    if (document.documentFingerprint !== receipt.documentFingerprint) {
      throw new ExactLocatorVerificationError("locator-normalization-mismatch");
    }
    const block = document.blocks[proposal.blockOrdinal];
    const manifest = receipt.blockManifests[proposal.blockOrdinal];
    if (block === undefined || manifest === undefined || block.kind !== "PARAGRAPH") {
      throw new ExactLocatorVerificationError("locator-target-not-found");
    }
    if (
      block.textFingerprint !== proposal.expectedTextFingerprint ||
      block.sourceRangeFingerprint !== proposal.expectedAnchorFingerprint ||
      manifest.textFingerprint !== block.textFingerprint ||
      manifest.sourceRangeFingerprint !== block.sourceRangeFingerprint
    ) throw new ExactLocatorVerificationError("locator-target-mismatch");
    const paragraphIndex = document.blocks
      .slice(0, block.ordinal)
      .filter((candidate) => candidate.kind === "PARAGRAPH").length;
    const target = {
      kind: source.medium as "ARTICLE" | "WEBPAGE",
      documentFingerprint: document.documentFingerprint,
      blockOrdinal: block.ordinal,
      paragraphIndex,
      textFingerprint: block.textFingerprint,
      sourceByteStart: block.sourceByteStart,
      sourceByteEnd: block.sourceByteEnd,
      sourceRangeFingerprint: block.sourceRangeFingerprint,
      headingPathFingerprints: manifest.headingPathFingerprints,
    } as const;
    const verifiedLocator = SourceLocatorSchema.parse({
      id,
      sourceId: source.id,
      kind: source.medium,
      status: "VERIFIED_EXACT",
      resolver: VERIFIER,
      revision: locator.revision + 1,
      supersedesLocatorId: locator.id,
      openUrl,
      resolvedAt: verifiedAt,
      lastVerifiedAt: verifiedAt,
      createdAt: verifiedAt,
      headingPath: [],
      paragraphIndex,
      textFingerprint: block.textFingerprint,
      textFragmentUrl: null,
    });
    return ExactLocatorVerificationReceiptSchema.parse({
      schemaVersion: 1,
      id,
      normalizationRecordId,
      retrievalRecordId: receipt.retrievalRecordId,
      snapshotId: receipt.snapshotId,
      sourceId: source.id,
      previousLocatorId: locator.id,
      verifiedLocator,
      target,
      status: "VERIFIED_EXACT",
      verifier: VERIFIER,
      verifiedAt,
      trustBoundary: "UNTRUSTED_SOURCE_DATA",
      instructionAuthority: "NONE",
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
    });
  }

  async verifyPdf(input: PdfExactLocatorVerificationInput) {
    const { id, normalizationRecordId, source, locator, proposal, verifiedAt, openUrl } = validatedBase(input);
    const receipt = PdfDocumentReceiptSchema.parse(input.normalizationReceipt);
    if (source.medium !== "PDF" || locator.kind !== "PDF") {
      throw new ExactLocatorVerificationError("locator-unsupported-medium");
    }
    if (
      receipt.sourceId !== source.id ||
      receipt.sourceLocatorId !== locator.id || receipt.screeningState !== "PASSED" ||
      receipt.documentFingerprint !== proposal.expectedDocumentFingerprint
    ) {
      throw new ExactLocatorVerificationError(
        receipt.screeningState === "QUARANTINED" ? "locator-document-quarantined" : "locator-normalization-mismatch",
      );
    }
    let document;
    try {
      document = await this.#pdfExtractor.extract({
        snapshotId: receipt.snapshotId,
        sourceId: receipt.sourceId,
        sourceLocatorId: receipt.sourceLocatorId,
        contentFingerprint: receipt.contentFingerprint,
        verifiedMediaType: receipt.verifiedMediaType,
        body: input.body,
        normalizedAt: verifiedAt,
      });
    } catch {
      throw new ExactLocatorVerificationError("locator-reparse-failed");
    }
    if (document.documentFingerprint !== receipt.documentFingerprint) {
      throw new ExactLocatorVerificationError("locator-normalization-mismatch");
    }
    const block = document.blocks[proposal.blockOrdinal];
    const manifest = receipt.blockManifests[proposal.blockOrdinal];
    const page = block === undefined ? undefined : document.pages[block.anchor.pageNumber - 1];
    if (block === undefined || manifest === undefined || page === undefined) {
      throw new ExactLocatorVerificationError("locator-target-not-found");
    }
    if (
      block.textFingerprint !== proposal.expectedTextFingerprint ||
      block.anchor.anchorFingerprint !== proposal.expectedAnchorFingerprint ||
      manifest.textFingerprint !== block.textFingerprint ||
      manifest.anchor.anchorFingerprint !== block.anchor.anchorFingerprint ||
      page.pageTextFingerprint !== block.anchor.pageTextFingerprint
    ) throw new ExactLocatorVerificationError("locator-target-mismatch");
    const target = {
      kind: "PDF" as const,
      documentFingerprint: document.documentFingerprint,
      blockOrdinal: block.ordinal,
      textFingerprint: block.textFingerprint,
      pageStructureFingerprint: page.pageStructureFingerprint,
      anchor: block.anchor,
    };
    const verifiedLocator = SourceLocatorSchema.parse({
      id,
      sourceId: source.id,
      kind: "PDF",
      status: "VERIFIED_EXACT",
      resolver: VERIFIER,
      revision: locator.revision + 1,
      supersedesLocatorId: locator.id,
      openUrl: pdfOpenUrl(openUrl, block.anchor.pageNumber),
      resolvedAt: verifiedAt,
      lastVerifiedAt: verifiedAt,
      createdAt: verifiedAt,
      documentVersionId: `snapshot:${receipt.snapshotId}`,
      pageIndex: block.anchor.pageNumber,
      printedPageLabel: null,
      section: null,
      heading: null,
      textFingerprint: block.textFingerprint,
    });
    return ExactLocatorVerificationReceiptSchema.parse({
      schemaVersion: 1,
      id,
      normalizationRecordId,
      retrievalRecordId: receipt.retrievalRecordId,
      snapshotId: receipt.snapshotId,
      sourceId: source.id,
      previousLocatorId: locator.id,
      verifiedLocator,
      target,
      status: "VERIFIED_EXACT",
      verifier: VERIFIER,
      verifiedAt,
      trustBoundary: "UNTRUSTED_SOURCE_DATA",
      instructionAuthority: "NONE",
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
    });
  }
}
