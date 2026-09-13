# M0 Review Packet

Task: `SMO-PROTO-20260913-001`

## Local truth

- Existing runtime: `Publisher-P0`, Node/TypeScript, server-rendered local Web UI, SQLite, four platform adapters/connectors.
- Operational authority: local SQLite; side-effect authority: platform readback; Drive: content input and append-only mirror.
- Verified reusable modules: immutable content snapshots/assets, publication batches, platform jobs, attempts with fencing, approval scope hashes, receipts, attention requests, profile locks/health, intent-before-submit, form snapshots, append-only job events/outbox, recovery/reconciliation rules.
- Existing validation: TypeScript check passed; 71 Node tests passed; 17 historical P0 traces passed on 2026-09-13.

## Counterevidence and corrections

1. Publisher-P0 is a working directory without Git metadata, not a versioned repository. V2 therefore starts in a separate Git repository and does not mutate P0.
2. The operational SQLite file currently lives under a Google Drive-synchronized project directory. Before real V2 execution, runtime state must move to a non-synced local application-data directory; Drive keeps mirror data only.
3. The product specification's lifecycle states and Publisher-P0 execution states cannot replace each other. V2 models them as separate state dimensions with an explicit translation boundary.
4. Xiaohongshu source contains a live MCP worker path, while an older driver test says its direct driver submit remains unwired. README/capability claims require a per-adapter truth audit before real integration.
5. `social-media-operator` self-evolution is currently a governed Skill and schema contract, not an autonomous runtime loop. V2 should implement evidence intake, candidate rules, tests and human promotion; it must not silently rewrite production behavior.
6. The archived 1.1.0 Skill ZIP differs from the installed 1.1.0 and omits the installed Evolution Log. A signed release manifest is needed before the next Skill release.

## Required V2 migration

- New tenant domain: Workspace, Brand, Project, ChannelAccount, Identity, ExecutionProfile and Destination.
- New content domain: GlobalFact/KnowledgeUnit, workspace-private ContentItem, immutable ContentRevision/MediaRevision, PlatformVariant/GroupVariant and DriveBinding.
- Add EngagementTask, CommentSignal, LeadSignal, GroupProfile, GroupRuleRevision and analytics/experiment context.
- Add `workspace_id` to every private operational object and enforce it in repository queries and commands, not only the UI.
- Preserve Publisher-P0 execution tables behind a versioned adapter; never copy mutable P0 rows into the mock prototype.

## Recommended real integration order

1. Keep V2 mock-only until UC-001..UC-056 mapping is complete.
2. Extract a read-only Publisher Core contract and golden traces from P0.
3. Introduce a new local V2 SQLite database outside Drive; migrate only copied fixtures first.
4. Integrate WeChat Official Account draft as the lowest-risk adapter.
5. Integrate one verified Facebook Page operation.
6. Integrate Xiaohongshu after adapter truth audit.
7. Integrate WeChat Channels managed profile.
8. Keep Facebook Groups at Human final click until platform capability is independently verified.

## Unresolved P0 risks

- No authoritative source-control history for Publisher-P0.
- Live runtime and SQLite are inside a sync folder.
- Active runtime state may not match the last README.
- No proven multi-workspace row-level isolation exists yet.
- Real Facebook Group identity/Page identity switching needs browser capability validation.
- The 56 new product QA cases are broader than the existing 71 Publisher unit tests and must be tracked separately.
