# TaskTwin severity model

Severity describes the impact a defect has on the V1 product contract. It does
not describe effort, nor the complexity of a fix. Promotion to the next release
tag requires zero open V1 release blockers (P0) and no unresolved P1 in
acceptance-critical paths.

| Severity | Definition | Promotion impact |
| --- | --- | --- |
| **P0 — V1 release blocker** | Breaks a V1 primary user journey, breaks a documented security, privacy or policy invariant, blocks UAT progress for the whole release candidate, or removes operator visibility into a fail-closed path. | Must be fixed before the next product release tag. Cannot ship. |
| **P1 — High-value usability** | Degrades a primary V1 journey without breaking it, surfaces a confusing or misleading empty/loading/error/permission state, or hides a deterministic audit/event detail the operator must see. | Should be fixed in the same stabilization pass. A candidate may not ship with an open P1 in a primary journey; legacy P1s are tracked but must not block UAT. |
| **P2 — Polish** | Cosmetic, copy quality, micro-interaction timing, or secondary workflow gap. | Tracked. May ship; should be fixed opportunistically. |
| **P3 — Nice-to-have** | Improvement that does not affect any current user journey. | Tracked. May ship in a future session. |

## V1 primary user journeys

A defect qualifies as P0 or P1 only if it touches one of:

- First sign-in and Workspaces home.
- Local Runner pairing, secret store initialization, revocation.
- Record → Draft → Publish → Run journey.
- Approval, repair, schedule, audit, notification, fleet journeys.
- Loading, empty, error and permission states on the pages above.

## Closing the loop

Each entry in `docs/uat/known-issues-v1.0.0-rc.1.md` carries exactly one
severity. The register is reviewed before promoting to the next product release
tag. Closing a defect means removing the entry and adding a session note to
`docs/ai/SESSION_INDEX.md`.