# Chrome Extension Real Full-Chain UAT Guide

Last Updated: 2026-08-25

## START HERE — business-quality UAT

The technical full chain is now manually verified with Computer Use. The user
can focus on judging the business output and does not need to discover,
reproduce, screenshot, or document adapter problems.

1. Open `https://gridworks.cn/tool/projectai-slim-uat/` and use the normal
   Staging login.
2. Load or reload the unpacked Extension from
   `/Users/ryan/Documents/ProjectAI-Focused-MVP/chrome-extension`.
3. Sync Skills on the Project AI page and select
   `project-requirement-analyst v0.1.0`.
4. Use the same approved task/materials in fresh ChatGPT, DeepSeek, and Qwen
   chats; inspect the injected content, then send through the site's native UI.
5. Refresh, Save, and Export each result. Judge business quality only.

If a technical step fails or a third-party page changes, stop that site and
hand the task back to Codex/operator. Do not spend time finding selectors,
collecting console logs, reproducing the issue, or writing the defect record.
The preserved technical evidence and current issue history are in
`docs/CHROME_EXTENSION_REAL_UAT_REPORT.md` and
`docs/CHROME_EXTENSION_REAL_UAT_ISSUES.md`.

## Readiness boundary

This guide covers the intended manual path:

```text
Project AI authenticated Skill read
  -> Extension session sync and selection
  -> external Agent injection
  -> manual send
  -> latest assistant response capture
  -> explicit local save/export
```

The exact v1.2 server and v0.1.1 Extension completed this path on signed-in
ChatGPT, DeepSeek, and Qwen on 2026-08-25. This verifies the transport/capture
chain, not Requirement Analyst answer quality. Third-party DOMs and login
Sessions can change, so a future failure must be recorded as a new technical
UAT issue rather than delegated to the business user.

## Install or reload the Extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. If this is the first install, click **Load unpacked** and select the
   repository `chrome-extension/` directory.
4. If it is already installed, click **Reload** on **Project AI Skill UAT
   Adapter**.
5. Pin the Extension if desired.

Expected: Chrome accepts the manifest. The Extension has `activeTab`, `storage`,
the three exact chat hosts, and only the reviewed Project AI Staging path. It
does not request `cookies`.

## STEP 1 — Open and log in to Project AI Staging

Open:

`https://gridworks.cn/tool/projectai-slim-uat/`

Log in with the separately provided test account. Do not place a password,
cookie, Session token, API key, or customer data in UAT evidence.

Expected: the normal Project AI page remains logged in after navigation or
refresh.

## STEP 2 — Sync official Skills from Project AI

While the active tab is still on the logged-in Project AI Staging page:

1. Open **Project AI Skill UAT Adapter**.
2. Confirm the badge says **Project AI: Sync ready**.
3. Click **Sync Skills from Project AI**.

Expected: the Skill dropdown displays repository-derived metadata for exactly:

- `project-weekly-report` v1.2.0;
- `project-timeline-maker` v0.1.0;
- `project-requirement-analyst` v0.1.0;
- `project-feasibility-research` v0.1.0.

The popup also shows **Last synced**, the selected Skill status, and
`source = Project AI`.

If the popup reports `PROJECT_AI_UNAUTHENTICATED`, log in on that same Staging
page and click Sync again. Do not copy a cookie or token into the Extension.
If it reports an API or invalid-response diagnostic, stop the full-chain run
and record the exact diagnostic; use the manual fallback only to isolate whether
the remaining chat adapter still works.

## STEP 3 — Select the first smoke Skill

Choose:

`project-requirement-analyst v0.1.0`

Expected: the selection is stored in `chrome.storage.session`. Closing and
reopening the popup, or switching tabs, keeps this Skill selected for the same
browser session. Its text is not written to long-lived result storage.

## STEP 4 — Open one new external-Agent conversation

Run the following flow separately on:

- ChatGPT: `https://chatgpt.com/`
- DeepSeek: `https://chat.deepseek.com/`
- Qwen: `https://chat.qwen.ai/`

Log in using the site's normal UI and start a new empty conversation. If the
case requires attachments, upload them using that site's native upload control.
The Extension does not upload files.

Expected: reopening the Extension shows the same synced Skill and the current
site as **Supported**.

## STEP 5 — Add one real, sanitized task and inject

1. Enter the same real or sanitized requirement in **Task Instruction**.
2. Click **Inject into current chat**.
3. Inspect the external Agent composer before sending.

Expected exact shape:

```text
<SKILL>
{exact SKILL.md returned by Project AI}
</SKILL>

<USER_TASK>
{exact Task Instruction entered by the user}
</USER_TASK>
```

The Skill body must not be rewritten, shortened, or supplemented. No persona,
model role, answer judge, or prompt suffix is added. The Extension must not
send the message.

If the site needs an attachment, attach it in the site's native UI after
checking that the same approved/sanitized material will be used on every Agent.

## STEP 6 — Send manually

After checking the complete composer, click the site's normal Send button or
use its normal manual keyboard action.

Expected: the message is sent only by the user's action. The Extension exposes
no auto-send control.

## STEP 7 — Capture and save the latest response

Wait until the Agent finishes. Reopen the Extension and:

1. Click **Refresh** under **Latest assistant response**.
2. Confirm the preview matches only the newest non-empty assistant answer.
3. Click **Copy Result** and verify the copied text is unchanged.
4. Click **Download .md** and verify the downloaded body is unchanged.
5. Optionally enter a short **Task Label** and **Notes**.
6. Click **Save UAT Result locally**.

Expected saved fields include `skillId = project-requirement-analyst`,
`skillVersion = 0.1.0`, `skillSource = project_ai`, the current Agent/site,
timestamp, sanitized origin/path, and `rawResponse`. Closing the popup after
injection must not turn the synced Skill metadata into `null`.

The Skill body and Task Instruction are not saved with the result.

## STEP 8 — Repeat on another Agent with the same inputs

Open a new conversation on the next Agent site. Keep the selected synced Skill
and reuse the exact same Task Instruction and approved attachments. Repeat
Steps 5–7.

Expected: only the Agent/site and returned answer vary. The selected Skill ID,
version, source, Task Instruction, and attachments remain comparable.

## STEP 9 — Export for Cross-Agent comparison

After completing the selected sites:

1. Click **Export JSON**.
2. Confirm `schemaVersion`, `resultCount`, and every full saved result are
   present.
3. Click **Export Summary**.
4. Confirm the Markdown table lists timestamp, site, Skill, source, task label,
   response length, and notes.

Expected: JSON contains the raw responses; the summary remains concise. Neither
export contains cookies, tokens, Skill text, Task Instruction, query strings,
or URL fragments.

## Manual fallback for diagnosis only

Open **Advanced / Manual fallback**, enable the manual toggle, and paste one
exact `SKILL.md`. This can separate a Project AI sync defect from a chat adapter
defect. A fallback success does not count as full-chain Project AI Sync UAT.

## Per-site acceptance record

| Site | Status | Project AI sync | Exact injection | Manual send only | Latest response exact | Copy | Download | Save metadata | Export | Diagnostic / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| ChatGPT | MANUAL VERIFIED | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Computer Use, signed-in live DOM, 2026-08-25 |
| DeepSeek | MANUAL VERIFIED AFTER FIX | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `EXT-UAT-001` fixed in v0.1.1; fresh post-CI rerun PASS |
| Qwen | MANUAL VERIFIED | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Computer Use, signed-in live DOM, 2026-08-25 |

Use **PASS** only after the exact signed-in flow passes. Use **BLOCKED** when
login, missing Staging deployment, or a live DOM mismatch prevents the flow.
Deterministic tests are not a substitute for this record; the table above is
backed by the real evidence report and screenshots.
