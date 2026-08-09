import { z } from "zod";
import {
  EntityIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  RecordOriginSchema,
  ReviewStateSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

export const SourceMediumSchema = z.enum([
  "ARTICLE",
  "WEBPAGE",
  "BOOK",
  "VIDEO",
  "PODCAST",
  "PDF",
  "ARCHIVE",
  "OFFICIAL_RECORD",
  "SCREENPLAY",
  "USER_ASSET",
  "OTHER",
]);

export const AccessStateSchema = z.enum([
  "OPEN",
  "RESTRICTED",
  "UNKNOWN",
  "UNAVAILABLE",
]);

export const RightsStateSchema = z.enum([
  "PERMITTED",
  "LINK_ONLY",
  "USER_OWNED",
  "PUBLIC_DOMAIN",
  "LICENSED",
  "UNKNOWN",
  "PROHIBITED",
]);

export const SourceRecordSchema = z
  .object({
    id: EntityIdSchema,
    canonicalKey: z.string().trim().min(1).max(1_000),
    canonicalUrl: HttpUrlSchema.nullable(),
    title: z.string().trim().min(1).max(1_000),
    contributors: z.array(z.string().trim().min(1).max(300)).max(30),
    publisher: z.string().trim().min(1).max(500).nullable(),
    publishedAt: IsoDateTimeSchema.nullable(),
    medium: SourceMediumSchema,
    sourceClass: SlugSchema,
    accessState: AccessStateSchema,
    rightsState: RightsStateSchema,
    independenceGroupId: OpaqueReferenceSchema.nullable(),
    origin: RecordOriginSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((source, context) => {
    if (source.accessState === "OPEN" && source.canonicalUrl === null) {
      context.addIssue({
        code: "custom",
        path: ["canonicalUrl"],
        message: "OPEN sources require a canonicalUrl",
      });
    }

    if (source.rightsState === "PROHIBITED" && source.accessState === "OPEN") {
      context.addIssue({
        code: "custom",
        path: ["rightsState"],
        message: "PROHIBITED sources cannot be marked OPEN",
      });
    }
  });

export const SnapshotExtractionMethodSchema = z.enum([
  "RESOLVER",
  "AUTHORIZED_API",
  "USER_UPLOAD",
  "HUMAN_REVIEW",
  "DETERMINISTIC_FIXTURE",
]);

export const SourceSnapshotSchema = z
  .object({
    id: EntityIdSchema,
    sourceId: EntityIdSchema,
    caseId: EntityIdSchema.nullable(),
    contentFingerprint: Sha256Schema,
    contentLength: z.number().int().nonnegative(),
    extractionMethod: SnapshotExtractionMethodSchema,
    storageRef: OpaqueReferenceSchema.nullable(),
    accessState: AccessStateSchema,
    rightsState: RightsStateSchema,
    capturedAt: IsoDateTimeSchema,
    createdByRunId: EntityIdSchema.nullable(),
    origin: RecordOriginSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const storageEligibleRights = new Set([
      "PERMITTED",
      "USER_OWNED",
      "PUBLIC_DOMAIN",
      "LICENSED",
    ]);
    const storageEligibleAccess = new Set(["OPEN", "RESTRICTED"]);
    if (
      snapshot.storageRef !== null &&
      !storageEligibleRights.has(snapshot.rightsState)
    ) {
      context.addIssue({
        code: "custom",
        path: ["storageRef"],
        message: `${snapshot.rightsState} snapshots cannot retain content storage`,
      });
    }
    if (
      snapshot.storageRef !== null &&
      !storageEligibleAccess.has(snapshot.accessState)
    ) {
      context.addIssue({
        code: "custom",
        path: ["storageRef"],
        message: `${snapshot.accessState} snapshots cannot retain content storage`,
      });
    }
    if (snapshot.rightsState === "USER_OWNED" && snapshot.caseId === null) {
      context.addIssue({
        code: "custom",
        path: ["caseId"],
        message: "USER_OWNED snapshots must remain scoped to one case",
      });
    }
  });

export const LocatorStatusSchema = z.enum([
  "VERIFIED_EXACT",
  "VERIFIED_APPROXIMATE",
  "SOURCE_ONLY",
  "STALE",
  "UNAVAILABLE",
]);

export const ResolverIdentitySchema = z
  .object({
    id: SlugSchema,
    version: VersionTagSchema,
  })
  .strict();

const locatorBaseShape = {
  id: EntityIdSchema,
  sourceId: EntityIdSchema,
  status: LocatorStatusSchema,
  resolver: ResolverIdentitySchema,
  revision: z.number().int().positive(),
  supersedesLocatorId: EntityIdSchema.nullable(),
  openUrl: HttpUrlSchema.nullable(),
  resolvedAt: IsoDateTimeSchema.nullable(),
  lastVerifiedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
};

const boundedTextLocationShape = {
  headingPath: z.array(z.string().trim().min(1).max(300)).max(20),
  paragraphIndex: z.number().int().nonnegative().nullable(),
  textFingerprint: Sha256Schema.nullable(),
  textFragmentUrl: HttpUrlSchema.nullable(),
};

export const ArticleLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("ARTICLE"),
    ...boundedTextLocationShape,
  })
  .strict();

export const WebpageLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("WEBPAGE"),
    ...boundedTextLocationShape,
  })
  .strict();

const timeBasedLocationShape = {
  provider: SlugSchema,
  providerItemId: OpaqueReferenceSchema,
  timestampStartMs: z.number().int().nonnegative().nullable(),
  timestampEndMs: z.number().int().nonnegative().nullable(),
  transcriptCueIds: z.array(OpaqueReferenceSchema).max(100),
  transcriptFingerprint: Sha256Schema.nullable(),
};

export const VideoLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("VIDEO"),
    ...timeBasedLocationShape,
  })
  .strict();

export const PodcastLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("PODCAST"),
    ...timeBasedLocationShape,
  })
  .strict();

export const BookLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("BOOK"),
    editionId: OpaqueReferenceSchema.nullable(),
    isbn: z.string().trim().min(10).max(17).nullable(),
    pageStart: z.number().int().positive().nullable(),
    pageEnd: z.number().int().positive().nullable(),
    printedPageLabel: z.string().trim().min(1).max(40).nullable(),
    chapter: z.string().trim().min(1).max(300).nullable(),
    section: z.string().trim().min(1).max(300).nullable(),
  })
  .strict();

const paginatedLocationShape = {
  documentVersionId: OpaqueReferenceSchema.nullable(),
  pageIndex: z.number().int().positive().nullable(),
  printedPageLabel: z.string().trim().min(1).max(40).nullable(),
  section: z.string().trim().min(1).max(300).nullable(),
  heading: z.string().trim().min(1).max(300).nullable(),
  textFingerprint: Sha256Schema.nullable(),
};

export const PdfLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("PDF"),
    ...paginatedLocationShape,
  })
  .strict();

export const ArchiveLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("ARCHIVE"),
    collectionId: OpaqueReferenceSchema,
    itemId: OpaqueReferenceSchema,
    ...paginatedLocationShape,
  })
  .strict();

export const OfficialRecordLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("OFFICIAL_RECORD"),
    issuingBody: z.string().trim().min(1).max(500),
    recordId: OpaqueReferenceSchema,
    ...paginatedLocationShape,
  })
  .strict();

export const ScreenplayLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("SCREENPLAY"),
    draftId: OpaqueReferenceSchema,
    sceneNumber: z.string().trim().min(1).max(40).nullable(),
    sceneHeading: z.string().trim().min(1).max(300).nullable(),
    ...paginatedLocationShape,
  })
  .strict();

export const UserAssetLocatorSchema = z
  .object({
    ...locatorBaseShape,
    kind: z.literal("USER_ASSET"),
    assetId: OpaqueReferenceSchema,
    locationDescription: z.string().trim().min(1).max(500),
    contentFingerprint: Sha256Schema,
  })
  .strict();

const UnrefinedSourceLocatorSchema = z.discriminatedUnion("kind", [
  ArticleLocatorSchema,
  WebpageLocatorSchema,
  VideoLocatorSchema,
  PodcastLocatorSchema,
  BookLocatorSchema,
  PdfLocatorSchema,
  ArchiveLocatorSchema,
  OfficialRecordLocatorSchema,
  ScreenplayLocatorSchema,
  UserAssetLocatorSchema,
]);

export const SourceLocatorSchema = UnrefinedSourceLocatorSchema.superRefine(
  (locator, context) => {
    const isVerified =
      locator.status === "VERIFIED_EXACT" ||
      locator.status === "VERIFIED_APPROXIMATE";

    if (isVerified && locator.lastVerifiedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["lastVerifiedAt"],
        message: `${locator.status} locators require lastVerifiedAt`,
      });
    }

    if (isVerified && locator.resolvedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["resolvedAt"],
        message: `${locator.status} locators require resolvedAt`,
      });
    }

    if (locator.status !== "UNAVAILABLE" && locator.openUrl === null) {
      context.addIssue({
        code: "custom",
        path: ["openUrl"],
        message: `${locator.status} locators require an openUrl`,
      });
    }

    if (
      locator.resolvedAt !== null &&
      new Date(locator.resolvedAt).getTime() <
        new Date(locator.createdAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolvedAt"],
        message: "resolvedAt cannot precede createdAt",
      });
    }

    if (
      locator.lastVerifiedAt !== null &&
      locator.resolvedAt !== null &&
      new Date(locator.lastVerifiedAt).getTime() <
        new Date(locator.resolvedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["lastVerifiedAt"],
        message: "lastVerifiedAt cannot precede resolvedAt",
      });
    }

    if (locator.kind === "BOOK") {
      if (locator.pageEnd !== null && locator.pageStart === null) {
        context.addIssue({
          code: "custom",
          path: ["pageEnd"],
          message: "pageEnd requires pageStart",
        });
      }
      if (
        locator.pageStart !== null &&
        locator.pageEnd !== null &&
        locator.pageEnd < locator.pageStart
      ) {
        context.addIssue({
          code: "custom",
          path: ["pageEnd"],
          message: "pageEnd cannot precede pageStart",
        });
      }
      if (
        locator.status === "VERIFIED_EXACT" &&
        (locator.editionId === null || locator.pageStart === null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["editionId"],
          message:
            "VERIFIED_EXACT book locators require editionId and pageStart",
        });
      }
      if (
        locator.status === "VERIFIED_APPROXIMATE" &&
        (locator.editionId === null ||
          (locator.pageStart === null &&
            locator.chapter === null &&
            locator.section === null))
      ) {
        context.addIssue({
          code: "custom",
          path: ["editionId"],
          message:
            "VERIFIED_APPROXIMATE book locators require an edition and a bounded location",
        });
      }
    }

    if (locator.kind === "VIDEO" || locator.kind === "PODCAST") {
      if (
        locator.timestampEndMs !== null &&
        locator.timestampStartMs === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["timestampEndMs"],
          message: "timestampEndMs requires timestampStartMs",
        });
      }
      if (
        locator.timestampStartMs !== null &&
        locator.timestampEndMs !== null &&
        locator.timestampEndMs < locator.timestampStartMs
      ) {
        context.addIssue({
          code: "custom",
          path: ["timestampEndMs"],
          message: "timestampEndMs cannot precede timestampStartMs",
        });
      }
      if (isVerified && locator.timestampStartMs === null) {
        context.addIssue({
          code: "custom",
          path: ["timestampStartMs"],
          message: "Verified time-based locators require timestampStartMs",
        });
      }
    }

    if (locator.kind === "ARTICLE" || locator.kind === "WEBPAGE") {
      const hasStructuralLocation =
        locator.headingPath.length > 0 ||
        locator.paragraphIndex !== null ||
        locator.textFragmentUrl !== null;

      if (
        locator.status === "VERIFIED_EXACT" &&
        (locator.textFingerprint === null || !hasStructuralLocation)
      ) {
        context.addIssue({
          code: "custom",
          path: ["textFingerprint"],
          message:
            "VERIFIED_EXACT web locators require a fingerprint and structural location",
        });
      }
      if (locator.status === "VERIFIED_APPROXIMATE" && !hasStructuralLocation) {
        context.addIssue({
          code: "custom",
          path: ["headingPath"],
          message:
            "VERIFIED_APPROXIMATE web locators require a structural location",
        });
      }
    }

    if (
      ["PDF", "ARCHIVE", "OFFICIAL_RECORD", "SCREENPLAY"].includes(
        locator.kind,
      ) &&
      isVerified
    ) {
      const paginated = locator as z.infer<
        | typeof PdfLocatorSchema
        | typeof ArchiveLocatorSchema
        | typeof OfficialRecordLocatorSchema
        | typeof ScreenplayLocatorSchema
      >;
      const hasBoundedLocation =
        paginated.pageIndex !== null ||
        paginated.printedPageLabel !== null ||
        paginated.section !== null ||
        paginated.heading !== null;

      if (!hasBoundedLocation) {
        context.addIssue({
          code: "custom",
          path: ["pageIndex"],
          message: "Verified paginated locators require a bounded location",
        });
      }

      if (
        locator.status === "VERIFIED_EXACT" &&
        paginated.pageIndex === null &&
        paginated.printedPageLabel === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["pageIndex"],
          message:
            "VERIFIED_EXACT paginated locators require a page index or printed page label",
        });
      }
    }
  },
);

export const EvidenceConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const EvidenceFragmentSchema = z
  .object({
    id: EntityIdSchema,
    caseId: EntityIdSchema,
    sourceId: EntityIdSchema,
    snapshotId: EntityIdSchema,
    locatorId: EntityIdSchema,
    finding: z.string().trim().min(1).max(4_000),
    shortQuote: z.string().trim().min(1).max(500).nullable(),
    whySurfaced: z.string().trim().min(1).max(2_000),
    limitations: z.array(z.string().trim().min(1).max(1_000)).max(30),
    confidence: EvidenceConfidenceSchema,
    reviewState: ReviewStateSchema,
    origin: RecordOriginSchema,
    createdByRunId: EntityIdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const ClaimEpistemicKindSchema = z.enum([
  "FACTUAL_CLAIM",
  "ATTRIBUTED_ACCOUNT",
  "INTERPRETATION",
  "QUESTION",
  "UNCERTAINTY",
  "CONNECTION_PROPOSAL",
  "CREATIVE_DIRECTION",
]);

export const ClaimAssessmentStateSchema = z.enum([
  "UNASSESSED",
  "STRONG_SUPPORT",
  "SUPPORTED_WITH_LIMITATIONS",
  "CONTESTED",
  "WEAKLY_SUPPORTED",
  "UNRESOLVED",
]);

export const ClaimRecordSchema = z
  .object({
    id: EntityIdSchema,
    caseId: EntityIdSchema,
    branchId: EntityIdSchema.nullable(),
    statement: z.string().trim().min(1).max(4_000),
    epistemicKind: ClaimEpistemicKindSchema,
    assessmentState: ClaimAssessmentStateSchema,
    confidenceLanguage: z.string().trim().min(1).max(1_000),
    reviewState: ReviewStateSchema,
    origin: RecordOriginSchema,
    createdByRunId: EntityIdSchema.nullable(),
    supersedesClaimId: EntityIdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const ClaimEvidencePolaritySchema = z.enum([
  "SUPPORTS",
  "CONTRADICTS",
  "CONTEXTUALIZES",
]);

export const ClaimEvidenceEdgeSchema = z
  .object({
    id: EntityIdSchema,
    caseId: EntityIdSchema,
    claimId: EntityIdSchema,
    evidenceId: EntityIdSchema,
    polarity: ClaimEvidencePolaritySchema,
    rationale: z.string().trim().min(1).max(2_000),
    limitations: z.array(z.string().trim().min(1).max(1_000)).max(30),
    reviewState: ReviewStateSchema,
    origin: RecordOriginSchema,
    createdByRunId: EntityIdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type SourceMedium = z.infer<typeof SourceMediumSchema>;
export type AccessState = z.infer<typeof AccessStateSchema>;
export type RightsState = z.infer<typeof RightsStateSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
export type LocatorStatus = z.infer<typeof LocatorStatusSchema>;
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
export type EvidenceFragment = z.infer<typeof EvidenceFragmentSchema>;
export type ClaimRecord = z.infer<typeof ClaimRecordSchema>;
export type ClaimEvidenceEdge = z.infer<typeof ClaimEvidenceEdgeSchema>;
