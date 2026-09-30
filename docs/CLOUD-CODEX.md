# Continue V1/V2 development in cloud Codex

Clone the private `vietbridge-publisher-p0` and `vietbridge-social-operator-v2` repositories as sibling directories named `Publisher-P0` and `Social-Operator-V2`. V2 imports source code from `../../Publisher-P0/src/content-library.ts`, so that layout is required for tests and runtime.

Run `npm ci` in each repository, then `npm test` in V2 and `npm test` in V1. The local V1/V2 production SQLite databases, browser profiles, account credentials, synced Google Drive content, and platform sessions are intentionally **not** in GitHub. Cloud Codex can work on code and synthetic tests, but cannot claim a live Facebook or other platform result without a separate local/platform readback.

GPT content arrives through the client's synced Google Drive `GPT-INBOX`; see `docs/gpt-drive-inbox.md`. The intake approval action only updates the local content library. It never authorizes or triggers publication.
