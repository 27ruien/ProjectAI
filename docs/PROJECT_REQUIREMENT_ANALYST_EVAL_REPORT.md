# Project Requirement Analyst Eval Report

## Result

**SKILL VERSION: `0.2.1`**

**DETERMINISTIC STATUS: PASS**

**FORMAL EIGHT-CASE WEB-AI UAT: NOT_TESTED**

**REAL THREE-SITE SMOKE: PASS**

## Automated evidence

| Check | Result |
|---|---|
| Required representative Cases | 9 / 9 PASS |
| Contract/renderer negative controls | 2 / 2 PASS |
| Portable-pack synchronization | 1 / 1 PASS |
| Requirement Analyst test module | 12 / 12 PASS |
| Full repository `npm test` | 105 / 105 PASS (98 unit + 7 rendered/proxy) |
| Typecheck / Lint / Build / `git diff --check` | PASS / PASS / PASS / PASS |
| Official Skill distribution metadata | `project-requirement-analyst@0.2.1` PASS |

The deterministic tests now cover:

- core business concept rows with evidence references;
- ordered user flow with visible notes;
- the fixed Functional Scope Markdown columns;
- unresolved status for unsupported candidate functionality;
- parent-linked text Information Architecture derived from Functional Scope;
- all thirteen Simplified Chinese output sections;
- Simplified Chinese display labels for controlled domains, scope dispositions,
  and coverage states while preserving machine-readable contract values;
- downstream Feasibility Research acceptance of Requirement Analysis Pack v2;
- no image or Mermaid output from the deterministic renderer.

## Findings

The v2 Contract rejects untraceable Facts, incomplete controlled-framework
coverage, silent Gap confirmation, committed Gap/Assumption scope, missing Gap
questions, invalid scope boundaries, Information Architecture that is not
derived from Functional Scope evidence, and unconfirmed assumption-based next
steps.

The output order now places usable product artifacts before the evidence and Gap
inventory. This addresses the previous failure mode where the analysis listed
many unknowns without first producing a usable concept model, flow, scope table,
and information hierarchy.

## Real web-AI smoke

The exact Staging Skill `project-requirement-analyst@0.2.1` was synced through
the unpacked Extension and executed in signed-in ChatGPT, DeepSeek, and Qwen
web conversations using the same sparse member-campaign brief.

All three final answers included Simplified Chinese headings, core business
concepts, a user flow, the fixed functional-scope table, a text information
architecture, and visible pending-confirmation notes for unsupported core-flow
candidates. A response-only accessibility-tree scan found zero occurrences of
English controlled-domain labels or English state enums. Injection remained
manual-send only.

This is one real cross-platform smoke task. It validates the requested output
shape and language behavior, but it is not substituted for the eight formal
portable cases or a business-quality score.

## Remaining external coverage gap

The eight formal portable packs have not been executed against current external
web AI models. Their status remains `NOT_TESTED`; deterministic PASS does not
prove long-document interpretation quality or cross-model consistency.

## Recommendation

Keep `project-requirement-analyst@0.2.1` experimental and execute all eight
formal portable cases before any promotion. The current Staging release is
ready for that Chinese full-chain UAT, subject to the separately recorded
Staging disk-capacity condition.
