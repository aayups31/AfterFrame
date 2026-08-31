import type {
  SourceRetrievalPolicy,
  SourceRetrievalPolicyInput,
} from "@/application/research/source-retrieval-port";
import {
  SourceRetrievalDecisionSchema,
  SourceRetrievalDenialCodeSchema,
  SourceRetrievalPolicyInputSchema,
} from "@/core/research/source-retrieval";
import type { z } from "zod";

type DenialCode = z.infer<typeof SourceRetrievalDenialCodeSchema>;

const RETAINABLE_RIGHTS = new Set([
  "PERMITTED",
  "USER_OWNED",
  "PUBLIC_DOMAIN",
  "LICENSED",
]);

const MEDIUM_POLICIES = {
  ARTICLE: {
    allowedMediaTypes: ["text/html", "application/xhtml+xml", "text/plain"],
    maxWireBytes: 5_000_000,
    maxDecodedBytes: 10_000_000,
  },
  WEBPAGE: {
    allowedMediaTypes: ["text/html", "application/xhtml+xml", "text/plain"],
    maxWireBytes: 5_000_000,
    maxDecodedBytes: 10_000_000,
  },
  PDF: {
    allowedMediaTypes: ["application/pdf"],
    maxWireBytes: 25_000_000,
    maxDecodedBytes: 50_000_000,
  },
  OFFICIAL_RECORD: {
    allowedMediaTypes: [
      "application/pdf",
      "text/html",
      "application/xhtml+xml",
      "text/plain",
    ],
    maxWireBytes: 25_000_000,
    maxDecodedBytes: 50_000_000,
  },
  ARCHIVE: {
    allowedMediaTypes: [
      "application/pdf",
      "text/html",
      "application/xhtml+xml",
      "text/plain",
    ],
    maxWireBytes: 25_000_000,
    maxDecodedBytes: 50_000_000,
  },
  SCREENPLAY: {
    allowedMediaTypes: ["application/pdf", "text/plain"],
    maxWireBytes: 25_000_000,
    maxDecodedBytes: 50_000_000,
  },
} as const;

function denied(code: DenialCode) {
  return SourceRetrievalDecisionSchema.parse({
    status: "DENIED",
    code,
    instructionAuthority: "NONE",
    publicationAuthority: "NONE",
  });
}

/**
 * Deterministic authority gate. It decides whether bytes may be fetched and
 * retained; it does not inspect, parse, or trust source content.
 */
export class DeterministicSourceRetrievalPolicy implements SourceRetrievalPolicy {
  decide(inputValue: SourceRetrievalPolicyInput) {
    const input = SourceRetrievalPolicyInputSchema.parse(inputValue);
    const { source, locator } = input;
    if (source.rightsState === "PROHIBITED") {
      return denied("source-rights-prohibited");
    }
    if (source.accessState !== "OPEN") return denied("source-access-not-open");
    if (source.rightsState === "UNKNOWN") {
      return denied("source-rights-unknown");
    }
    if (["BOOK", "VIDEO", "PODCAST", "USER_ASSET"].includes(source.medium)) {
      return denied("medium-adapter-required");
    }
    const mediumPolicy = MEDIUM_POLICIES[
      source.medium as keyof typeof MEDIUM_POLICIES
    ];
    if (mediumPolicy === undefined) return denied("medium-unsupported");
    if (
      locator.sourceId !== source.id ||
      locator.kind !== source.medium ||
      locator.openUrl !== source.canonicalUrl
    ) {
      return denied("source-locator-mismatch");
    }
    if (source.canonicalUrl === null || locator.openUrl === null) {
      return denied("source-url-unavailable");
    }
    return SourceRetrievalDecisionSchema.parse({
      status: "GRANTED",
      retention: RETAINABLE_RIGHTS.has(source.rightsState)
        ? "RETAINABLE"
        : "TRANSIENT_ONLY",
      requestedUrl: source.canonicalUrl,
      allowedMediaTypes: [...mediumPolicy.allowedMediaTypes],
      maxWireBytes: mediumPolicy.maxWireBytes,
      maxDecodedBytes: mediumPolicy.maxDecodedBytes,
      contentEncodingPolicy: "IDENTITY_ONLY",
      accessControlPolicy: "NO_CIRCUMVENTION",
      instructionAuthority: "NONE",
      publicationAuthority: "NONE",
    });
  }
}
