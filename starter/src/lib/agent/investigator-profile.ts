import { z } from "zod";

export const InvestigationModeSchema = z.enum([
  "documentary_researcher",
  "film_historian",
  "filmmaker_adaptation",
  "forensic_fact_check",
  "interpretation_lab",
  "open_rabbit_hole",
]);

export const InvestigatorCalibrationSchema = z.object({
  mode: InvestigationModeSchema,
  pace: z.number().int().min(0).max(4),
  depth: z.number().int().min(0).max(4),
  sourceStrictness: z.number().int().min(0).max(4),
  interventionFrequency: z.number().int().min(0).max(4),
  challengeLevel: z.number().int().min(0).max(4),
  narrativeDensity: z.number().int().min(0).max(4),
  citationVisibility: z.enum(["quiet", "standard", "always"]),
  spoilerPolicy: z.enum(["avoid", "warn", "full"]),
});

export type InvestigationMode = z.infer<typeof InvestigationModeSchema>;
export type InvestigatorCalibration = z.infer<typeof InvestigatorCalibrationSchema>;

export const DEFAULT_CALIBRATION: InvestigatorCalibration = {
  mode: "open_rabbit_hole",
  pace: 2,
  depth: 2,
  sourceStrictness: 2,
  interventionFrequency: 2,
  challengeLevel: 2,
  narrativeDensity: 2,
  citationVisibility: "standard",
  spoilerPolicy: "warn",
};

export const MODE_PRESETS: Record<InvestigationMode, InvestigatorCalibration> = {
  documentary_researcher: {
    ...DEFAULT_CALIBRATION,
    mode: "documentary_researcher",
    depth: 3,
    sourceStrictness: 4,
    challengeLevel: 4,
    narrativeDensity: 3,
    citationVisibility: "always",
  },
  film_historian: {
    ...DEFAULT_CALIBRATION,
    mode: "film_historian",
    pace: 1,
    depth: 4,
    sourceStrictness: 4,
    interventionFrequency: 2,
    citationVisibility: "always",
  },
  filmmaker_adaptation: {
    ...DEFAULT_CALIBRATION,
    mode: "filmmaker_adaptation",
    depth: 3,
    sourceStrictness: 3,
    challengeLevel: 3,
    narrativeDensity: 3,
  },
  forensic_fact_check: {
    ...DEFAULT_CALIBRATION,
    mode: "forensic_fact_check",
    pace: 3,
    depth: 4,
    sourceStrictness: 4,
    interventionFrequency: 3,
    challengeLevel: 4,
    narrativeDensity: 1,
    citationVisibility: "always",
  },
  interpretation_lab: {
    ...DEFAULT_CALIBRATION,
    mode: "interpretation_lab",
    pace: 1,
    depth: 4,
    sourceStrictness: 3,
    interventionFrequency: 2,
    challengeLevel: 4,
    narrativeDensity: 3,
  },
  open_rabbit_hole: DEFAULT_CALIBRATION,
};

export function mergeCalibration(
  mode: InvestigationMode,
  temporaryOverrides: Partial<InvestigatorCalibration> = {},
  approvedPersistentOverrides: Partial<InvestigatorCalibration> = {},
): InvestigatorCalibration {
  const merged = {
    ...MODE_PRESETS[mode],
    ...approvedPersistentOverrides,
    ...temporaryOverrides,
    mode,
  };

  return InvestigatorCalibrationSchema.parse(merged);
}
