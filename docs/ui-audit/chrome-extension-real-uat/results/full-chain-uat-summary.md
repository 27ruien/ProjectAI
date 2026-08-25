# Project AI Cross-Agent UAT Results

Exported: 2026-08-25T06:21:19.235Z
Result count: 5

| Timestamp | Site | Skill | Source | Task | Response length | Notes |
|---|---|---|---|---|---:|---|
| 2026-08-25T05:57:51.501Z | ChatGPT | project-requirement-analyst v0.1.0 | project_ai | ChatGPT requirement analyst smoke | 5060 | Computer Use real UAT; preview matched the newest assistant response. |
| 2026-08-25T06:00:27.334Z | DeepSeek | project-requirement-analyst v0.1.0 | project_ai | DeepSeek requirement analyst smoke - extraction defect | 5072 | EXT-UAT-001: newest response selected, but headings and Requirement Matrix were omitted from Preview. |
| 2026-08-25T06:03:10.458Z | Qwen | project-requirement-analyst v0.1.0 | project_ai | Qwen requirement analyst smoke | 2115 | Computer Use real UAT; preview matched the newest assistant response including the matrix. |
| 2026-08-25T06:11:52.653Z | DeepSeek | project-requirement-analyst v0.1.0 | project_ai | DeepSeek requirement analyst smoke - fixed | 6830 | EXT-UAT-001 fixed in Extension v0.1.1; full headings, matrix, and rendered spacing preserved. |
| 2026-08-25T06:21:16.856Z | DeepSeek | project-requirement-analyst v0.1.0 | project_ai | DeepSeek post-CI v1.2.1 regression | 11531 | Exact staging-validation-v1.2.1 Extension regression: full response, matrix, spacing, and metadata verified. |

Raw responses are included in the JSON export.
