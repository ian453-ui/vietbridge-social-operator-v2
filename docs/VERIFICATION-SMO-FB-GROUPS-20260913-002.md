# Verification: SMO-FB-GROUPS-20260913-002

Status: IN_PROGRESS — login-blocked real integration

## Automated and local evidence

- Corrected UI visibly rendered in Google Chrome at `http://127.0.0.1:17882/` with four top-level tabs and tenant selection.
- V1 remains reachable at `http://127.0.0.1:17880/`; its 71 tests and TypeScript check pass unchanged.
- V2 domain/API tests pass, including tenant isolation, account/profile mapping, group sync stale/dedupe, manual URL fallback, one-to-N independent jobs, wrong identity block, UNKNOWN no-retry, post claim, comment dedupe, duplicate reply prevention, and restart persistence.
- Managed Chrome started successfully with CDP at `127.0.0.1:17921`.
- Session inspection returned `FACEBOOK_LOGIN_REQUIRED` after detecting the real Facebook login form. No group or identity was fabricated.

## Real gates

- GATE-1 Account maintenance: PASS — profile and account mapping were created through the running UI and persisted locally.
- GATE-2 V1 inheritance: PASS — isolated V1 tab/link is present; 71 V1 tests and typecheck pass.
- GATE-3 Joined groups: BLOCKED — managed Chrome profile requires one-time Facebook login.
- GATE-4 Group selection: NOT TESTED with real synced groups; search/multi-select behavior is locally implemented and tested at the data layer.
- GATE-5 Text preparation: BLOCKED by GATE-3/login.
- GATE-6 Image preparation: BLOCKED by GATE-3/login.
- GATE-7 Video preparation: BLOCKED by GATE-3/login.
- GATE-8 Independent jobs: PASS locally; two groups create two persisted independent jobs.
- GATE-9 Post readback: BLOCKED; requires a human-confirmed real test post.
- GATE-10 Comment sync: BLOCKED by missing real published-post evidence and login.
- GATE-11 Manual reply: BLOCKED by GATE-10.
- GATE-12 Wrong identity guard: PASS locally — mismatch is rejected before insertion without state mutation.
- GATE-13 UNKNOWN guard: PASS locally — UNKNOWN has no prepare/retry transition.

## Exact human step

Log in to Facebook in the separate managed Chrome window opened by the app. Do not send credentials to Codex. After login, return to Accounts/Settings and click `核对身份`, then `同步已加入群组`.

This is not a final RESULT and must not be represented as complete until the blocked real gates are exercised or returned as final explicit blockers.
