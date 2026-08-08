# Scheduled workflows with local secrets

Schedule creation and every occurrence analyze existing workflow secret references. Runtime variables, file inputs, Approval steps, and manual repair remain unsupported for unattended scheduling.

For secret workflows the selected Runner must have a READY synchronized Local Secret Store containing every required alias. The Web shows only alias availability and local CLI guidance; it has no secret value form.

Every dispatched run pins the vault ID, inventory revision, and metadata digest. Claim checks that the Runner and server still agree with the pin. A mismatch produces the safe `secret_inventory_changed_before_execution` result and auto-pauses the source schedule before Chromium launch. After an operator synchronizes the new inventory and resumes, a future occurrence pins the new revision.

A Session 29 manually unlocked Runner remains schedule-compatible while its
process lives. Session 30 adds `boot_resilient` only for a verified Windows
service with successful native unlock and inventory synchronization. Restart
never resumes an old scheduled run; existing lease expiry and Interrupted
handling protect ambiguous outcomes.
