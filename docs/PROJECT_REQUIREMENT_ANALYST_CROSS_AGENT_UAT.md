# Project Requirement Analyst Cross-Agent UAT

## Status

`NOT_TESTED`

## Packages

The eight independent packages are under
`tests/requirement-analyst-cross-agent/case-01` through `case-08`.

| Case | Focus |
|---|---|
| 01 | Sparse campaign expansion |
| 02 | User/scenario/journey separation |
| 03 | AI, data, permission, and human-review boundary |
| 04 | Third-party integration dependencies |
| 05 | Exact deadline and scope exclusions |
| 06 | Contradictory identity requirements |
| 07 | In/out/deferred scope boundary |
| 08 | Bounded assumptions and confirmation |

## Run one Case

Upload or provide only:

- `SKILL.md`
- `input.json`
- `RUN_INSTRUCTION.txt`

Do not upload `expected.json`; it is the human scoring truth source.

Run every Case in a fresh Agent conversation with no external project context.
Record the final Markdown, Agent name/version, date, and PASS/FAIL against every
must-have, forbidden claim, and global criterion in `expected.json`.

PASS requires all ten output sections, explicit Fact/Gap/Assumption labels,
prioritized questions, full controlled-domain assessment, no invented fact, and
no hidden external Project knowledge. Formatting alone cannot make a Case pass.
