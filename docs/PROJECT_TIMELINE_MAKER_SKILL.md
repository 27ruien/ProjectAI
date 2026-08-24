# Project Timeline Maker Skill

## Positioning

`project-timeline-maker` `0.1.0` is an experimental, portable Skill that turns
user-supplied unstructured project materials into one reviewable Structured
Timeline Draft. It is independent of the Weekly Report Skill.

The Agent understands the supplied materials and performs bounded planning.
Project AI remains responsible for authenticated project binding, validation,
version control, permissions, persistence, and the Timeline Core. The Skill
does not access RAGFlow, Project Knowledge, raw database structures, or a direct
save path.

## Inputs

The input can contain a Project Brief, Scope, meeting notes, customer email,
proposal, requirement document, natural-language description, or plan draft.
Only facts in those user-supplied materials may be treated as confirmed.

The Skill may identify project type, deliverables, channels, platforms, user
journey, design and development needs, integrations, data and biometric scope,
campaign mechanics, hardware, localization, compliance inputs, launch/UAT
dates, dependencies, and supplied owners. These are optional characteristics,
not a mandatory flat form.

## One draft, two delivery modes

Both execution modes use the same `TimelineMakerDraft` contract:

```text
user-supplied materials
  -> project understanding
  -> controlled requirement check
  -> confirmed fact / requirement gap / planning assumption
  -> Structured Timeline Draft
       -> business capability request, or
       -> deterministic Markdown renderer
```

Tool Mode defines only the business capabilities
`get_project_timeline`, `create_timeline_draft`, and
`propose_timeline_update`. It does not implement an Agent Runtime or connector.
The server must still authorize the user/project, validate the schema, and
enforce the reviewed Timeline version.

Chat-only Mode renders a fixed Markdown contract. The implemented parser
validates that contract deterministically and maps it to a Workbench Snapshot
without a second AI call.

## Workbench compatibility

The Draft adapter reuses the repository's current Timeline Workbench Snapshot
instead of inventing a second persistence schema:

| Draft/Workbench meaning | Current Snapshot field |
|---|---|
| Task ID | `id` |
| Phase | `stage` |
| Task title | `name` |
| Explicit owners | `owners[]` |
| Status | `incomplete` or `done` |
| Start date | `start` |
| End date | `end` |
| Language | `language` |
| Status visibility | `includeStatus` |

Dates use `YYYY-MM-DD`; unknown stage, owner, start, or end values use the
existing Workbench empty value. Basis, requirement, and assumption metadata
exist only in the Draft and are not added to the persisted Snapshot.

## Controlled requirement framework

After free project understanding, the Agent selects only relevant controlled
domains. The first catalog covers:

- Campaign/Event, rewards, coupons, and redemption;
- Personal Information and third-party sharing;
- Photo/Face/Biometric processing;
- Visual Design and localization inputs;
- Development, integration, API, authentication, test environment, and hosting;
- Launch, UAT, acceptance, approval, and production configuration;
- Hardware, installation environment, network, and responsible party.

Each triggered requirement is exactly `CONFIRMED`, `MISSING`, `UNCLEAR`, or
`NOT_APPLICABLE`. `CONFIRMED` requires supplied evidence. A missing or unclear
input may become a prerequisite task with an explanation, but the Skill cannot
invent the missing rule, policy, owner, legal conclusion, or technical value.

The catalog is a Skill reference and a small deterministic library over an
Agent-classified feature set. It is not a keyword matcher, rules DSL, database
engine, or replacement for project understanding.

## Fact, gap, and assumption

Every phase and task has one Draft-only basis:

- `confirmed`: explicitly supplied fact, date, task, dependency, or owner;
- `requirement_gap`: a missing/unclear prerequisite tied to a requirement ID;
- `inferred`: bounded planning needed to form a useful draft, tied to a named
  Planning Assumption.

Confirmed dates are immutable inputs. An inferred date cannot conflict with
them or create a new client deadline. Missing dates and owners may remain empty.
A milestone-like task is allowed only when the source explicitly identifies a
Launch, Go-live, UAT completion, client approval, campaign start, or delivery
deadline as a key node.

## Markdown fallback

The output starts with `# Project Timeline` and contains fixed tables for
metadata, requirements, phases, planning assumptions, warnings, and tasks. It
uses one task per row, `/` for empty values, `<br>` for lists, raw enum values,
and no preamble, postamble, or code fence.

The parser performs structural and schema validation and produces the current
Workbench Snapshot Draft. Unsupported prose, malformed columns, invalid dates,
invalid status values, dangling requirement/assumption references, and
untraceable inferred/gap tasks are rejected.

## Existing Timeline safety

For a project without a Timeline, the capability contract accepts only a new
draft with no existing version. For a project with a Timeline, it accepts only
a proposed update bound to the version that was reviewed. It never exposes a
silent overwrite operation.

The intended future apply flow remains:

```text
Existing Timeline + Proposed Draft -> Diff -> User Confirmation -> Apply
```

This iteration stops at Draft/Proposed Changes. UI paste integration is
deferred because the current Slim source contains no small existing Timeline
Workbench paste/import surface to extend safely.
