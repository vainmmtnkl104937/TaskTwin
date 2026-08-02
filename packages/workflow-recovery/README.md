# @tasktwin/workflow-recovery

Framework-independent deterministic recovery contracts and policy. Automatic
retry is limited to explicitly allowlisted read-only failures. Manual repair is
bounded, requires a durable approved repair request, and is unavailable when a
side effect may have occurred or an Approval Step gates the failed action.

The package stores only safe metadata. It contains no Playwright, HTTP,
database, UI, raw errors, locators, URLs, runtime values, secrets or outputs.
