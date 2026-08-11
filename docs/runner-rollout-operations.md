# Runner rollout operations

1. Import and review a signed release; confirm it is `available`.
2. Create a Workspace rollout with ordered stages and explicit Runner IDs.
3. Activate the rollout, then activate only the first pending stage.
4. Perform updates locally on each selected machine with the Session 32 CLI.
5. Observe authenticated heartbeats until every active assignment converges.
6. Review the completed stage and explicitly activate the next stage.

An old but explicitly compatible actual version may continue to claim work and
is `update_available`; desired mismatch alone is not a claim failure. An
`update_required` or `unsupported` Runner cannot claim. A Runner actually on a
blocked catalog release cannot claim even if its protocol metadata would
otherwise be compatible.

Pause prevents later stage activation but does not cancel a local update or
remove existing assigned intent. Cancel stops progression, clears pending
desired targets only when the rollout still owns them, and leaves converged
machines untouched. Rollback state is observation of a local transition and
always requires human review; the Control Plane never retries or executes a
rollback.
