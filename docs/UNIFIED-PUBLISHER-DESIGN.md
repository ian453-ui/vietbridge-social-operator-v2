# Unified Publisher 2.2.0-alpha.1

Task: VB-PUBLISHER-V1-V2-INTEGRATION-PLAN-20261005-001. Implementation owner: CLOUD_CODEX. Status: REVIEW, pending Mac deployment and acceptance.

## Agreed model and implemented boundaries

V2 adds features to V1; it is not an account bound to a separate V1 instance. The native unified entry uses one HTTP service and one new SQLite database. Customers own multiple operation accounts/Page. Content is shared within a customer; jobs, browser profiles, publication history and interaction budgets retain exact account scope. Customer history can aggregate accounts. No hard-coded LP/workspace pairing or iframe is required. The only public origin is https://publisher.vietbridge.one.

The cloud ledger is authoritative. Local import snapshots use source_id/revision and reject conflicting revisions. Existing synced client manifests/Ready libraries and enterprise libraries are supported through configured local roots. This does not create a new Drive synchronization service or migrate the cloud ledger. The user explicitly permits discarding old local history and reauthorizing Facebook; deployment starts a new database, never attaches or copies old running databases.

## Code and execution

- src/unified-server.js: authenticated mac-tunnel entry, fresh database validation, single-instance lease, explicit real-execution and read-only scheduler switches.
- src/unified-publisher.js: single account registry, separate publishing preference API/BROWSER, immutable task snapshot and identity/hash guards.
- src/unified-executor.js: immutable media copies, durable intent before a single submit, receipt persistence, independent readback, UNKNOWN recovery, no blind retry or transport fallback.
- src/unified-drivers.js: Facebook API and browser adapters. API requires an existing private configuration file and secure runner; browser requires the matching actual Facebook identity and Chrome CDP profile. Preference never changes interaction transport.
- src/publisher-core/: reusable V1 content and Facebook implementation copied into this repository; no adjacent V1 checkout needed for the unified entry. Legacy integration code remains only for old entry compatibility and is not the deployment path.
- src/interaction-budget.js: shared per-account reply cap and cross-entry target/operation deduplication. UNKNOWN retains reservations. Partial proactive success retries only definitively unsubmitted actions.
- src/scan-scheduler.js: persisted, bounded-frequency discovery only. It never automatically posts, likes or replies. Shutdown waits for an active discovery before closing storage.
- src/group-selection.js: random eligible account-scoped groups; each round replaces prior checks. Successful task creation clears one-shot selection, without erasing publication evidence.
- src/unified-client.js and skills/publisher-browser/SKILL.md: native publish UI and authenticated dot browser workflow; runtime capability flags govern explicit submission. Skill source is not evidence of installation.

## Deliberate restrictions and remaining gaps

Facebook Page text/photos support API and browser. API video uses the existing V1 video adapter; browser video is blocked before submission and must not silently fall back. Facebook Groups and interactions use browser execution, not Page API. Unsupported identity, checkpoints, missing secure configuration or changed approved content fail closed. An uncertain result requires readback, possibly a independently obtained numeric platform ID, never a client-supplied success flag.

This revision does not port V1 non-Facebook platform executors into the unified UI. Therefore it is a Facebook integration release candidate, not proof of full V1 feature parity. Do not retire required legacy non-Facebook workflows or mark the whole product DONE without explicitly resolving that gap. Actual Facebook DOM selectors, account identities, browser Inbox discovery and Chrome flows still need Mac verification. No cloud test issued a real social write.

See UNIFIED-PUBLISHER-RELEASE.md for installation, exact test limitations, backups and rollback. The older paired-account/dual-database PR#7 architecture is superseded, not a dependency of this entry.
