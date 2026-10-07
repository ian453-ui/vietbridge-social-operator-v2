# Publisher-owned read-only Facebook evidence

Task VB-PUBLISHER-V1-V2-INTEGRATION-PLAN-20261005-001. Independent of PR #11: no submission-readiness changes, no trial click and no merging of that patch.

Authenticated administrator UI on the existing UNKNOWN Facebook BROWSER task offers **只读诊断（保留现场，不改任务）** and **读取诊断进度与证据**. POST `/api/unified/workspaces/:workspace/jobs/:job/diagnostics` starts one bounded observation with the exact snapshot_hash. This POST changes only Publisher's independent diagnostic-run table, never the platform. GET on the same path reads persistent progress/results and never starts browser work. Host/auth/Origin/CSRF remain required; app bearer tokens do not have this route. The disabled execution/scheduler switches remain unchanged.

The task must be UNKNOWN with matching frozen hash/current content/account/profile. The run retains scope and original job provenance, uses the existing operator/profile reconcile lease and shared in-process active-profile guard, then verifies the frozen CDP port belongs to that exact directory before using the already-existing BusinessBrowser connector. A pending unresolved lease is not publication permission. Another active diagnostic/execution or readback owner blocks the run.

First list sanitized URLs for preexisting platform pages and persist bounded DOM scene evidence, including whether a composer still matches the approved body. Never navigate, close, focus or mutate those old pages. Identity verification uses a newly allocated /me page in the same session and existing actor-menu verification, never changes identity, reads passwords or logs into another account. Only that new page is closed afterwards. Existing account/job/permit/attempt/intents are not modified by diagnostics.

New observation pages follow only actually observed, same-target-asset Business UI links within home/content/posts. No guessed URLs or internal APIs, no fill/upload/submit/trial/force. Unknown query or fragment state is rejected, not silently stripped. Allowed non-secret tab/content_tab/section/view filter values remain in the navigation URL. Evidence URLs remove credentials/secret query values. View classification is from actual path plus selected tab/grid labels; a link's label alone never counts as coverage, and conflicting path/DOM classification is incomplete.

One round: at most 12 detailed preexisting-page snapshots, five newly observed views, 100 loaded rows per view, 60-second observation budget, each step capped at eight seconds and each goto at seven. Page cleanup is bounded; final page cleanup has a five-second aggregate allowance and disconnect at four seconds (outer 4.5-second cap). Port/profile checks and connection have their existing short timeouts before observation. UI polls progress for at most 90 seconds without restarting work. A cleanup/disconnect timeout retains the reconcile lease and active-profile guard; no automatic permission bypass or retry. Restart marks only interrupted diagnostic rows INCOMPLETE, not platform jobs. Persisted run/scene/progress/errors survive UI reload.

Reports retain identity/asset/URLs/timestamps, normalized candidate text hashes and short text excerpts, candidate IDs, active view, busy/loading, row limits, filters, pagination controls and coverage. Full caption equality requires a normalized complete matching DOM element; a substring/prefix is not sufficient. IDs without full body or without verified identity are not a match. A candidate MATCH is evidence for review, not automatic PUBLISHED or a recovery action.

Conclusions:

- MATCH: observed full-body candidate with ID on a verified classified target surface; surface kind is retained (draft/scheduled is not published).
- NOT_FOUND_IN_OBSERVED_RANGE: no such candidate in the successfully observed classified rows.
- INCOMPLETE: partial coverage, unknown view, busy/capped/unreadable rows, mismatch, timeout or explicit read error.
- BLOCKED: identity/port/profile/access/discovery/lease failure.

Every report has absenceProven=false and exhaustive=false. A loaded page, missing item, limited date/filter or unvisited pagination never authorizes a retry. No call to claim/complete/prepare/submit/permit issuance occurs. Production execution for this diagnostic must be a single explicitly coordinated Publisher path with dot paused. Before deployment verify no active diagnostic/browser job, consistent backup, runtime clean, and that restart/close touches no browser page. Existing UNKNOWN/CONSUMED history and intents must be byte-compared before/after. Do not automatically start diagnostics merely by loading the UI.
