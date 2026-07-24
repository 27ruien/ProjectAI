# WeCom Timesheet Connector v0.1.0

Chrome Manifest V3 connector for ProjectAI-confirmed daily timesheets.

The extension validates the versioned payload, stores idempotency state in
`chrome.storage.local`, fills one task at a time, and can save each individual
task after explicit user confirmation in ProjectAI. It never has a selector or
command for the outer daily-report/task-board final submit button.

The committed selector file is a Mock example only. A real
`WECOM_TASK_BOARD_URL` and selector configuration must be captured after the
user logs in and demonstrates the manual flow. Credentials, cookies, QR codes,
page HTML, and real selector configuration must not be committed.

Build:

```bash
npm run extension:build
npm run extension:package
```

Mock build:

```bash
npm run extension:build:mock
```

For a real approved board URL, keep the full URL in the ignored local UAT
configuration and use the guarded builder:

```bash
npm run uat:wecom:build
```

Load `dist/wecom-timesheet-extension` through Chrome's “Load unpacked” action.
Use the options page to save the exact board URL and reviewed selector config.
If the approved board requires query or fragment access parameters, they stay
only in the ignored local environment and `chrome.storage.local`; the build
validates the Origin and never embeds the path or access parameters in its
bundle, manifest, bindings, logs, or review ZIP.
Start with Dry Run. Clearing local sync history requires a second confirmation
and never deletes tasks from the target board.

The default Review build declares only the exact ProjectAI and WeCom Origins;
it does not embed a private board path, access parameter, or real Selector and
therefore cannot execute a real sync. The UAT builder remains diagnostics-only
until the ignored `.local/wecom-selector.local.json` passes review. A
publishable build requires the exact user-approved HTTPS Origin and a selector
review after the user manually logs in and demonstrates one task creation.
Never request a broad all-sites host pattern, guess a production selector, or
commit `selector-config.local*`.

The extension requests only `storage` and `tabs`: `storage` persists the local
idempotency queue and approved settings; `tabs` finds or opens the exact board,
reports connection state, and supports explicit recovery after a Service Worker
restart. It does not request `scripting`, cookies, history, downloads, clipboard,
webRequest, or broad host access. Content scripts are declaratively restricted
to the exact ProjectAI paths and the exact WeCom Origin.

Runtime flow:

```text
strict ProjectAI message → persistent queue → exact WeCom Origin
→ exact target pathname + login/overlay/iframe checks → exact field matching
→ Dry Run or one-item save → explicit feedback + saved-row readback
→ local state + authenticated ProjectAI summary
```

The adapter keeps ProjectAI category internal, writes separate regular/overtime
hours, and only reads the page-provided current submitter. Auto-save pages are
rejected before any field mutation until they have a separately reviewed flow.

Popup manual JSON is a test/recovery entry, not a cryptographic ProjectAI
attestation. Review and real-origin builds therefore force that entry to Dry
Run; actual saves must start from the authenticated ProjectAI page. Only the
isolated Mock build can exercise a manual non-Dry-Run payload. The Service
Worker also validates the sending extension page or ProjectAI tab before it
accepts mutations. Use only exported, user-reviewed fictional test payloads
during acceptance. `saved` items are
skipped, `failed` items require an explicit
resume, and `unknown` items cannot resume until the user reconciles the board.
After checking WeCom, the Popup requires an explicit confirmation to resolve an
unknown item as saved or not saved; the latter still requires a separate resume.

Tests:

```bash
npm run test:timesheets
npm run extension:package
npm run test:extension-package
npm run test:extension-e2e
```

See `docs/wecom-selector-configuration.md`, `docs/wecom-dry-run.md`,
`docs/manual-acceptance-checklist.md`, `PRIVACY_POLICY_DRAFT.md`,
`CHROME_PERMISSION_JUSTIFICATION.md`, and `SECURITY_THREAT_MODEL.md`.
