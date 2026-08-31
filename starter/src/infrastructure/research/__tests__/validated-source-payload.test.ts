import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  RetrievedSourcePayload,
  SourceRetrievalGrant,
} from "@/application/research/source-retrieval-port";
import {
  SourcePayloadValidationError,
  validateRetrievedSourcePayload,
} from "@/infrastructure/research/validated-source-payload";

const ZERO_HASH = "0".repeat(64);
const CAPTURED_AT = "2026-08-30T18:00:00.000Z";

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function grant(overrides: Partial<SourceRetrievalGrant> = {}): SourceRetrievalGrant {
  return {
    status: "GRANTED",
    retention: "TRANSIENT_ONLY",
    requestedUrl: "https://example.com/report",
    allowedMediaTypes: ["text/html", "text/plain"],
    maxWireBytes: 5_000_000,
    maxDecodedBytes: 10_000_000,
    contentEncodingPolicy: "IDENTITY_ONLY",
    accessControlPolicy: "NO_CIRCUMVENTION",
    instructionAuthority: "NONE",
    publicationAuthority: "NONE",
    ...overrides,
  };
}

function payload(
  body = bytes("<!doctype html><title>Research</title><p>Source text</p>"),
  overrides: Partial<RetrievedSourcePayload["metadata"]> = {},
): RetrievedSourcePayload {
  return {
    metadata: {
      requestedUrl: "https://example.com/report",
      finalUrl: "https://example.com/report",
      redirectChainFingerprint: ZERO_HASH,
      declaredMediaType: "text/html; charset=utf-8",
      contentEncoding: null,
      wireContentLength: body.byteLength,
      capturedAt: CAPTURED_AT,
      ...overrides,
    },
    body,
  };
}

function rejectedCode(code: string) {
  return expect.objectContaining({ code });
}

describe("validateRetrievedSourcePayload", () => {
  it("accepts bounded UTF-8 HTML and fingerprints the exact hostile bytes", () => {
    const value = payload();
    const result = validateRetrievedSourcePayload({
      grant: grant(),
      payload: value,
      expectedContentFingerprint: null,
    });

    expect(result).toMatchObject({
      metadata: value.metadata,
      body: value.body,
      verifiedMediaType: "text/html",
      decodedContentLength: value.body.byteLength,
      contentFingerprint: createHash("sha256").update(value.body).digest("hex"),
    });
  });

  it("accepts a PDF only when its signature and declared type agree", () => {
    const body = bytes("%PDF-1.7\nfixture");
    expect(
      validateRetrievedSourcePayload({
        grant: grant({ allowedMediaTypes: ["application/pdf"] }),
        payload: payload(body, { declaredMediaType: "application/pdf" }),
        expectedContentFingerprint: null,
      }).verifiedMediaType,
    ).toBe("application/pdf");
  });

  it("rejects a server MIME claim that disagrees with the byte signature", () => {
    expect(() =>
      validateRetrievedSourcePayload({
        grant: grant({ allowedMediaTypes: ["application/pdf"] }),
        payload: payload(bytes("<html>not a PDF</html>"), {
          declaredMediaType: "application/pdf",
        }),
        expectedContentFingerprint: null,
      }),
    ).toThrowError(rejectedCode("retrieval-content-signature-mismatch"));
  });

  it.each(["gzip", "br", "deflate"])(
    "rejects compressed content before decompression: %s",
    (contentEncoding) => {
      expect(() =>
        validateRetrievedSourcePayload({
          grant: grant(),
          payload: payload(undefined, { contentEncoding }),
          expectedContentFingerprint: null,
        }),
      ).toThrowError(rejectedCode("retrieval-content-encoding-rejected"));
    },
  );

  it("rejects declared, actual, wire, or decoded size excess", () => {
    const body = bytes("plain source text");
    expect(() =>
      validateRetrievedSourcePayload({
        grant: grant({
          allowedMediaTypes: ["text/plain"],
          maxWireBytes: body.byteLength - 1,
        }),
        payload: payload(body, { declaredMediaType: "text/plain" }),
        expectedContentFingerprint: null,
      }),
    ).toThrowError(rejectedCode("retrieval-size-exceeded"));
    expect(() =>
      validateRetrievedSourcePayload({
        grant: grant({ allowedMediaTypes: ["text/plain"] }),
        payload: payload(body, {
          declaredMediaType: "text/plain",
          wireContentLength: body.byteLength + 1,
        }),
        expectedContentFingerprint: null,
      }),
    ).toThrowError(rejectedCode("retrieval-size-exceeded"));
  });

  it("rejects a media type outside the exact policy allowlist", () => {
    expect(() =>
      validateRetrievedSourcePayload({
        grant: grant(),
        payload: payload(undefined, { declaredMediaType: "application/json" }),
        expectedContentFingerprint: null,
      }),
    ).toThrowError(rejectedCode("retrieval-content-type-rejected"));
  });

  it("rejects NUL bytes and invalid UTF-8 in text payloads", () => {
    for (const body of [new Uint8Array([65, 0, 66]), new Uint8Array([0xc3, 0x28])]) {
      expect(() =>
        validateRetrievedSourcePayload({
          grant: grant({ allowedMediaTypes: ["text/plain"] }),
          payload: payload(body, { declaredMediaType: "text/plain" }),
          expectedContentFingerprint: null,
        }),
      ).toThrowError(rejectedCode("retrieval-content-signature-mismatch"));
    }
  });

  it("rejects request substitution, unsafe final URLs, and HTTPS downgrade", () => {
    for (const candidate of [
      payload(undefined, { requestedUrl: "https://other.example/report" }),
      payload(undefined, { finalUrl: "http://127.0.0.1/secrets" }),
      payload(undefined, { finalUrl: "http://example.com/report" }),
    ]) {
      expect(() =>
        validateRetrievedSourcePayload({
          grant: grant(),
          payload: candidate,
          expectedContentFingerprint: null,
        }),
      ).toThrow(SourcePayloadValidationError);
    }
  });

  it("rejects bytes that changed from an expected immutable fingerprint", () => {
    expect(() =>
      validateRetrievedSourcePayload({
        grant: grant(),
        payload: payload(),
        expectedContentFingerprint: ZERO_HASH,
      }),
    ).toThrowError(rejectedCode("retrieval-content-signature-mismatch"));
  });
});
