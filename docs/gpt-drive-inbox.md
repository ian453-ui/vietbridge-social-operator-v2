# GPT → Google Drive → Publisher

The local V2 service reads each independent client's synced `content_root/GPT-INBOX` every 20 seconds while the Groups page is open. Each submission is a directory containing `submission.json` and one final primary image. Google Docs shortcut files are not accepted; GPT must upload ordinary files to Drive. Syncing creates a review candidate only. It does not import or publish it.

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

Deployment prerequisite: the Mac's Google Drive client must synchronize this exact `GPT-INBOX` with the folder ChatGPT can write in Drive web. A local folder alone is not proof of cloud availability. Verify a real Drive file by cloud metadata and local readback before declaring the handoff live. As of 2026-09-30, the app-side watcher and review gate are tested, but this cloud-to-local sync prerequisite has not passed verification.
