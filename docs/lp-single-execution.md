# LP one-time execution

Task: `VB-PUBLISHER-V1-V2-INTEGRATION-PLAN-20261005-001`.

Global execution and scan scheduling stay at `0`. A local administration command can issue exactly the approved LP text job's two-hour permit. It checks the existing READY task's complete frozen scope and rejects any previous permit, attempt, preparation intent, submission intent, receipt or media. No HTTP endpoint grants or renews execution permission.

After deployment, Mac may run `node scripts/lp-single-execution.mjs /existing/private/publisher-unified.sqlite --grant` once. The command contains the exact approved job, content, customer, account, actor, Business Page, platform, browser transport, snapshot hash, zero-media requirement and user-message audit reference. `--revoke` explicitly revokes an unconsumed permit. Neither command submits a Facebook post or accesses credentials.

An authenticated browser reads `/api/unified/workspaces/<workspace>/jobs/<job_id>/execution-capability`. The jobs list also returns `canExecute` and `execution`. Only the allowed READY job gets an enabled **执行此任务一次** button. Global automation `supported` flags remain false; third-party app tokens cannot execute. Host, authentication, Origin and CSRF validation still apply.

The executor validates and consumes permission inside the same `BEGIN IMMEDIATE` transaction as claim, before acquiring browser resources or creating a driver. The attempt ID and audit event persist in that transaction. Double clicks and separate connections cannot consume twice. A consumed, expired or revoked record cannot be reissued, renewed or recovered, even after a restart or manual reopen. Browser locks, frozen media checks, platform identity checks, duplicate guards, submit intents and independent platform readback remain in force.

Mac must leave the real permit AVAILABLE after deployment. The original dot browser worker executes the existing task once and reads the independent platform result. If it fails or reaches UNKNOWN, it must stop and report the retained task and permit state. A lost browser connection or absent API response never authorizes another execution request. The permit is consumed at claim, so failure before final submit also spends it. A crash after claim is recovered as UNKNOWN without restoring permission.
