# ADR-024: Deterministic locator repair proposals

## Status

Accepted for Session 23.

## Context

Page evolution can invalidate an otherwise valid Published locator. Repeating
an action with an unverified runtime locator could duplicate a side effect,
while uploading page content for remote repair would violate TaskTwin's local
privacy boundary.

## Decision

TaskTwin generates a bounded candidate list locally with existing deterministic
locator scoring and privacy classification. Mutating steps require a known
`not_started` effect. Candidate tests are unique-match, read-only checks bound
to the current page context. The active run is never patched or resumed.

The Control Plane persists only bounded candidate metadata and bindings to the
exact run, immutable source version, step, attempt, repair request and source
locator digest. A passed candidate may replace only that locator in an existing
compatible Draft. Application requires writer membership, an expected revision,
unchanged target locator and full workflow validation. Published, Testing and
Archived definitions remain immutable; Draft creation and publishing are
explicit user actions.

## Consequences

Repairs are auditable, deterministic and privacy-preserving, but they require a
new run after manual Draft publication. Navigation invalidates outstanding
candidate tests. The MVP neither learns from proposals nor uses AI, XPath,
screenshots, DOM uploads or automatic repair.
