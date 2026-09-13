# IMPLEMENTATION_PLAN: SMO-FB-GROUPS-20260913-002

Status: IN_PROGRESS

## Verified local findings

- V1 is `../Publisher-P0`, served by `src/web-server.ts` on `127.0.0.1:17880`; its current SQLite source of truth is `data/publisher.sqlite`.
- V1 is kept as an isolated sub-application. Its 71 tests and TypeScript check pass before this change.
- Reusable V1 reliability primitives are content snapshots, publication intents, platform attempts/fencing, profile locks/health, receipts, UNKNOWN/reconcile, and append-only outbox evidence.
- V2 is a separate JavaScript/SQLite mock app on `127.0.0.1:17882`. Its generic dashboard is not a real Facebook integration and is superseded as the default UI.
- The V2 database is outside the source tree under macOS Application Support. Additive tables will preserve existing prototype data; no V1 or V2 destructive migration is permitted.
- No verified Facebook Groups browser driver exists in either app. V1 Facebook support is Page/Graph-API oriented, not joined-group browser operation.
- V1 includes `playwright-core`; the Group integration will use an explicitly assigned, local Chrome execution profile and CDP. Passwords/tokens are neither requested nor persisted.
- Current browser-surface discovery timed out, so Facebook login/session availability is an explicit runtime gate rather than an assumed fact.

## Implementation boundary

1. Replace the default V2 navigation with: V1 Publisher, Facebook Groups, Facebook Inbox, Accounts/Settings.
2. Link/mount V1 through the smallest isolated boundary and never copy or mutate its database/state machine.
3. Add local tenant Facebook accounts, execution profiles, joined groups, frozen content, independent group jobs, published-post evidence, comments, and reply intents.
4. Add a real Chrome/CDP adapter boundary for identity verification, joined-group discovery, composer preparation, post/comment readback, and reply preparation. Fail with evidence when the session or current Facebook UI cannot be verified.
5. Keep human final click for group publication. UNKNOWN forbids blind retry.

## Files to change

- `src/store.js`: additive schema, isolation, CRUD, job/reply invariants and persistence.
- `src/facebook-browser.js`: local Chrome profile/CDP and Facebook UI observation/preparation.
- `src/server.js`: authenticated local API routes and V1 health integration.
- `src/client.js`, `src/index.html`, `src/styles.css`: corrected operational UI.
- `test/facebook-groups.test.js`, `test/integration.test.js`: required domain/API regression coverage.
- `README.md`, verification docs: setup, human steps, gates, and blockers.

## Known human/runtime gates

- The operator must log in to Facebook in the assigned managed Chrome profile when session verification reports logged out.
- Facebook human final click remains required for the actual group post.
- Native file chooser interaction may remain necessary if current Chrome/CDP attachment cannot set the file input safely.
