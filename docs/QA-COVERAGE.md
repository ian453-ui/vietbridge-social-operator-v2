# QA coverage

## Correction after architecture audit

The coverage claims below are historical and are retracted. All UC-001 through UC-056 require explicit case-to-test mapping and evidence. Existing tests check isolated helper functions and the existence of a case list, not complete acceptance. The current UI labels AUTOMATED and CLICKABLE_MOCK are not evidence of coverage and must be replaced during implementation. See ARCHITECTURE-V2.md section 10 for verified gaps.

The canonical list is `src/qa-cases.js`. It contains every product case from UC-001 through UC-056 with a stable ID.

- Automated now: dataset floor, Agency execution block, workspace isolation, Workspace/Identity/ExecutionProfile guards, revision/rule invalidation, reconcile-first UNKNOWN and activity switch lock.
- Clickable Mock now: navigation, content revisions, distribution tasks, Group profiles, Engagement inbox, UNKNOWN reconciliation and eleven Dev/QA fault injections.
- Next automation tranche: Drive bindings, immutable revisions, Group rule revisions, engagement readback, restart persistence and attempt locking against the new V2 database.

The prototype is not authorized for live adapters. A clickable scenario demonstrates product behavior but does not count as real platform verification.
