# Controlled Requirement Framework v0.1

Use this framework after freely understanding the supplied project materials.
It prevents omission; it must not be used as a keyword matcher or to invent a
default answer.

| Domain | Minimum checks |
|---|---|
| Business Goal | problem, desired business outcome, decision owner |
| User | primary user, beneficiary, stakeholder |
| Scenario | trigger, context, desired outcome, failure situation |
| Deliverable | artifact/service, handoff, acceptance owner |
| Success Metric | observable acceptance signal, measurement method, owner |
| Channel | platform, entry point, device/environment |
| Deadline | confirmed date, date owner, flexibility, dependency |
| Constraint | budget, time, technology, policy, operating constraint |
| User Journey | entry, main steps, error/recovery, completion |
| Functional Scope | must-have, out-of-scope, deferred, unresolved |
| Identity / Permission | identities, roles, read/write boundary, admin action |
| Data | fields, source, destination, ownership, retention, deletion |
| AI Behavior | input, output, evidence, uncertainty, failure, human review |
| Third-party Integration | API, authentication, test environment, limits, owner |
| Content / Assets | copy, visual, format, localization, delivery owner |
| Operations Rules | eligibility, exception, approval, manual operation |
| Test / Launch | test scope, UAT, acceptance, configuration, approval, rollback |
| Project Dependency | client input, internal input, sequence, responsible party |

## Coverage states

- `COMPLETE`: supplied Facts cover the current decision need.
- `PARTIAL`: at least one Fact exists and a meaningful Gap remains.
- `MISSING`: the domain is relevant but only a Gap can be stated.
- `ASSUMED`: the current draft depends on an explicit Assumption.
- `NOT_APPLICABLE`: supplied Facts explicitly establish non-applicability.

Do not mark a domain complete merely because a common industry default exists.

## Question priority

- `P0`: answer is required before committing scope, feasibility, architecture,
  price, sensitive-data handling, or launch.
- `P1`: answer materially changes flow, work volume, dependency, test, or
  acceptance but does not stop the immediate clarification round.
- `P2`: answer improves completeness, wording, or later implementation detail.

Priority is about decision impact. It is not a confidence score or severity
label for the project.
