import { z } from "zod";
import { feasibilityResearchDimensionSchema } from "./contracts";

export const feasibilityAbObservationSchema = z.object({
  runId: z.string().trim().min(1).max(120),
  method: z.enum(["ONE_PASS_BASELINE", "MULTI_PASS_SKILL"]),
  dimensionsCovered: z.array(feasibilityResearchDimensionSchema),
  firstPartySourceCount: z.number().int().nonnegative(),
  authoritativeSecondarySourceCount: z.number().int().nonnegative(),
  alternativesConsidered: z.number().int().nonnegative(),
  contradictionSearches: z.number().int().nonnegative(),
  blockerUnknownsIdentified: z.number().int().nonnegative(),
  verdict: z.enum(["GO", "CONDITIONAL_GO", "NO_GO", "NOT_READY"]),
  conclusionChangedAfterContradiction: z.boolean(),
}).strict();

export const feasibilityAbComparisonSchema = z.object({
  baseline: feasibilityAbObservationSchema,
  multiPass: feasibilityAbObservationSchema,
  deltas: z.object({
    dimensionCoverage: z.number().int(),
    firstPartySources: z.number().int(),
    alternatives: z.number().int(),
    contradictionSearches: z.number().int(),
    blockerUnknowns: z.number().int(),
  }).strict(),
  verdictChanged: z.boolean(),
}).strict();

export type FeasibilityAbObservation = z.infer<typeof feasibilityAbObservationSchema>;

export function compareFeasibilityResearchAb(
  baselineInput: FeasibilityAbObservation,
  multiPassInput: FeasibilityAbObservation,
) {
  const baseline = feasibilityAbObservationSchema.parse(baselineInput);
  const multiPass = feasibilityAbObservationSchema.parse(multiPassInput);
  if (baseline.method !== "ONE_PASS_BASELINE" || multiPass.method !== "MULTI_PASS_SKILL") {
    throw new Error("A/B comparison requires one baseline and one multi-pass observation");
  }
  return feasibilityAbComparisonSchema.parse({
    baseline,
    multiPass,
    deltas: {
      dimensionCoverage:
        new Set(multiPass.dimensionsCovered).size - new Set(baseline.dimensionsCovered).size,
      firstPartySources: multiPass.firstPartySourceCount - baseline.firstPartySourceCount,
      alternatives: multiPass.alternativesConsidered - baseline.alternativesConsidered,
      contradictionSearches: multiPass.contradictionSearches - baseline.contradictionSearches,
      blockerUnknowns:
        multiPass.blockerUnknownsIdentified - baseline.blockerUnknownsIdentified,
    },
    verdictChanged: baseline.verdict !== multiPass.verdict,
  });
}
