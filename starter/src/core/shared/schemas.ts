import { z } from "zod";

export const EntityIdSchema = z.string().uuid();
export const OpaqueReferenceSchema = z.string().trim().min(1).max(512);
export const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const VersionTagSchema = z.string().trim().min(1).max(120);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Only HTTP(S) URLs are accepted");

export const ReviewStateSchema = z.enum([
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
  "RETRACTED",
]);

export const RecordOriginKindSchema = z.enum([
  "USER",
  "SOURCE",
  "HUMAN_CURATOR",
  "HUMAN_REVIEWER",
  "MODEL",
  "DETERMINISTIC_SYSTEM",
  "RESOLVER",
  "IMPORTER",
]);

export const RecordOriginSchema = z
  .object({
    kind: RecordOriginKindSchema,
    actorId: OpaqueReferenceSchema.nullable(),
    version: VersionTagSchema.nullable(),
  })
  .strict()
  .superRefine((origin, context) => {
    if (
      ["MODEL", "DETERMINISTIC_SYSTEM", "RESOLVER", "IMPORTER"].includes(
        origin.kind,
      ) &&
      origin.version === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["version"],
        message: `${origin.kind} origins require a version`,
      });
    }

    if (origin.kind === "USER" && origin.actorId === null) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "USER origins require an actorId",
      });
    }
  });

export type ReviewState = z.infer<typeof ReviewStateSchema>;
export type RecordOrigin = z.infer<typeof RecordOriginSchema>;
