# Project AI Slim Staging UAT Issues

## UAT-001 — Login redirected to retired `/assistant`

- Severity: P1
- Status: RESOLVED and deployed
- Observed: Credential authentication succeeded, but a login without `returnTo` opened the retired `/assistant` route and showed 404.
- Cause: The shared safe return-to helper still used the pre-Slim default and route allowlist.
- Resolution: Default changed to `/projects`; allowlist now matches the retained Slim Projects, Organization, and Settings routes. External and retired return targets continue to fall back safely.
- Verification: Unit tests, local build, standalone proxy tests, and a fresh browser login all passed on build `uat-20260821T0745Z`.

## UAT-002 — Deployment source contained an unintended local environment file

- Severity: P0 risk, contained before build
- Status: RESOLVED
- Observed: The first source synchronization included a local environment file in the restricted remote source directory.
- Containment: It was detected and removed before the image build. `.dockerignore` excludes `.env` and `.env.*`; the runtime image and Git evidence contain no environment file or secret content.
- Follow-up: Future synchronization should use an explicit exclude list before transferring any source.

## UAT-003 — Existing dependency audit findings

- Severity: P2
- Status: OPEN, non-blocking for this bounded UAT
- Observed: The remote `npm ci` audit summary reported 18 existing findings: 1 low, 6 moderate, and 11 high.
- Impact: Build, tests, browser UAT, and live integration passed; no automatic dependency upgrade was attempted because it is outside this Staging delivery scope.
- Follow-up: Run a separate dependency review with compatibility testing before Production release consideration.

## UAT-004 — Nginx available/enabled files are independent copies

- Severity: P2 operational
- Status: RESOLVED for this UAT route
- Observed: `/etc/nginx/sites-enabled/timeline-maker` is not a symlink to the file in `sites-available`; changing only the latter does not affect the active server.
- Resolution: The active file was separately backed up outside `sites-enabled`, amended with only the UAT locations, validated by `nginx -t`, and then reloaded.
- Follow-up: Keep future Nginx backups outside directories included by `nginx.conf`.
