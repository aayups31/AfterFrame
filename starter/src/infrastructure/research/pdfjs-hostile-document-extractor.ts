import { createHash } from "node:crypto";
import {
  InvalidPDFException,
  PasswordException,
  VerbosityLevel,
  getDocument,
  version as pdfJsVersion,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfDocumentExtractor } from "@/application/research/pdf-normalization-port";
import type { SourceDocumentNormalizationInput } from "@/application/research/source-normalization-port";
import {
  ExtractedPdfDocumentSchema,
  PdfExtractionFailureCodeSchema,
  type ExtractedPdfDocument,
  type PdfExtractionFailureCode,
} from "@/core/research/pdf-normalization";
import { IsoDateTimeSchema, Sha256Schema } from "@/core/shared/schemas";
import { hostilePhraseMatches } from "@/infrastructure/research/hostile-content-patterns";

const EXTRACTOR = {
  id: "pdfjs-hostile-document-extractor",
  version: "1.0.0",
  libraryVersion: pdfJsVersion,
} as const;
const DETECTOR = { id: "hostile-content-screen", version: "1.0.0" } as const;

type PdfLimits = Readonly<{
  maxInputBytes: number;
  maxPages: number;
  maxTextItems: number;
  maxBlocks: number;
  maxBlockCharacters: number;
  maxNormalizedCharacters: number;
  maxSignals: number;
  deadlineMilliseconds: number;
}>;

const DEFAULT_LIMITS: PdfLimits = {
  maxInputBytes: 50_000_000,
  maxPages: 2_000,
  maxTextItems: 100_000,
  maxBlocks: 100_000,
  maxBlockCharacters: 20_000,
  maxNormalizedCharacters: 5_000_000,
  maxSignals: 100,
  deadlineMilliseconds: 30_000,
};

export class PdfExtractionError extends Error {
  readonly code: PdfExtractionFailureCode;

  constructor(codeValue: PdfExtractionFailureCode) {
    const code = PdfExtractionFailureCodeSchema.parse(codeValue);
    super(`PDF extraction rejected: ${code}`);
    this.name = "PdfExtractionError";
    this.code = code;
  }
}

function sha256(value: Uint8Array | string) {
  return Sha256Schema.parse(createHash("sha256").update(value).digest("hex"));
}

function canonical(value: unknown) {
  return JSON.stringify(value);
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rounded(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function normalizedItemText(value: string) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type PdfJsTextItem = Readonly<{
  str: string;
  transform: readonly unknown[];
  width: number;
  height: number;
  hasEOL: boolean;
}>;

function isTextItem(item: unknown): item is PdfJsTextItem {
  return typeof item === "object" && item !== null && "str" in item;
}

function joinedText(left: string, right: string) {
  if (left.length === 0) return right;
  if (/\s$/.test(left) || /^\s|^[,.;:!?%)\]}]/.test(right) || /[(\[{\u2018\u201c]$/.test(left)) {
    return `${left}${right}`;
  }
  return `${left} ${right}`;
}

export function pdfExtractionFailureForError(error: unknown): PdfExtractionError {
  if (error instanceof PdfExtractionError) return error;
  if (error instanceof PasswordException) return new PdfExtractionError("pdf-encrypted");
  if (error instanceof InvalidPDFException) return new PdfExtractionError("pdf-malformed");
  return new PdfExtractionError("pdf-malformed");
}

type LineItem = Readonly<{
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}>;

export class PdfJsHostileDocumentExtractor implements PdfDocumentExtractor {
  readonly #limits: PdfLimits;

  constructor(limits: Partial<PdfLimits> = {}) {
    this.#limits = { ...DEFAULT_LIMITS, ...limits };
  }

  async extract(input: SourceDocumentNormalizationInput): Promise<ExtractedPdfDocument> {
    const extractedAt = IsoDateTimeSchema.parse(input.normalizedAt);
    const contentFingerprint = Sha256Schema.parse(input.contentFingerprint);
    if (!(input.body instanceof Uint8Array)) throw new PdfExtractionError("pdf-contract-invalid");
    if (input.verifiedMediaType.trim().toLowerCase() !== "application/pdf") {
      throw new PdfExtractionError("pdf-unsupported-media");
    }
    if (input.body.byteLength === 0) throw new PdfExtractionError("pdf-empty");
    if (input.body.byteLength > this.#limits.maxInputBytes) throw new PdfExtractionError("pdf-size-exceeded");
    if (sha256(input.body) !== contentFingerprint) throw new PdfExtractionError("pdf-contract-invalid");
    if (new TextDecoder("ascii").decode(input.body.subarray(0, 5)) !== "%PDF-") {
      throw new PdfExtractionError("pdf-malformed");
    }

    const deadline = Date.now() + this.#limits.deadlineMilliseconds;
    const loadingTask = getDocument({
      data: input.body.slice(),
      verbosity: VerbosityLevel.ERRORS,
      stopAtErrors: true,
      maxImageSize: 0,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      useWasm: false,
      enableXfa: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new PdfExtractionError("pdf-timeout")), this.#limits.deadlineMilliseconds);
      });
      const pdf = await Promise.race([loadingTask.promise, timeoutPromise]);
      if (pdf.numPages > this.#limits.maxPages) throw new PdfExtractionError("pdf-page-limit-exceeded");

      const blocks: ExtractedPdfDocument["blocks"][number][] = [];
      const pages: ExtractedPdfDocument["pages"][number][] = [];
      const hostileSignals: ExtractedPdfDocument["hostileSignals"][number][] = [];
      let totalItems = 0;
      let normalizedTextLength = 0;

      const addDocumentSignal = (code: "ACTIVE_CONTENT" | "CREDENTIAL_FORM") => {
        if (hostileSignals.length >= this.#limits.maxSignals) throw new PdfExtractionError("pdf-item-limit-exceeded");
        hostileSignals.push({
          schemaVersion: 1,
          code,
          severity: "HIGH",
          anchorScope: "DOCUMENT",
          anchor: null,
          detectorId: DETECTOR.id,
          detectorVersion: DETECTOR.version,
          instructionAuthority: "NONE",
          publicationAuthority: "NONE",
        });
      };
      if (await pdf.hasJSActions()) addDocumentSignal("ACTIVE_CONTENT");
      if ((await pdf.getFieldObjects()) !== null) addDocumentSignal("CREDENTIAL_FORM");

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (Date.now() > deadline) throw new PdfExtractionError("pdf-timeout");
        const page = await pdf.getPage(pageNumber);
        try {
          if ((await page.getJSActions()) !== null && !hostileSignals.some((signal) => signal.code === "ACTIVE_CONTENT")) {
            addDocumentSignal("ACTIVE_CONTENT");
          }
          const textContent = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
          const items: LineItem[] = [];
          for (const [index, item] of textContent.items.entries()) {
            if (!isTextItem(item)) continue;
            totalItems += 1;
            if (totalItems > this.#limits.maxTextItems) throw new PdfExtractionError("pdf-item-limit-exceeded");
            const text = normalizedItemText(item.str);
            if (text.length === 0) continue;
            items.push({
              index,
              text,
              x: rounded(finite(item.transform[4])),
              y: rounded(finite(item.transform[5])),
              width: Math.max(0, rounded(finite(item.width))),
              height: Math.max(0, rounded(finite(item.height))),
              hasEOL: item.hasEOL,
            });
          }
          const pageObject = page.ref === null
            ? null
            : { objectNumber: page.ref.num, generation: page.ref.gen };
          const pageTextFingerprint = sha256(canonical(items.map(({ index, text, x, y, width, height }) => ({ index, text, x, y, width, height }))));
          const pageBlockStart = blocks.length;
          let line: LineItem[] = [];
          const flush = () => {
            if (line.length === 0) return;
            const text = line.reduce((value, item) => joinedText(value, item.text), "").trim();
            if (text.length === 0) { line = []; return; }
            if (text.length > this.#limits.maxBlockCharacters) throw new PdfExtractionError("pdf-text-limit-exceeded");
            if (blocks.length >= this.#limits.maxBlocks) throw new PdfExtractionError("pdf-item-limit-exceeded");
            if (normalizedTextLength + text.length > this.#limits.maxNormalizedCharacters) throw new PdfExtractionError("pdf-text-limit-exceeded");
            const first = line[0];
            const last = line[line.length - 1];
            if (first === undefined || last === undefined) throw new PdfExtractionError("pdf-contract-invalid");
            const minX = Math.min(...line.map((item) => item.x));
            const minY = Math.min(...line.map((item) => item.y));
            const maxX = Math.max(...line.map((item) => item.x + item.width));
            const maxY = Math.max(...line.map((item) => item.y + item.height));
            const anchorBase = {
              schemaVersion: 1 as const,
              pageNumber,
              pageObject,
              itemStart: first.index,
              itemEnd: last.index + 1,
              boundingBox: { x: rounded(minX), y: rounded(minY), width: rounded(maxX - minX), height: rounded(maxY - minY) },
              pageTextFingerprint,
            };
            const anchor = { ...anchorBase, anchorFingerprint: sha256(canonical(anchorBase)) };
            blocks.push({
              schemaVersion: 1,
              ordinal: blocks.length,
              kind: "PARAGRAPH",
              text,
              textFingerprint: sha256(text),
              anchor,
              trustBoundary: "UNTRUSTED_SOURCE_DATA",
              instructionAuthority: "NONE",
              evidenceStatus: "NOT_EVIDENCE",
              reviewState: "PROPOSED",
              publicationAuthority: "NONE",
            });
            normalizedTextLength += text.length;
            for (const match of hostilePhraseMatches(text)) {
              if (hostileSignals.length >= this.#limits.maxSignals) throw new PdfExtractionError("pdf-item-limit-exceeded");
              hostileSignals.push({
                schemaVersion: 1,
                code: match.code,
                severity: "HIGH",
                anchorScope: "PAGE_TEXT",
                anchor,
                detectorId: DETECTOR.id,
                detectorVersion: DETECTOR.version,
                instructionAuthority: "NONE",
                publicationAuthority: "NONE",
              });
            }
            line = [];
          };
          for (const item of items) {
            const previous = line[line.length - 1];
            if (previous !== undefined) {
              const tolerance = Math.max(2, previous.height * 0.5, item.height * 0.5);
              if (Math.abs(previous.y - item.y) > tolerance) flush();
            }
            line.push(item);
            if (item.hasEOL) flush();
          }
          flush();
          const width = Math.abs(finite(page.view[2]) - finite(page.view[0]));
          const height = Math.abs(finite(page.view[3]) - finite(page.view[1]));
          const pageBase = {
            pageNumber,
            pageObject,
            rotation: ((page.rotate % 360) + 360) % 360,
            width: rounded(width),
            height: rounded(height),
            textItemCount: textContent.items.length,
            blockStart: pageBlockStart,
            blockEnd: blocks.length,
            pageTextFingerprint,
          };
          pages.push({ schemaVersion: 1, ...pageBase, pageStructureFingerprint: sha256(canonical(pageBase)) });
        } finally {
          page.cleanup(true);
        }
      }
      if (blocks.length === 0) throw new PdfExtractionError("pdf-empty");
      const documentBase = {
        contentFingerprint,
        documentKind: "PDF" as const,
        verifiedMediaType: "application/pdf" as const,
        pages,
        blocks,
        hostileSignals,
        extractor: EXTRACTOR,
      };
      return ExtractedPdfDocumentSchema.parse({
        schemaVersion: 1,
        snapshotId: input.snapshotId,
        sourceId: input.sourceId,
        sourceLocatorId: input.sourceLocatorId,
        ...documentBase,
        documentFingerprint: sha256(canonical(documentBase)),
        sourceByteLength: input.body.byteLength,
        pageCount: pages.length,
        normalizedTextLength,
        screeningState: hostileSignals.length === 0 ? "PASSED" : "QUARANTINED",
        extractedAt,
        trustBoundary: "UNTRUSTED_SOURCE_DATA",
        instructionAuthority: "NONE",
        evidenceStatus: "NOT_EVIDENCE",
        reviewState: "PROPOSED",
        publicationAuthority: "NONE",
      });
    } catch (error) {
      throw pdfExtractionFailureForError(error);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      await loadingTask.destroy().catch(() => undefined);
    }
  }
}
