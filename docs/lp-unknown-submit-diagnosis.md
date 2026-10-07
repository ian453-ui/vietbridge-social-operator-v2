# LP ambiguous submit diagnosis

Task: VB-PUBLISHER-V1-V2-INTEGRATION-PLAN-20261005-001.

Historical production attempt under release `70a4bb2e4ea64fcdd3b4b44cb25f061104e5af18`:

- Existing job `ffeadf9c-10de-4e22-84f0-bd186adcefbc`, attempt `0b047c3d-15fd-4c98-b61f-b9465d8d9a1a` is UNKNOWN/SUBMITTING with submissionIntent=true.
- The single permit `96a95a24-b01c-4404-80ed-49d92a12f89d` is CONSUMED, not renewable.
- Prepare intent: 2026-10-07T10:48:50.995Z; submit intent: 2026-10-07T10:48:59.931Z; failure: 2026-10-07T10:49:16.605Z.
- Saved error: Publish locator resolved to a div role=button, but click timed out at the visible/enabled/stable actionability stage after 15 seconds. No persisted receipt or post ID.
- Saved prepared_json contains only operation, Page/actor and media count; no editor/button actionability snapshot, screenshot, trace or request dispatch evidence. Service stderr is empty. Profile lease is PENDING, not permission for writes.

## Findings and limits

The old fill implementation checked Publish.isEnabled() only. That does not establish visibility, stability or absence of an overlay. It can therefore pass preparation and fail the final actionability wait. This is a confirmed preflight gap, **not proof of the exact historical obstruction**. Hidden control, instability, overlay or a stalled page remain hypotheses; the stored call log does not distinguish them.

The old close implementation closed the composer even on uncertain submit and destroyed its inspectable form state. Historical preparation evidence is insufficient to reconstruct the actual button condition. Actor inspection uses a separate www.facebook.com page, whereas the Business composer is a new business.facebook.com page; code inspection does not support claiming that identity verification necessarily navigated away the composer.

No receipt plus timeout is not proof of no publication. The reported later Page timeline with two old posts is also not authoritative absence evidence. Mac has not performed a fresh authenticated Business published-list readback for this historical attempt. The available supported browser connection is Ian's separate extension profile, not the dedicated CDP profile 17921; the previously hung native Chrome reader was not repeated. Do not bypass that boundary to infer platform state.

## Repair for future authorized attempts

Recheck exact composer asset/destination, approved normalized body/hash, media count, Public audience and forbidden switches. Require a unique visible/enabled Publish button and a normal Playwright actionability trial (trial=true, 5-second bound, no force, no event dispatch). Persist this sanitized form evidence in the same submit-intent record. Repeat immediately before the sole real click and retain sanitized stage/flags in a failed job's evidence. Preserve a composer after uncertainty; disconnect without closing it until independent published-list evidence is obtained.

This is not a historical recovery authorization. Keep the original UNKNOWN, attempt, intents, receipt absence, consumed permit and PENDING lease unchanged. Do not retry, reset, change UNKNOWN to FAILED, renew a permit or create a replacement job. Only independently verified identity + exact frozen-body/platform-post readback can confirm publication. Reliable absence and all preparation/upload/draft side effects must be resolved before proposing a separately authorized recovery; a new submission permission must explicitly bind its job/content/account/actor/Page/mode/hash/media/expiry and retain the original attempt audit. If absence cannot be proven, report unresolved reconciliation rather than resubmit.
