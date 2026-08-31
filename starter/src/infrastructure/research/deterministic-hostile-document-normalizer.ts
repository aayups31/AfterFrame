import { createHash } from "node:crypto";
import type {
  SourceDocumentNormalizationInput,
  SourceDocumentNormalizer,
} from "@/application/research/source-normalization-port";
import {
  NormalizedSourceDocumentSchema,
  SourceNormalizationFailureCodeSchema,
  type HostileContentSignal,
  type NormalizedDocumentBlock,
  type SourceNormalizationFailureCode,
} from "@/core/research/source-normalization";
import { IsoDateTimeSchema, Sha256Schema } from "@/core/shared/schemas";

const NORMALIZER = {
  id: "deterministic-hostile-document-normalizer",
  version: "1.0.0",
} as const;
const DETECTOR = { id: "hostile-content-screen", version: "1.0.0" } as const;
const HTML_MEDIA = new Set(["text/html", "application/xhtml+xml"]);
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "div", "dl", "dt", "dd", "figcaption",
  "figure", "footer", "header", "main", "nav", "section", "table", "tbody",
  "thead", "tfoot", "tr", "td", "th",
]);
const RAW_IGNORED_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "math", "canvas",
]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

type Limits = Readonly<{
  maxInputBytes: number;
  maxTags: number;
  maxBlocks: number;
  maxBlockCharacters: number;
  maxNormalizedCharacters: number;
  maxSignals: number;
}>;

const DEFAULT_LIMITS: Limits = {
  maxInputBytes: 10_000_000,
  maxTags: 100_000,
  maxBlocks: 10_000,
  maxBlockCharacters: 20_000,
  maxNormalizedCharacters: 5_000_000,
  maxSignals: 100,
};

export class SourceNormalizationError extends Error {
  readonly code: SourceNormalizationFailureCode;

  constructor(codeValue: SourceNormalizationFailureCode) {
    const code = SourceNormalizationFailureCodeSchema.parse(codeValue);
    super(`Source normalization rejected: ${code}`);
    this.name = "SourceNormalizationError";
    this.code = code;
  }
}

function sha256(value: Uint8Array | string) {
  return Sha256Schema.parse(createHash("sha256").update(value).digest("hex"));
}

function decodeUtf8(body: Uint8Array) {
  if (body.includes(0)) {
    throw new SourceNormalizationError("normalization-malformed-content");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new SourceNormalizationError("normalization-malformed-content");
  }
}

function utf8ByteOffsets(value: string) {
  const offsets = new Uint32Array(value.length + 1);
  let byteOffset = 0;
  for (let index = 0; index < value.length; ) {
    offsets[index] = byteOffset;
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const width = codePoint > 0xffff ? 2 : 1;
    const byteWidth =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (width === 2) offsets[index + 1] = byteOffset;
    index += width;
    byteOffset += byteWidth;
    offsets[index] = byteOffset;
  }
  return offsets;
}

function decodedEntity(
  entity: string,
  decimal: string | undefined,
  hexadecimal: string | undefined,
  name: string | undefined,
) {
  const named: Readonly<Record<string, string>> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  if (decimal !== undefined || hexadecimal !== undefined) {
    const codePoint = Number.parseInt(
      decimal ?? hexadecimal ?? "",
      decimal === undefined ? 16 : 10,
    );
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff &&
      !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : "�";
  }
  return named[name?.toLowerCase() ?? ""] ?? entity;
}

const ENTITY_PATTERN = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,31}));/gi;

function decodeEntities(value: string) {
  return value.replace(
    ENTITY_PATTERN,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, name: string | undefined) =>
      decodedEntity(entity, decimal, hexadecimal, name),
  );
}

function decodeEntitiesWithSourceMap(value: string) {
  const output: string[] = [];
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  let cursor = 0;
  ENTITY_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(ENTITY_PATTERN)) {
    const entityStart = match.index ?? cursor;
    for (let index = cursor; index < entityStart; index += 1) {
      output.push(value[index] ?? "");
      sourceStarts.push(index);
      sourceEnds.push(index + 1);
    }
    const decoded = decodedEntity(match[0], match[1], match[2], match[3]);
    for (let index = 0; index < decoded.length; index += 1) {
      output.push(decoded[index] ?? "");
      sourceStarts.push(entityStart);
      sourceEnds.push(entityStart + match[0].length);
    }
    cursor = entityStart + match[0].length;
  }
  for (let index = cursor; index < value.length; index += 1) {
    output.push(value[index] ?? "");
    sourceStarts.push(index);
    sourceEnds.push(index + 1);
  }
  return { text: output.join(""), sourceStarts, sourceEnds };
}

function normalizeText(value: string, preserveWhitespace: boolean) {
  const withoutControls = decodeEntities(value)
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  return preserveWhitespace
    ? withoutControls.replace(/\r\n?/g, "\n").trim()
    : withoutControls.replace(/\s+/g, " ").trim();
}

function findTagEnd(html: string, start: number) {
  let quote: '"' | "'" | null = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  throw new SourceNormalizationError("normalization-malformed-content");
}

function parseTag(rawTag: string) {
  const closing = /^<\s*\//.test(rawTag);
  const match = rawTag.match(/^<\s*\/?\s*([a-z][a-z0-9:-]*)/i);
  return {
    closing,
    name: match?.[1]?.toLowerCase() ?? null,
    selfClosing: /\/\s*>$/.test(rawTag),
    rawLower: rawTag.toLowerCase(),
  };
}

function sourceRange(body: Uint8Array, start: number, end: number) {
  return sha256(body.subarray(start, end));
}

function hostilePhraseMatches(value: string) {
  const patterns = [
    ["INSTRUCTION_OVERRIDE", /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?\b/gi],
    ["ROLE_IMPERSONATION", /(?:^|[\s\[<])(?:system|developer|assistant)\s*(?:message)?\s*[:>\]]/gi],
    ["ROLE_IMPERSONATION", /\byou\s+are\s+(?:chatgpt|an?\s+ai\s+assistant|the\s+system)\b/gi],
    ["TOOL_COMMAND", /\b(?:call|invoke|execute|run)\s+(?:the\s+)?(?:tool|function|shell|command)\b/gi],
    ["SECRET_EXFILTRATION", /\b(?:reveal|send|upload|exfiltrate|print)\b[^.\n]{0,80}\b(?:api\s*key|password|credential|secret|system\s+prompt)\b/gi],
    ["ENCODED_INSTRUCTION", /\b(?:[A-Za-z0-9+/]{120,}={0,2})\b/g],
  ] as const;
  const matches: Array<Readonly<{ code: HostileContentSignal["code"]; start: number; end: number }>> = [];
  for (const [code, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0;
      matches.push({ code, start, end: start + match[0].length });
    }
  }
  return matches.sort((left, right) => left.start - right.start || left.code.localeCompare(right.code));
}

function canonicalDocumentFingerprint(input: Readonly<{
  contentFingerprint: string;
  documentKind: string;
  verifiedMediaType: string;
  title: string | null;
  blocks: readonly NormalizedDocumentBlock[];
  hostileSignals: readonly HostileContentSignal[];
}>) {
  return sha256(JSON.stringify({ ...input, normalizer: NORMALIZER }));
}

class DocumentBuilder {
  readonly #body: Uint8Array;
  readonly #limits: Limits;
  readonly blocks: NormalizedDocumentBlock[] = [];
  readonly hostileSignals: HostileContentSignal[] = [];
  readonly headingPath: string[] = [];
  title: string | null = null;
  normalizedTextLength = 0;

  constructor(body: Uint8Array, limits: Limits) {
    this.#body = body;
    this.#limits = limits;
  }

  addSignal(code: HostileContentSignal["code"], start: number, end: number) {
    if (this.hostileSignals.length >= this.#limits.maxSignals) {
      throw new SourceNormalizationError("normalization-complexity-exceeded");
    }
    const boundedEnd = Math.min(Math.max(end, start + 1), this.#body.byteLength);
    this.hostileSignals.push({
      schemaVersion: 1,
      code,
      severity: code === "HIDDEN_CONTENT" ? "MEDIUM" : "HIGH",
      sourceByteStart: start,
      sourceByteEnd: boundedEnd,
      sourceRangeFingerprint: sourceRange(this.#body, start, boundedEnd),
      detectorId: DETECTOR.id,
      detectorVersion: DETECTOR.version,
      instructionAuthority: "NONE",
      publicationAuthority: "NONE",
    });
  }

  addTextSignals(rawText: string, characterStart: number, byteOffsets: Uint32Array) {
    const decoded = decodeEntitiesWithSourceMap(rawText);
    for (const match of hostilePhraseMatches(decoded.text)) {
      const localStart = decoded.sourceStarts[match.start] ?? match.start;
      const localEnd = decoded.sourceEnds[match.end - 1] ?? match.end;
      const sourceCharacterStart = characterStart + localStart;
      const sourceCharacterEnd = characterStart + localEnd;
      this.addSignal(
        match.code,
        byteOffsets[sourceCharacterStart] ?? 0,
        byteOffsets[sourceCharacterEnd] ?? this.#body.byteLength,
      );
    }
  }

  addBlockSignals(text: string, sourceByteStart: number, sourceByteEnd: number) {
    const existingCodes = new Set(
      this.hostileSignals
        .filter(
          (signal) =>
            signal.sourceByteStart >= sourceByteStart &&
            signal.sourceByteEnd <= sourceByteEnd,
        )
        .map((signal) => signal.code),
    );
    for (const match of hostilePhraseMatches(text)) {
      if (!existingCodes.has(match.code)) {
        this.addSignal(match.code, sourceByteStart, sourceByteEnd);
        existingCodes.add(match.code);
      }
    }
  }

  addBlock(input: Readonly<{
    kind: NormalizedDocumentBlock["kind"];
    headingLevel: number | null;
    text: string;
    sourceByteStart: number;
    sourceByteEnd: number;
  }>) {
    const text = input.text.trim();
    if (text.length === 0) return;
    if (text.length > this.#limits.maxBlockCharacters) {
      throw new SourceNormalizationError("normalization-block-size-exceeded");
    }
    if (this.blocks.length >= this.#limits.maxBlocks) {
      throw new SourceNormalizationError("normalization-complexity-exceeded");
    }
    if (this.normalizedTextLength + text.length > this.#limits.maxNormalizedCharacters) {
      throw new SourceNormalizationError("normalization-size-exceeded");
    }
    if (input.kind === "HEADING" && input.headingLevel !== null) {
      this.headingPath.length = input.headingLevel - 1;
      this.headingPath[input.headingLevel - 1] = text;
    }
    const headingPath = this.headingPath.filter((heading) => heading !== undefined);
    const block: NormalizedDocumentBlock = {
      schemaVersion: 1,
      ordinal: this.blocks.length,
      kind: input.kind,
      headingLevel: input.headingLevel,
      headingPath,
      text,
      sourceByteStart: input.sourceByteStart,
      sourceByteEnd: input.sourceByteEnd,
      sourceRangeFingerprint: sourceRange(
        this.#body,
        input.sourceByteStart,
        input.sourceByteEnd,
      ),
      textFingerprint: sha256(text),
      trustBoundary: "UNTRUSTED_SOURCE_DATA",
      instructionAuthority: "NONE",
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
    };
    this.blocks.push(block);
    this.normalizedTextLength += text.length;
    if (input.kind === "TITLE" && this.title === null) this.title = text.slice(0, 1_000);
  }
}

type PendingBlock = {
  kind: NormalizedDocumentBlock["kind"];
  headingLevel: number | null;
  pieces: string[];
  sourceByteStart: number | null;
  sourceByteEnd: number | null;
};

function htmlDocument(body: Uint8Array, text: string, limits: Limits) {
  const byteOffsets = utf8ByteOffsets(text);
  const lowerText = text.toLowerCase();
  const builder = new DocumentBuilder(body, limits);
  let pending: PendingBlock | null = null;
  let index = 0;
  let tagCount = 0;
  let suppressedTag: string | null = null;
  let suppressedDepth = 0;
  let suppressedRaw = false;

  const flush = () => {
    if (pending === null) return;
    const preserve = pending.kind === "PREFORMATTED";
    const normalized = normalizeText(pending.pieces.join(""), preserve);
    if (pending.sourceByteStart !== null && pending.sourceByteEnd !== null) {
      builder.addBlockSignals(
        normalized,
        pending.sourceByteStart,
        pending.sourceByteEnd,
      );
      builder.addBlock({
        kind: pending.kind,
        headingLevel: pending.headingLevel,
        text: normalized,
        sourceByteStart: pending.sourceByteStart,
        sourceByteEnd: pending.sourceByteEnd,
      });
    }
    pending = null;
  };
  const begin = (kind: PendingBlock["kind"], headingLevel: number | null) => {
    flush();
    const nextBlock: PendingBlock = {
      kind,
      headingLevel,
      pieces: [],
      sourceByteStart: null,
      sourceByteEnd: null,
    };
    pending = nextBlock;
    return nextBlock;
  };
  const current = (): PendingBlock | null => pending;

  while (index < text.length) {
    if (suppressedRaw && suppressedTag !== null) {
      const closingStart = lowerText.indexOf(`</${suppressedTag}`, index);
      if (closingStart === -1) {
        throw new SourceNormalizationError("normalization-malformed-content");
      }
      const boundary = lowerText[closingStart + suppressedTag.length + 2];
      if (boundary !== undefined && !/[\s>]/.test(boundary)) {
        index = closingStart + suppressedTag.length + 2;
        continue;
      }
      index = findTagEnd(text, closingStart);
      suppressedTag = null;
      suppressedDepth = 0;
      suppressedRaw = false;
      continue;
    }
    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end === -1) throw new SourceNormalizationError("normalization-malformed-content");
      index = end + 3;
      continue;
    }
    if (text[index] !== "<") {
      const next = text.indexOf("<", index);
      const end = next === -1 ? text.length : next;
      if (suppressedDepth === 0) {
        const rawText = text.slice(index, end);
        if (rawText.length > 0) {
          const active = current() ?? begin("PARAGRAPH", null);
          active.pieces.push(rawText);
          active.sourceByteStart ??= byteOffsets[index] ?? 0;
          active.sourceByteEnd = byteOffsets[end] ?? body.byteLength;
          builder.addTextSignals(rawText, index, byteOffsets);
        }
      }
      index = end;
      continue;
    }
    const tagEnd = findTagEnd(text, index);
    const rawTag = text.slice(index, tagEnd);
    const sourceStart = byteOffsets[index] ?? 0;
    const sourceEnd = byteOffsets[tagEnd] ?? body.byteLength;
    index = tagEnd;
    tagCount += 1;
    if (tagCount > limits.maxTags) {
      throw new SourceNormalizationError("normalization-complexity-exceeded");
    }
    if (/^<!doctype/i.test(rawTag)) {
      if (/\[|\bsystem\b|\bpublic\b/i.test(rawTag)) {
        throw new SourceNormalizationError("normalization-malformed-content");
      }
      continue;
    }
    if (/^<\?xml/i.test(rawTag)) continue;
    if (/^<!/i.test(rawTag)) {
      throw new SourceNormalizationError("normalization-malformed-content");
    }
    const tag = parseTag(rawTag);
    if (tag.name === null) {
      throw new SourceNormalizationError("normalization-malformed-content");
    }

    if (suppressedDepth > 0) {
      if (!tag.closing && tag.name === suppressedTag && !tag.selfClosing) suppressedDepth += 1;
      if (tag.closing && tag.name === suppressedTag) {
        suppressedDepth -= 1;
        if (suppressedDepth === 0) suppressedTag = null;
      }
      continue;
    }

    const hasHiddenAttribute =
      !tag.closing &&
      (/(?:\s|^)hidden(?:\s|=|\/|>)/i.test(rawTag) ||
        /aria-hidden\s*=\s*["']?true/i.test(rawTag) ||
        /style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(rawTag));
    const hasActiveAttribute =
      !tag.closing &&
      (/\son[a-z]+\s*=/i.test(rawTag) ||
        /(?:href|src|action)\s*=\s*["']?\s*(?:javascript|data):/i.test(rawTag) ||
        (tag.name === "meta" && /http-equiv\s*=\s*["']?refresh/i.test(rawTag)));
    if (hasActiveAttribute) builder.addSignal("ACTIVE_CONTENT", sourceStart, sourceEnd);
    if (hasHiddenAttribute) {
      builder.addSignal("HIDDEN_CONTENT", sourceStart, sourceEnd);
      if (!tag.selfClosing && !VOID_TAGS.has(tag.name)) {
        suppressedTag = tag.name;
        suppressedDepth = 1;
      }
      continue;
    }
    if (!tag.closing && ["iframe", "object", "embed"].includes(tag.name)) {
      builder.addSignal("EXTERNAL_EMBED", sourceStart, sourceEnd);
      if (!tag.selfClosing && !VOID_TAGS.has(tag.name)) {
        suppressedTag = tag.name;
        suppressedDepth = 1;
      }
      continue;
    }
    if (!tag.closing && ["form", "input", "textarea", "select", "button"].includes(tag.name)) {
      builder.addSignal("CREDENTIAL_FORM", sourceStart, sourceEnd);
      if (!tag.selfClosing && !VOID_TAGS.has(tag.name)) {
        suppressedTag = tag.name;
        suppressedDepth = 1;
      }
      continue;
    }
    if (!tag.closing && RAW_IGNORED_TAGS.has(tag.name)) {
      if (!tag.selfClosing) {
        suppressedTag = tag.name;
        suppressedDepth = 1;
        suppressedRaw = true;
      }
      continue;
    }

    if (tag.name === "br" && !tag.closing) {
      current()?.pieces.push("\n");
      continue;
    }
    if (tag.name === "hr") {
      flush();
      continue;
    }
    const heading = tag.name.match(/^h([1-6])$/);
    if (heading !== null) {
      if (tag.closing) flush();
      else begin("HEADING", Number.parseInt(heading[1] ?? "1", 10));
      continue;
    }
    const blockKind =
      tag.name === "title" ? "TITLE" :
      tag.name === "p" ? "PARAGRAPH" :
      tag.name === "li" ? "LIST_ITEM" :
      tag.name === "blockquote" ? "QUOTE" :
      tag.name === "pre" ? "PREFORMATTED" : null;
    if (blockKind !== null) {
      if (tag.closing) flush();
      else begin(blockKind, null);
      continue;
    }
    if (BLOCK_TAGS.has(tag.name)) flush();
  }
  if (suppressedDepth > 0 && suppressedTag !== null && suppressedRaw) {
    throw new SourceNormalizationError("normalization-malformed-content");
  }
  flush();
  return builder;
}

function plainTextDocument(body: Uint8Array, text: string, limits: Limits) {
  const byteOffsets = utf8ByteOffsets(text);
  const builder = new DocumentBuilder(body, limits);
  const paragraphPattern = /\S(?:[\s\S]*?\S)?(?=\r?\n\s*\r?\n|$)/g;
  for (const match of text.matchAll(paragraphPattern)) {
    const characterStart = match.index ?? 0;
    const characterEnd = characterStart + match[0].length;
    const normalized = normalizeText(match[0], false);
    const sourceByteStart = byteOffsets[characterStart] ?? 0;
    const sourceByteEnd = byteOffsets[characterEnd] ?? body.byteLength;
    builder.addBlockSignals(normalized, sourceByteStart, sourceByteEnd);
    builder.addBlock({
      kind: "PARAGRAPH",
      headingLevel: null,
      text: normalized,
      sourceByteStart,
      sourceByteEnd,
    });
    builder.addTextSignals(match[0], characterStart, byteOffsets);
  }
  return builder;
}

export class DeterministicHostileDocumentNormalizer
  implements SourceDocumentNormalizer
{
  readonly #limits: Limits;

  constructor(limits: Partial<Limits> = {}) {
    this.#limits = { ...DEFAULT_LIMITS, ...limits };
  }

  normalize(input: SourceDocumentNormalizationInput) {
    const normalizedAt = IsoDateTimeSchema.parse(input.normalizedAt);
    const expectedFingerprint = Sha256Schema.parse(input.contentFingerprint);
    if (!(input.body instanceof Uint8Array)) {
      throw new SourceNormalizationError("normalization-contract-invalid");
    }
    if (input.body.byteLength === 0) {
      throw new SourceNormalizationError("normalization-empty");
    }
    if (input.body.byteLength > this.#limits.maxInputBytes) {
      throw new SourceNormalizationError("normalization-size-exceeded");
    }
    if (sha256(input.body) !== expectedFingerprint) {
      throw new SourceNormalizationError("normalization-fingerprint-mismatch");
    }
    const text = decodeUtf8(input.body);
    const mediaType = input.verifiedMediaType.trim().toLowerCase();
    const builder = HTML_MEDIA.has(mediaType)
      ? htmlDocument(input.body, text, this.#limits)
      : mediaType === "text/plain"
        ? plainTextDocument(input.body, text, this.#limits)
        : null;
    if (builder === null) {
      throw new SourceNormalizationError("normalization-unsupported-media");
    }
    if (builder.blocks.length === 0) {
      throw new SourceNormalizationError("normalization-empty");
    }
    const documentKind = HTML_MEDIA.has(mediaType) ? "HTML" : "PLAIN_TEXT";
    const documentFingerprint = canonicalDocumentFingerprint({
      contentFingerprint: expectedFingerprint,
      documentKind,
      verifiedMediaType: mediaType,
      title: builder.title,
      blocks: builder.blocks,
      hostileSignals: builder.hostileSignals,
    });
    return NormalizedSourceDocumentSchema.parse({
      schemaVersion: 1,
      snapshotId: input.snapshotId,
      sourceId: input.sourceId,
      sourceLocatorId: input.sourceLocatorId,
      contentFingerprint: expectedFingerprint,
      documentFingerprint,
      documentKind,
      verifiedMediaType: mediaType,
      sourceByteLength: input.body.byteLength,
      normalizedTextLength: builder.normalizedTextLength,
      title: builder.title,
      blocks: builder.blocks,
      screeningState: builder.hostileSignals.length === 0 ? "PASSED" : "QUARANTINED",
      hostileSignals: builder.hostileSignals,
      normalizer: NORMALIZER,
      normalizedAt,
      trustBoundary: "UNTRUSTED_SOURCE_DATA",
      instructionAuthority: "NONE",
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
    });
  }
}
