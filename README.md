# VietBridge Social Operator V2 — Mock Prototype

Current: 2.1.0-alpha.1 for task `SMO-FB-GROUPS-20260913-002`. The previous abstract mock dashboard is no longer the default product direction.

On this Mac, `com.vietbridge.social-operator-v2` runs the local service automatically and restarts it after an unexpected exit. The browser address is always `http://127.0.0.1:17882/` while the user is logged in.

The app does not import, write, migrate, or replace the Publisher-P0 database. Facebook Groups uses a separate browser adapter and local state boundary.

The corrected app has four operational tabs: unchanged V1 Publisher, Facebook Groups, Facebook Inbox, and Accounts/Settings. V1 remains isolated at port 17880 with its own database and tests. V2 adds an independent local database for tenant Facebook mappings, managed Chrome execution profiles, joined groups, frozen content, per-group jobs, post evidence, comments, and reply intents.

## Facebook setup

1. Select the tenant in the upper-right corner.
2. In Accounts/Settings create a managed Chrome execution profile, then create the expected Facebook identity mapping.
3. Start the execution profile. If Facebook shows its login screen, the human logs in directly in Chrome; this app never reads or stores the password.
4. Use `Sync joined groups`. Identity mismatch or expired login fails closed before any composer text is inserted.
5. In Facebook Groups choose existing text/media, select groups, and create independent jobs. P0 prepares the composer but preserves the human final click.

Runtime blocker on 2026-09-13: the newly created managed profile is reachable over local CDP but is not logged into Facebook. Real joined-group, composer, post-readback, and Inbox gates remain blocked until the human completes this one-time login.

## Start

```sh
npm start
```

Open `http://127.0.0.1:17882`.

## Validate

```sh
npm test
```

The prototype keeps product lifecycle state separate from the proven Publisher-P0 execution state. Real integration stays disabled until the M0 review and mock QA are accepted.
