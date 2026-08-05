# @tasktwin/workflow-policy

Framework-independent deterministic Workspace execution-policy contracts and
evaluation. The package validates and canonicalizes versioned policy data,
normalizes origin patterns, derives action intent and base risk, aggregates all
matching rules, and verifies immediate Approval bindings.

The package does not perform HTTP, database, browser, Playwright, filesystem,
cryptographic, or AI operations. Application boundaries compute SHA-256 over
the exported canonical JSON representation.
