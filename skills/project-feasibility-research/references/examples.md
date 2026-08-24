# Feasibility Research Examples

These are synthetic classification examples, not completed research.

## Evidence grading

- Official platform documentation for a browser API limit: `A_PRIMARY` for
  that limit.
- Independent laboratory comparison with disclosed method: usually
  `B_AUTHORITATIVE_SECONDARY`.
- Vendor page saying its solution is “enterprise-ready”: `C_MARKET` for the
  positioning; it is not proof of readiness.
- Practitioner issue describing a device-specific failure: `D_COMMUNITY`,
  useful as a contradiction lead.
- “This may require a fallback flow” derived from several sources:
  `E_INFERENCE`, with no invented URL.

## Contradiction query

Positive claim: “A browser-only approach supports all target devices.”

Valid counter-search intent: identify unsupported browser/device combinations,
permission failures, performance limits, and official compatibility gaps.

Invalid counter-search: repeat “browser approach supports all devices” and
collect more positive summaries.

## Verdict discipline

If official compatibility is verified but the target device model and onsite
network remain unknown, a recommendation may be `CONDITIONAL_GO` with those
Unknowns as explicit conditions. Do not issue `GO` merely because a vendor demo
works.
