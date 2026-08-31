import { createHash } from "node:crypto";
import type {
  RetrievedSourcePayload,
  SourceRetrievalGrant,
} from "@/application/research/source-retrieval-port";
import { RetrievedSourcePayloadMetadataSchema } from "@/application/research/source-retrieval-port";
import {
  SourceRetrievalFailureCodeSchema,
  SourceRetrievalGrantSchema,
  type SourceRetrievalFailureCode,
} from "@/core/research/source-retrieval";
import { Sha256Schema } from "@/core/shared/schemas";
import { admitPublicSourceUrl } from "@/infrastructure/research/source-resolution-network-policy";

export class SourcePayloadValidationError extends Error {
  readonly code: SourceRetrievalFailureCode;

  constructor(codeValue: SourceRetrievalFailureCode) {
    const code = SourceRetrievalFailureCodeSchema.parse(codeValue);
    super(`Retrieved source payload rejected: ${code}`);
    this.name = "SourcePayloadValidationError";
    this.code = code;
  }
}

export type ValidatedSourcePayload = Readonly<{
  metadata: RetrievedSourcePayload["metadata"];
  body: Uint8Array;
  verifiedMediaType: string;
  decodedContentLength: number;
  contentFingerprint: string;
}>;

function normalizedMediaType(value: string | null) {
  if (value === null) return null;
  const [mediaType] = value.split(";", 1);
  const normalized = mediaType?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
    ? normalized
    : null;
}

function isUtf8Text(body: Uint8Array) {
  if (body.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
    return true;
  } catch {
    return false;
  }
}

function signatureMatches(mediaType: string, body: Uint8Array) {
  if (mediaType === "application/pdf") {
    return new TextDecoder("ascii").decode(body.subarray(0, 5)) === "%PDF-";
  }
  if (mediaType === "text/plain") return isUtf8Text(body);
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    if (!isUtf8Text(body)) return false;
    const prefix = new TextDecoder("utf-8")
      .decode(body.subarray(0, Math.min(body.byteLength, 4_096)))
      .replace(/^\uFEFF/, "")
      .trimStart();
    return /^<(?:!doctype\s+html|html|head|body|meta|title|article|main|div|p|link|script|\?xml|!--)(?:\s|>|\?)/i.test(
      prefix,
    );
  }
  return false;
}

function fingerprint(body: Uint8Array) {
  return Sha256Schema.parse(createHash("sha256").update(body).digest("hex"));
}

/**
 * Validates hostile bytes without interpreting their meaning. Source content
 * remains data with zero instruction or publication authority after success.
 */
export function validateRetrievedSourcePayload(input: Readonly<{
  grant: SourceRetrievalGrant;
  payload: RetrievedSourcePayload;
  expectedContentFingerprint: string | null;
}>): ValidatedSourcePayload {
  const grant = SourceRetrievalGrantSchema.parse(input.grant);
  const metadataResult = RetrievedSourcePayloadMetadataSchema.safeParse(
    input.payload.metadata,
  );
  if (!metadataResult.success || !(input.payload.body instanceof Uint8Array)) {
    throw new SourcePayloadValidationError("retrieval-contract-invalid");
  }
  const metadata = metadataResult.data;
  let finalUrl: string;
  try {
    finalUrl = admitPublicSourceUrl(metadata.finalUrl);
  } catch {
    throw new SourcePayloadValidationError("retrieval-network-rejected");
  }
  if (
    metadata.requestedUrl !== grant.requestedUrl ||
    finalUrl !== metadata.finalUrl ||
    (new URL(grant.requestedUrl).protocol === "https:" &&
      new URL(finalUrl).protocol !== "https:")
  ) {
    throw new SourcePayloadValidationError("retrieval-redirect-invalid");
  }
  const encoding = metadata.contentEncoding?.trim().toLowerCase() ?? null;
  if (encoding !== null && encoding !== "identity") {
    throw new SourcePayloadValidationError("retrieval-content-encoding-rejected");
  }
  if (
    metadata.wireContentLength !== input.payload.body.byteLength ||
    metadata.wireContentLength > grant.maxWireBytes ||
    input.payload.body.byteLength > grant.maxDecodedBytes
  ) {
    throw new SourcePayloadValidationError("retrieval-size-exceeded");
  }
  const mediaType = normalizedMediaType(metadata.declaredMediaType);
  if (mediaType === null || !grant.allowedMediaTypes.includes(mediaType)) {
    throw new SourcePayloadValidationError("retrieval-content-type-rejected");
  }
  if (!signatureMatches(mediaType, input.payload.body)) {
    throw new SourcePayloadValidationError(
      "retrieval-content-signature-mismatch",
    );
  }
  const contentFingerprint = fingerprint(input.payload.body);
  if (
    input.expectedContentFingerprint !== null &&
    contentFingerprint !==
      Sha256Schema.parse(input.expectedContentFingerprint)
  ) {
    throw new SourcePayloadValidationError(
      "retrieval-content-signature-mismatch",
    );
  }
  return {
    metadata,
    body: input.payload.body,
    verifiedMediaType: mediaType,
    decodedContentLength: input.payload.body.byteLength,
    contentFingerprint,
  };
}
