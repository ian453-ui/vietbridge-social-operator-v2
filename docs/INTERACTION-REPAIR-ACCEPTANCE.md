# Interaction repair and Mac acceptance

## Relationship

The topic view searches authorized groups by keyword and classifies imported posts or Page comments. Replies use an account-wide rolling 24-hour quota (maximum 12), a group rolling 24-hour quota (maximum 3), and an author rolling seven-day quota (maximum 2). Radar posts must use the dedicated browser, never the Page API comment endpoint.

The proactive view reads recent posts from joined, enabled groups explicitly opted into proactive engagement. Likes and replies share one post slot per group per UTC day (maximum 5). These limits are separate from topic reply quotas. Navigation is renamed to describe these two discovery methods. An eventual shared interaction entry can retain two discovery views; merging quota tables would change their semantics.

## Changes

- Route radar-origin replies to the account's browser with identity, target, text, quota and independent readback checks. Failed pre-submit attempts release quota; ambiguous submits remain UNKNOWN with quota held and cannot be resent.
- Reclassify unsent topic candidates after rule changes, preserving reserved/submitting/unknown/replied states and their reasons.
- Show only the selected account's candidates and rolling-24-hour reply quota.
- Accept canonical group post, permalink, photo and story links for radar discovery, rejecting mismatched hosts/groups.
- Enforce proactive SHADOW mode at the store boundary and expose the mode selector in the UI.
- Preserve verified fact state on rescan and prevent rescan from resetting ATTEMPTING posts.
- Clarify enabled controls, group setup and manual scan behavior. No periodic scanner or automatic follow-up sender is implemented by this patch.
- Remove recruitment from the default exclusion words, since it conflicts with a common recruitment topic. Existing saved rules remain authoritative.

## Public runtime

Mac reported publisher.vietbridge.one returning HTTP 409 from the local-mode Host check. Cloud control-plane mode intentionally has no executor; changing only the hostname or disabling Host validation does not make interactions work.

This patch adds an explicitly authenticated `PUBLISHER_MODE=mac-tunnel` mode. It serves the single public origin through the existing Mac Tunnel and retains Mac browser execution. It binds only to loopback. It is a first-stage Mac deployment option, not the separate-cloud durable-executor design.

Configure the existing Mac service with:

```text
PUBLISHER_MODE=mac-tunnel
PUBLIC_ORIGIN=https://publisher.vietbridge.one
ADMIN_USER=<existing admin name>
ADMIN_PASSWORD=<local secret of at least 24 characters>
DATA_DIR=<absolute directory containing the existing V2 mock.sqlite>
PORT=17882
```

Use the actual current data directory, not a new empty directory. Preserve secrets locally; never put them in GitHub, reports or Slack. All HTTP requests require authentication; writes additionally require the exact trusted Origin and session token. Hostnames other than publisher.vietbridge.one and authenticated internal loopback are rejected. Existing `cloud` mode remains a non-executing control plane. The tunnel must preserve the configured Host. Protect or retire the extra publicly reachable publisherv1 entry as already requested by the user; this patch itself does not modify DNS or tunnel configuration.

## Mac release gate

1. Report actual running HEAD and dirty files; integrate without overwriting newer user edits. Back up the existing SQLite database and check its integrity before restart.
2. Run full V2 npm test, including interaction-repair, proactive-ui, tunnel-runtime and cloud tests. Run V1 full regression and typecheck. Cloud environment cannot run Mac Chrome fixtures and lacks the V1 yaml dependency; do not interpret its targeted tests as full acceptance.
3. In the actual local UI, select the customer and browser account, launch the dedicated Chrome and verify its identity. Test saving both policies, group switches, keyword search, candidate visibility, immediate read-only scan and accurate quota counts. Record any failing request and response. Use SHADOW or isolated fixtures; do not send real social interactions for acceptance.
4. Exercise browser reply success, pre-submit failure, ambiguous submit, retained quota and duplicate prevention using isolated browser fixtures. Verify source routing distinguishes Page comments and radar group posts. Test both transports, two accounts and two customers.
5. Validate authenticated mac-tunnel through actual publisher.vietbridge.one: unauthenticated requests get 401, authenticated UI and health get 200, wrong Host/Origin and missing token fail, executionConnected is true, and read-only search/scan reaches the Mac executor. Confirm CDP remains private and no additional public domain entry remains available.
6. On errors, repair and push a follow-up commit, rerun relevant tests and continue actual UI acceptance. Only after passing, restart the real service and report final HEAD, URL, database path, tests and UI evidence. Do not report a docs-only merge or a queued task as a successful deployment.
