# VietBridge Social Operator V2 — Mock Prototype

Current: 2.0.0-prototype.2. Persistent mock execution slice. See docs/VERIFICATION-prototype-2.md for actual verification and remaining gaps. Double-click 启动V2.command to start; keep its terminal open. Runtime data is outside the source directory in macOS Application Support/VietBridgeSocialOperatorV2.

On this Mac, `com.vietbridge.social-operator-v2` runs the local service automatically and restarts it after an unexpected exit. The browser address is always `http://127.0.0.1:17882/` while the user is logged in.

Independent V2 prototype for `SMO-PROTO-20260913-001`. It does not import, write, or migrate the Publisher-P0 database and has no live platform adapters.

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
