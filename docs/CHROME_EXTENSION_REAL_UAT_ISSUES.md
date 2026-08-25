# Chrome Extension Real UAT Issues

Last Updated: 2026-08-25

## EXT-UAT-001 — DeepSeek latest-response extraction lost document sections

| Field | Record |
|---|---|
| Site | DeepSeek (`https://chat.deepseek.com/`) |
| Severity | **Medium** — injection and generation worked, but the captured artifact was incomplete |
| Status | **FIXED / REGRESSION VERIFIED** in Extension v0.1.1, commit `9327c16e578f5ed63e9a54b5841553a05ad63d1e`, tag `staging-validation-v1.2.1` |
| Exact step | After the final answer completed, open the Extension and click **Refresh** under **Latest assistant response** |
| Expected | Preview contains the complete newest assistant block, including headings and the Requirement Matrix, and contains no user or older assistant message |
| Actual before fix | Preview selected the newest reply but returned only 5,072 characters and omitted headings plus the Requirement Matrix visible on the page |
| Screenshot | `docs/ui-audit/chrome-extension-real-uat/09-deepseek-preview-truncated.png` |
| Saved failure | `docs/ui-audit/chrome-extension-real-uat/results/deepseek-extraction-failure.md` |
| Relevant adapter/selectors | `chrome-extension/src/content/deepseek-adapter.js`; generic `[class*='markdown']` fragments were considered ahead of the full connected assistant block |
| Console/runtime error | None observed; Chrome showed no Extension runtime error |
| Reproducibility | **1/1** on the initial signed-in live DeepSeek run |
| Root cause | **CONFIRMED by live DOM behavior and repair regression**: nested Markdown fragments were treated as standalone assistant candidates, so extraction stopped before the complete assistant container |
| Proposed minimal fix | Let the DeepSeek adapter prefer the full assistant-block fallback and preserve its readable `innerText`; keep the shared default behavior unchanged for other sites |
| Code change required | **YES** |

### Repair and verification

The fix added the bounded adapter options
`preferAssistantBlockFallback` and `preserveAssistantBlockText`, enabled them
only for DeepSeek, and added a regression test that requires headings and the
matrix to survive extraction.

The original failure evidence was retained. After the change:

- complete validation passed: **103/103**, typecheck, lint, build, and
  whitespace checks;
- branch CI run `32816033713` passed on exact commit `9327c16...`;
- immutable tag CI run `32816208604` passed on the same exact commit;
- the first repaired live extraction returned 6,830 characters with readable
  sections and matrix;
- a fresh post-CI conversation returned 11,531 characters and passed Preview,
  Copy, Download, Save, and Export.

Repair evidence:

- `docs/ui-audit/chrome-extension-real-uat/15-deepseek-preview-fixed.png`
- `docs/ui-audit/chrome-extension-real-uat/16-deepseek-fixed-with-skill-metadata.png`
- `docs/ui-audit/chrome-extension-real-uat/17-deepseek-fixed-result-saved.png`
- `docs/ui-audit/chrome-extension-real-uat/18-deepseek-post-ci-injected.png`
- `docs/ui-audit/chrome-extension-real-uat/19-deepseek-post-ci-final-response.png`
- `docs/ui-audit/chrome-extension-real-uat/20-deepseek-post-ci-preview.png`
- `docs/ui-audit/chrome-extension-real-uat/21-deepseek-post-ci-result-exported.png`

Remaining action: **NONE for the tested adapter chain**.
