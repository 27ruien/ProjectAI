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

For a real approved board URL:

```bash
WECOM_TASK_BOARD_URL=https://approved.example/path npm run extension:package
```

Load `dist/wecom-timesheet-extension` through Chrome's “Load unpacked” action.
Use the options page to save the exact board URL and reviewed selector config.
Start with Dry Run. Clearing local sync history requires a second confirmation
and never deletes tasks from the target board.

The default review build has no WeCom optional host permission and therefore
cannot operate on a real WeCom page. A publishable build requires the exact
user-provided HTTPS board Origin and a selector review after the user manually
logs in and demonstrates one task creation. Never use `<all_urls>`, guess a
production selector, or commit `selector-config.local*`.

Runtime flow:

```text
strict ProjectAI message → persistent queue → exact WeCom Origin
→ login/overlay/iframe checks → exact field matching → Dry Run or one-item save
→ explicit page feedback → local state + authenticated ProjectAI summary
```

Popup manual JSON is a test/recovery entry, not a cryptographic ProjectAI
attestation. Use only exported, user-reviewed fictional test payloads during
acceptance. `saved` items are skipped, `failed` items require an explicit
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
