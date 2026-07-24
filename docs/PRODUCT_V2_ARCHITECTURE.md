# Product V2 Architecture

Product V2 narrows the product shell to project-manager knowledge work while preserving the existing project-scoped authorization and AI Gateway boundaries. This document describes the implemented contract; current Head, CI run, Staging image, backup name, and UAT evidence remain dynamic PR facts.

## Identity boundary

- Product pages never accept an email or password. The only visible providers are `wecom` and `mock-wecom`.
- Formal environments are configured for WeCom OAuth/QR. The adapter intentionally remains disabled until the corporate WeCom application credentials and API contract are supplied.
- Local and Staging may use `mock-wecom` only when `ALLOW_MOCK_WECOM_AUTH=true`. It provisions three fictional identities: Super Admin, Admin, and Member.
- `?debug=admin` is a convenience entry into the same Mock WeCom POST endpoint. It does not mint an identity in the browser or bypass the database. Production rejects Mock WeCom configuration at startup and cannot use this path.
- Successful provider authentication creates a database-backed server Session and an `HttpOnly`, `Secure` (Staging/Production), scoped Cookie. Login, Session lookup, and logout responses never expose the raw Session token.
- Migrations retire credential accounts and Sessions for legacy `@test.projectai.local` users. Historical user and audit rows are retained.
- Historical password Seed commands are now test-only and refuse Staging, so Migration 0023 cannot be undone by a later legacy Seed. Product V2 Staging uses the separate passwordless Mock WeCom Seed.

## Product roles and navigation

The product-role hierarchy is `super_admin`, `admin`, and `member`:

- Super Admin manages the Kivisense organization, four-level department tree, department heads, and product roles.
- Admin can view and edit all authorized knowledge spaces and projects, but cannot edit the organization tree.
- Member sees department-shared spaces plus project spaces granted through project membership or explicit `view` / `edit` access.

The primary navigation contains only Work Daily Report, AI Workflows, Knowledge Base, and Organization (Super Admin only). Legacy top-level product routes redirect to the retained Product V2 destinations and do not restore their old navigation entries.

## Organization and knowledge lifecycle

- Departments have a parent, level 1–4, status, one or more optional heads, and stable ordering. The service serializes edits, rejects cycles/depth overflow, and will not silently delete a live/non-empty department.
- Every department receives one default shared knowledge space. Every project receives one project knowledge space in the same transaction as project creation.
- Project creation is available to organization members, but the service derives and validates the organization and allowed department. Caller-supplied organization IDs are not trusted.
- Knowledge-space permissions are only `view` or `edit`. Project managers retain edit/member-management authority and cannot be downgraded or removed through the space-member endpoint.
- All file APIs, retrieval, AI generation, review, and formal writes continue to re-check the server Session, exact project, and current knowledge authorization. Missing and unauthorized resources keep the uniform 404 boundary.
- Global search only indexes knowledge spaces returned by the authenticated server API. It never searches an unauthorized client-side catalog.

## Requirement Extraction

Requirement Extraction is a contextual, human-reviewed workflow:

1. The user selects an authorized current document or uploads a 24-hour temporary attachment.
2. The service re-checks current/stored/succeeded/effective source state and collects bounded chunks.
3. The AI Gateway requests strict JSON. Invalid format or citations permit one controlled repair only.
4. The service re-checks source authorization after the provider call and before draft persistence.
5. Results remain drafts until the user edits and approves or rejects them on the same page.
6. Approved results may be saved to a department space, existing project space, or a newly created project space. Cross-project attachment preservation performs an authorized download and a new authorized upload before discarding the temporary source.

Temporary attachment discard removes it from the active index and archives its metadata. Object deletion remains asynchronous/manual storage maintenance; it is not claimed as immediate secure erasure.

## Migration chain

- `0020_natural_darkstar.sql`: Product roles, department hierarchy, view/edit access, Kivisense mapping, default department spaces, and Product V2 document authorization.
- `0021_married_kree.sql`: temporary workflow attachment lifecycle and authorization expiry.
- `0022_daily_piledriver.sql`: deterministic membership update timestamps.
- `0023_retire_test_credentials.sql`: removes legacy test credential accounts and their Sessions without deleting user/audit history.

The non-empty upgrade verifier applies the historical chain through 0019, inserts legacy data, migrates through 0023, and verifies preservation plus the new constraints. Staging/Production must use committed migrations; schema push/reset/drop are forbidden.

## Mock and real capability line

- CI uses Fake AI and Mock WeCom for deterministic authorization and workflow tests.
- Staging uses Mock WeCom identities and the existing real Qwen provider for fictional-data AI acceptance.
- Formal WeCom OAuth is not implemented without the real corporate API/configuration and must not be represented as complete.
- Production is not changed by this branch. Mock WeCom, debug identity entry, Staging migrations, and Product V2 rollout are not authorized for Production.
