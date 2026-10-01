# GPT → Google Drive → Publisher

The local V2 service reads each independent client's synced `~/My Drive/Codex/VietBridge-GPT-Inbox/<client-folder>` every 20 seconds while the Groups page is open. The `lp-travel-visa` cloud folder is https://drive.google.com/drive/folders/1ed0cieTzyJ1hJ_PhR8J0jjmoFCe5h5TV. This is separate from the publisher's existing content library: an approved submission is copied into that library. Each submission is a directory containing `submission.json` and one final primary image. Google Docs shortcut files are not accepted; GPT must upload ordinary files to Drive. Syncing creates a review candidate only. It does not import or publish it.

```json
{
  "schema_version": 1,
  "status": "READY_FOR_REVIEW",
  "content_id": "CNVISA-FB-011",
  "title": "Public title",
  "facebook_caption": "Complete public Facebook caption",
  "primary_image": "primary.png"
}
```

The image must be PNG, JPEG, or WebP in the same submission directory. The content ID must be new; an existing ID is shown as a conflict and is never overwritten. Invalid, incomplete, or unsynced packages remain blocked. The reviewer previews the exact text and image in V2 and clicks “确认内容并加入发布资料库”. That action copies the reviewed bytes into the client's existing `READY` library, adds a manifest entry, and records an event. V1 and V2 can then select the article; publication still requires a separate approval and per-platform preflight.

The local SQLite store is the authority for publish jobs. Google Drive is only the content handoff, not a source of publication truth. Do not put tokens, credentials, internal research notes, or mother drafts in the public caption. Do not edit an already published content ID in place.

Deployment prerequisite: the Mac's Google Drive client must synchronize this exact cloud folder to the `~/My Drive` path. The older `~/Library/CloudStorage/GoogleDrive/My Drive` tree is not the active synced root and must not be used as the inbox. On 2026-09-30, the cloud `lp-travel-visa/README.md` was independently read back as a 1133-byte local file at `~/My Drive/Codex/VietBridge-GPT-Inbox/lp-travel-visa/README.md`; this verifies cloud-to-local delivery. The parser and approval gates passed synthetic tests, but no real GPT article package has yet been delivered through the whole flow.

## Explicit inbox directory and cloud verification

`GPT_INBOX_BASE` can select an absolute inbox base instead of the default Mac sync path. Each client's child directory must match the basename of its configured client content root. The existing content root and publisher manifest are still required. This setting does not download Drive files or enable the hosted cloud control plane's disabled local execution routes.

Upload images first and `submission.json` last into a new child folder. Cloud workers can retrieve ordinary files through an authorized Drive connector and place the complete package in an isolated directory for verification; no Mac sync path is required for that step. Do not overwrite existing packages or manifests.

GPT review is accessible before Facebook account setup. A library read failure displays a library error while preserving the page, allowing configuration and refresh to continue. Publication still requires its separate authorization.

Task `VB-PUBLISHER-AUTO-RECOGNITION-20261001-001`: the real Drive diagnostic package `TEST-GPT-CLOUD-20261001-001` was uploaded and downloaded byte-for-byte, then recognized by the unmodified V2 inbox parser as `PENDING_REVIEW`, `ready=false`. This proves cloud storage and parser recognition; Mac sync, the running V2 review UI, and the complete end-to-end deployment remain unverified. No approval, import, scheduling or platform publication was performed.
