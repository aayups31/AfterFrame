import { createHash } from "node:crypto";
import {
  SourceResolutionInputSchema,
  SourceResolutionProbeSchema,
  SourceResolutionResultSchema,
  type SourceCandidateResolver,
  type SourceMetadataProbeTransport,
  type SourceResolutionFailureCode,
  type SourceResolutionInput,
} from "@/application/research/source-resolution-port";
import { SourceLocatorSchema, SourceRecordSchema } from "@/core/research/schemas";
import { EntityIdSchema, Sha256Schema, SlugSchema } from "@/core/shared/schemas";
import {
  admitPublicSourceUrl,
  assertPublicResolutionAddresses,
} from "@/infrastructure/research/source-resolution-network-policy";

const RESOLVER_ID = "http-source-metadata";
const RESOLVER_VERSION = "1.0.0";

function sha256(value: string) {
  return Sha256Schema.parse(createHash("sha256").update(value, "utf8").digest("hex"));
}

function deterministicEntityId(purpose: string, ...parts: readonly string[]) {
  const digest = sha256(`afterframe:${purpose}:v1\0${parts.join("\0")}`);
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8)
    .toString(16);
  return EntityIdSchema.parse(
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
  );
}

function cleanTitle(value: string | null, fallback: string) {
  const cleaned = (value ?? fallback)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
  return cleaned.length === 0 ? "Untitled source" : cleaned;
}

function providerSlug(hostname: string) {
  const candidate = hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return SlugSchema.parse(candidate.length === 0 ? "web-provider" : candidate);
}

function sourceOnlyLocator(input: Readonly<{
  medium: SourceResolutionInput["candidate"]["medium"];
  sourceId: string;
  locatorId: string;
  openUrl: string;
  observedAt: string;
}>) {
  const base = {
    id: input.locatorId,
    sourceId: input.sourceId,
    status: "SOURCE_ONLY" as const,
    resolver: { id: RESOLVER_ID, version: RESOLVER_VERSION },
    revision: 1,
    supersedesLocatorId: null,
    openUrl: input.openUrl,
    resolvedAt: input.observedAt,
    lastVerifiedAt: null,
    createdAt: input.observedAt,
  };
  const url = new URL(input.openUrl);
  switch (input.medium) {
    case "ARTICLE":
    case "WEBPAGE":
      return SourceLocatorSchema.parse({
        ...base,
        kind: input.medium,
        headingPath: [],
        paragraphIndex: null,
        textFingerprint: null,
        textFragmentUrl: null,
      });
    case "VIDEO":
    case "PODCAST":
      return SourceLocatorSchema.parse({
        ...base,
        kind: input.medium,
        provider: providerSlug(url.hostname),
        providerItemId: `url-sha256:${sha256(input.openUrl)}`,
        timestampStartMs: null,
        timestampEndMs: null,
        transcriptCueIds: [],
        transcriptFingerprint: null,
      });
    case "BOOK":
      return SourceLocatorSchema.parse({
        ...base,
        kind: "BOOK",
        editionId: null,
        isbn: null,
        pageStart: null,
        pageEnd: null,
        printedPageLabel: null,
        chapter: null,
        section: null,
      });
    case "PDF":
      return SourceLocatorSchema.parse({
        ...base,
        kind: "PDF",
        documentVersionId: null,
        pageIndex: null,
        printedPageLabel: null,
        section: null,
        heading: null,
        textFingerprint: null,
      });
    case "ARCHIVE":
      return SourceLocatorSchema.parse({
        ...base,
        kind: "ARCHIVE",
        collectionId: providerSlug(url.hostname),
        itemId: `url-sha256:${sha256(input.openUrl)}`,
        documentVersionId: null,
        pageIndex: null,
        printedPageLabel: null,
        section: null,
        heading: null,
        textFingerprint: null,
      });
    case "OFFICIAL_RECORD":
      return SourceLocatorSchema.parse({
        ...base,
        kind: "OFFICIAL_RECORD",
        issuingBody: url.hostname,
        recordId: `url-sha256:${sha256(input.openUrl)}`,
        documentVersionId: null,
        pageIndex: null,
        printedPageLabel: null,
        section: null,
        heading: null,
        textFingerprint: null,
      });
    case "SCREENPLAY":
      return SourceLocatorSchema.parse({
        ...base,
        kind: "SCREENPLAY",
        draftId: `url-sha256:${sha256(input.openUrl)}`,
        sceneNumber: null,
        sceneHeading: null,
        documentVersionId: null,
        pageIndex: null,
        printedPageLabel: null,
        section: null,
        heading: null,
        textFingerprint: null,
      });
    default:
      return null;
  }
}

export class DeterministicSourceMetadataResolver
  implements SourceCandidateResolver
{
  readonly #transport: SourceMetadataProbeTransport;

  constructor(transport: SourceMetadataProbeTransport) {
    this.#transport = transport;
  }

  async resolve(inputValue: SourceResolutionInput, signal: AbortSignal) {
    const input = SourceResolutionInputSchema.parse(inputValue);
    const unresolved = (code: SourceResolutionFailureCode) =>
      SourceResolutionResultSchema.parse({
        status: "UNRESOLVED",
        candidateId: input.candidate.id,
        code,
        publicationAuthority: "NONE",
      });
    if (input.candidate.canonicalUrl === null) {
      return unresolved("candidate-url-missing");
    }
    let requestedUrl: string;
    try {
      requestedUrl = admitPublicSourceUrl(input.candidate.canonicalUrl);
    } catch {
      return unresolved("network-target-rejected");
    }
    let probeValue: unknown;
    try {
      probeValue = await this.#transport.probe(requestedUrl, {
        maxRedirects: 5,
        signal,
      });
    } catch {
      return unresolved("probe-unavailable");
    }
    const probe = SourceResolutionProbeSchema.safeParse(probeValue);
    if (!probe.success) return unresolved("probe-contract-invalid");
    try {
      if (admitPublicSourceUrl(probe.data.requestedUrl) !== requestedUrl) {
        return unresolved("redirect-chain-invalid");
      }
      for (const [index, hop] of probe.data.hops.entries()) {
        const admittedHopUrl = admitPublicSourceUrl(hop.url);
        if (index === 0 && admittedHopUrl !== requestedUrl) {
          return unresolved("redirect-chain-invalid");
        }
        if (
          index < probe.data.hops.length - 1 &&
          (hop.statusCode < 300 || hop.statusCode >= 400)
        ) {
          return unresolved("redirect-chain-invalid");
        }
        assertPublicResolutionAddresses(hop.resolvedAddresses);
      }
    } catch {
      return unresolved("network-target-rejected");
    }
    const finalHop = probe.data.hops.at(-1);
    if (finalHop === undefined || finalHop.statusCode < 200 || finalHop.statusCode >= 300) {
      return unresolved("source-unavailable");
    }
    const canonicalUrl = admitPublicSourceUrl(finalHop.url);
    const sourceId = deterministicEntityId(
      "resolved-source",
      canonicalUrl,
    );
    const locatorId = deterministicEntityId(
      "source-locator",
      sourceId,
      input.candidate.medium,
      canonicalUrl,
    );
    const locator = sourceOnlyLocator({
      medium: input.candidate.medium,
      sourceId,
      locatorId,
      openUrl: canonicalUrl,
      observedAt: finalHop.observedAt,
    });
    if (locator === null) return unresolved("source-medium-unsupported");
    const source = SourceRecordSchema.parse({
      id: sourceId,
      canonicalKey: `url-sha256:${sha256(canonicalUrl)}`,
      canonicalUrl,
      title: cleanTitle(finalHop.title, input.candidate.title),
      contributors: [],
      publisher: null,
      publishedAt: null,
      medium: input.candidate.medium,
      sourceClass: input.candidate.sourceClass,
      accessState: "OPEN",
      rightsState: "LINK_ONLY",
      independenceGroupId: null,
      origin: { kind: "RESOLVER", actorId: null, version: RESOLVER_VERSION },
      createdAt: finalHop.observedAt,
    });
    return SourceResolutionResultSchema.parse({
      status: "RESOLVED",
      proposal: {
        candidateId: input.candidate.id,
        source,
        locator,
        reviewState: "PROPOSED",
        metadataTrust: "UNTRUSTED_SOURCE_DATA",
        evidenceStatus: "NOT_EVIDENCE",
        publicationAuthority: "NONE",
        contentBodyIncluded: false,
      },
    });
  }
}
