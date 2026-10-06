# Mac merge, deployment and acceptance handoff

Task: `VB-PUBLISHER-V1-V2-INTEGRATION-PLAN-20261005-001`; sticky implementation owner `CLOUD_CODEX`. Mac Codex owns final merge, deployment and public regression evidence. Until its receipt, status is **REVIEW / pending acceptance**, not DONE.

Repository: https://github.com/ian453-ui/vietbridge-social-operator-v2
Branch: `feat/v1-v2-integration-20261005`; PR: https://github.com/ian453-ui/vietbridge-social-operator-v2/pull/6
Parent preserved: `8d32a1640152a455a94f11912a2416e3fe3be94f`, including Mac's fresh-client rendering, library repaint and macOS canonical-path fixes. Exact release commit is the HEAD explicitly posted in the original Slack handoff. Check it before merging; report both reviewed commit and resulting deployment commit if merge changes SHA.

Original Slack thread: https://vietbridge.slack.com/archives/C0C6PRGNGLQ/p1791189324132619
V1 PR#7: https://github.com/ian453-ui/vietbridge-publisher-p0/pull/7 (old integration superseded; not a required paired install). Do not overwrite its LP fixes: `56b0444bcd1cfd1fb31291c3a9d9461765ac8f6b` is retained in V1 HEAD `558554f6843f38381424ebbc3235fe62821b26d7`.

## Reproducible installation

Use an isolated checkout of the existing branch on the Mac, not the old running working directory. Node 24 LTS is recommended (native node:sqlite and TypeScript stripping; engine >=23.6).

```sh
git fetch origin feat/v1-v2-integration-20261005
git checkout feat/v1-v2-integration-20261005
git rev-parse HEAD
npm ci
npm test
npm run test:unified
```

The unified entry is self-contained; no adjacent V1 checkout is required. The legacy compatibility entry may still require that checkout for old integration tests; supply it for those tests only, not the new live service.

## Existing configuration to reuse, without secrets in reports

- `PUBLISHER_MODE=mac-tunnel`, `PUBLIC_ORIGIN=https://publisher.vietbridge.one`, existing `ADMIN_USER` and `ADMIN_PASSWORD` secure injection. Password is required, at least 24 characters; do not weaken authentication or create credentials as part of this handoff. Mac reported safe administrator injection resolved on 2026-10-06; reuse it without reading or printing secrets.
- `DATA_DIR`: private absolute new release data directory. Explicit DB argument must be its new `publisher-unified.sqlite` path. No legacy database attach/import/migration. Preserve old databases only as rollback backups.
- `PORT=17882` default, loopback only. Reuse the existing tunnel routing for the one public domain after local validation; no second domain.
- `PUBLISHER_BUILD_HEAD`: exact checked-out deployment SHA, 40 lowercase hex characters.
- `PUBLISHER_ENABLE_EXECUTION=0` and `PUBLISHER_ENABLE_SCAN_SCHEDULER=0` for acceptance. Explicitly enable execution only for separately authorized live use, not for the current regression task. Scheduler enablement only adds discovery, not social writes.
- `CONTENT_ROOTS_JSON`: JSON array of existing authorized Drive/Codex-synced content roots. `GPT_INBOX_BASE`: existing local inbox root where used. Set each customer's client/enterprise kind and root correctly; no inference from LP names.
- Existing Chrome executable/CDP ports, user-data profile directories, Facebook sessions and exact account/Page IDs. Reauthorization may be needed; do not infer ownership or copy cookies into reports. Freeze browser operator actor and Business/Graph target Page independently; legitimate differing IDs are supported.
- Optional API publishing: existing secure local config reference with private permissions and FB_PAGE_ID matching targetPageId, independently of operatorActorId (FB_BROWSER_PAGE_ID). Secure MCP runner currently follows the existing Mac path `/Users/a1-6/claude/fb-mcp/run-facebook-secure.sh`; verify availability, never print its configuration contents. Missing runner/config blocks API mode but does not silently switch modes.

After secure environment injection:

```sh
npm run unified -- "$DATA_DIR/publisher-unified.sqlite"
```

No `.env` loader is assumed. The service lease prevents simultaneous unified writers. Keep the new directory and all runtime artifacts out of GitHub.

## Cloud evidence and limits

Cloud Node v24.19.0: **124 available tests passed, 0 failed**. Native SQLite/tempfiles and actual authenticated request handler were tested; external MCP/axios imports used fail-closed test adapters, and driver calls used injected deterministic clients. This is not npm-ci, actual SDK, browser or live Facebook evidence.

Nine tests were explicitly not counted as passing: seven real socket HTTP tests (cloud sandbox listen EPERM) and two real Chrome tests (Mac browser unavailable). Mac must run the full suite with real installed dependencies and supply the real HTTP/Chrome results. Cloud log: `/workspace/scratch/unified-evidence/available-regression.txt` (cloud artifact, not a Mac local path). New tests cover native auth/CSRF, customer/account isolation, frozen mode and media, exactly-once intent, uncertain submission, readback, shared quota/dedupe, partial LIKE/reply recovery, scheduler persistence and random groups.

## Mac acceptance steps, no social writes

1. Verify exact handoff SHA, npm-ci lock consistency and all unit/HTTP tests. Keep production credentials out of test fixtures. Run real Chrome composer/readback tests against authorized existing session; these tests must not submit a real post/reply/like.
2. Back up old launch/tunnel configuration and old data with services stopped or SQLite-consistent backup. Do not merge/overwrite old databases. Record backup locations without secret contents. Review dependency installation before switching traffic.
3. Build fresh unified data, create customers and reattach/re-authorize actual operation accounts explicitly. Verify customer isolation, multiple accounts, shared content, separate history/quota and aggregate history.
4. Reconnect existing cloud library; verify LP-011 through LP-020 visibility, captions/assets and source revision behavior. No synthetic demo content is seeded. Verify client/enterprise paths and no cross-customer leakage.
5. Verify API/BROWSER manual preference saves and freezes per job; interactions remain browser. Preview and approve tasks only. With execution disabled, ensure execute controls/API refuse submission. Validate checkpoint/wrong identity behavior through read-only inspection; no evasion/fallback.
6. Verify group random selection replaces previous picks; new task clears selections while retaining dedupe/evidence. Verify theme and proactive tabs discover existing permitted data, shared account budget, pause/cooldown and partial/unknown action readback. Empty legitimate data must not be confused with an executor failure.
7. Verify dot capability endpoint and selectors through the existing authenticated Publisher session. Install/update repository skill source only through the already authorized skill workflow; return installed location/version evidence, do not claim installation from Library presence.
8. Merge only after checks, start the reviewed unified entry and switch the existing tunnel upstream. Public `https://publisher.vietbridge.one/api/health` requires auth and reports version, mode and exact HEAD. Verify unauthorized 401, authorized expected host, Origin/CSRF protections, persistence across restart, account/profile separation and no real social action.
9. Return exact merge/deploy SHA, local/public test matrix, version, library/account confirmation, non-secret logs, backup/rollback location and unresolved gaps in the original Slack thread. Any required gap remains BLOCKED/pending; no DONE merely because a process starts.

## Remaining gaps and rollback

This release exposes Xiaohongshu image/video, WeChat Official Account drafts, dedicated WeChat Channels browser and Facebook browser video through the same customer/account/job registry. Their actual Mac adapters and platform DOM remain pending acceptance; cloud fake-driver tests do not establish production usability. Actual Facebook DOM/Inbox coverage and secure API runner remain Mac acceptance items. Keep essential old non-Facebook workflows until separately resolved.

Rollback: stop new writer/scheduler; restore prior tunnel upstream and launch configuration, restart original services against their untouched databases. Keep new unified database/assets/leases as a separate incident snapshot, not a migration source. If a task ever reached SUBMITTING/UNKNOWN during authorized future use, retain its evidence and reconcile before any retry on either service. Never erase unknown action records to obtain a clean retry.

## 2026-10-06 continuation / version 2.3.0-alpha.1

Keep task and CLOUD_CODEX owner unchanged. This commit is based on Mac HEAD 8d32a1640152a455a94f11912a2416e3fe3be94f; no force push. Cloud source backup: /workspace/scratch/recovery-20261006 (not a Mac path). Full-regression command with additional network permission was interrupted and its approval outcome remains unknown. It is **not approved or passed** and must not be rerun or rerouted without approval. Independent static and fake-driver unit checks may continue. A later selected unit/library run inadvertently included one real loopback socket test; it failed sandbox listen EPERM. No permission bypass or socket retry was performed. Log: /workspace/scratch/unified-evidence/current-unit-regression.txt: 51 passed, 1 sandbox socket failure. Core current identity/platform isolated suite: 37/37, log /workspace/scratch/unified-evidence/identity-unit-tests.txt. Earlier actual npm-ci succeeded in disposable /tmp/vb-unified-normal-deps (113 packages), with 45/45 earlier unified tests; these earlier results do not validate this new SHA. Mac must run current npm-ci/full regression and return evidence.

Facebook LP operation actor 61594159443807 and Business Page 1459220443931651 are independent valid IDs. Import-local returns only config reference, display identity and both IDs; it never returns token/password data. Save explicit operator_actor_id and target_page_id; external_id remains the interaction/browser actor. Freeze both in new jobs. API auth, content author/video checks and Business asset_id use targetPageId; browser /me inspection and public URL use operatorActorId. API evidence means target-Page authorization, not independent /me actor observation. Changing either invalidates queued approval; same target Page/payload cannot be resent by choosing a different actor or transport. Old tasks missing the pair fail closed and remain untouched.

Fresh schema adds draft and ID-pending terminal states. Use a NEW isolated acceptance DATA_DIR if the old 02f322 test DB exists; do not migrate, delete or mix it, production V1 or production V2. Mac reported 11 legacy RECONCILE_PENDING and 2 V2 UNKNOWN; preserve them and their backups. Never start a clean DB to bypass an unknown submission in future live operation: reconcile retained ledgers before real execution.

Platform configuration (references only):
- Xiaohongshu: existing loopback MCP endpoint (default http://127.0.0.1:18060/mcp), read-only verified username:identity. The existing sidecar's physical session is serialized across all accounts; select the matching existing session explicitly. Multiple registry records do not make a single sidecar simultaneously authenticated to multiple users.
- WeChat Official Account: verified wx App ID, existing private config reference and existing Wenyan connector entry; snapshot includes the companion article and approved cover/body images, not an MP4. Token exchange/rendering/draft creation only during separately authorized execution; current acceptance is fake-driver/read-only. DRAFT_WRITTEN does not mean public publication.
- WeChat Channels: distinct existing Chrome directory/CDP port, actual account ID/name, optional collection. Missing observable identity needs explicit user-attested managed profile; report that weaker evidence accurately. Short title <=16, single MP4, separate tags; no automatic title truncation. Exact-description own-list readback yields PUBLISHED_ID_PENDING, never a fabricated public ID/link.
- Facebook video: single approved MP4, browser/API chosen manually and frozen; waits for form readiness then one final intent/submit. No automatic transport fallback. API runner/config and browser DOM need Mac acceptance.

Mac final gates: preserve its UI/path fixes, install exact new SHA in isolated checkout/data, run full regression with actual dependencies, read-only check both LP IDs and existing Business list, verify all four native platform forms/library variants/account switching, and disabled execution refusal. No real media upload/draft/post/reply/like is authorized by this integration task. If actual live completion needs a smoke submission, obtain separate explicit authorization first. Then merge, deploy existing domain, authenticate public health reporting exact SHA/version, restart persistence checks, and return results in original Slack thread. Status stays REVIEW / pending acceptance until that receipt. Unattached VietBridge session remains a concrete Mac setup gap; do not fabricate it.
