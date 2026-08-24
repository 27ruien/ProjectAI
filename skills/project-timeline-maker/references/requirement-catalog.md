# Requirement Catalog v0.1

Read this catalog only after project understanding identifies the applicable
features. It is a checklist framework, not a keyword matcher and not a source of
missing answers. For each triggered item, emit `CONFIRMED`, `MISSING`,
`UNCLEAR`, or `NOT_APPLICABLE` with supplied evidence or a gap reason.

## Campaign / Event

For activities, campaigns, events, draws, rewards, check-ins, or task-based
participation, check Activity Rules, Start / End Date, Participation Rules, and
Eligibility. Add Reward Rules when rewards exist. Add Coupon Rules and Claim /
Redemption Rules only when coupons, claims, or redemption apply.

## Personal Information

When registration, phone, email, profile, or other personal data is collected,
check Privacy Policy, Consent, Data Fields, Processing Purpose, and whether
Storage / Retention has been defined. Check Third-party Sharing only when a
third party is involved. Record gaps; do not supply legal conclusions.

## Photo / Face / Biometric

When users upload photos, selfies, faces, or use try-on or face analysis, check
User Consent, Sensitive Personal Information Handling, Retention / Deletion,
Processing Provider / Location when required, and User Notice. Never invent a
retention period, provider, region, or compliance conclusion.

## Visual Design

When the project needs UI, campaign KV, AR/3D visuals, pages, or design assets,
check Brand Guideline, Logo, Fonts, Color, Visual Assets, Copy / Localization,
and Reference Design.

## Development / Integration

For development, check Scope and Frontend / Backend Dependency. For third-party
integration, also check API Documentation, Authentication, Test Environment,
Parameter Rules, and Owner / Contact. Check Domain / Hosting only for applicable
Web delivery.

## Launch / UAT

When launch is in scope, check UAT, Acceptance, Production Configuration,
Release Date, Approval / Review Dependency, and Go-live Dependency. An absent
release date remains missing or unclear; it is not permission to invent one.

## Hardware

For screens, devices, cameras, sensors, or onsite installation, check Device
Model, Resolution, Network, Installation Environment, Onsite Setup, and
Responsible Party.

## Turning gaps into tasks

A `MISSING` or `UNCLEAR` item may become a prerequisite task such as “获取 / 确认
API Documentation”. Set its basis to `requirement_gap`, reference the catalog
ID, leave unsupported owners and dates empty, and include the catalog reason.
Do not convert every checklist row into a task when it does not affect delivery.
