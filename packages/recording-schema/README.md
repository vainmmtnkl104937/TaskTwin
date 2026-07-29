# TaskTwin Recording Schema

`@tasktwin/recording-schema` is the framework-independent contract boundary
for sanitized TaskTwin recording artifacts and control-plane synchronization.
It extracts the current version 3 event and candidate JSON shape from the
extension without depending on Chrome or the DOM.

The package exports strict Zod schemas and inferred TypeScript types for:

- Recording targets, payloads, candidates, and accepted events
- Immutable-by-convention `RecordingArtifact` version 1
- Deterministic aggregate `RecordingPrivacySummary` version 1
- Session creation, bounded event batches, and completion requests
- Safe session creation, batch, completion, and metadata responses

The artifact validator requires contiguous sequence numbers from one, unique
event IDs, matching session IDs and origins, exact event and final-sequence
counts, and a privacy summary derived from the events. An empty artifact uses
`eventCount: 0` and `lastSequence: 0`.

Event batches contain one through `MAX_RECORDING_BATCH_EVENTS` (100) events.
Their declared count and sequence range must exactly match ordered contiguous
events from one client session. Unknown properties are rejected.

The package reuses `@tasktwin/locator-engine` and
`@tasktwin/privacy-engine`; it does not duplicate their locator or privacy
contracts. Existing block and mask invariants, sensitive target filtering, and
sensitive locator filtering remain active at every event validation boundary.
Validation also independently classifies persisted target metadata so a client
cannot weaken a password or other deterministically sensitive target by
declaring it general. Recognized authentication, financial, and identity
literals are rejected from allowed payloads. A recognized personal literal is
accepted only with an explicit personal/allow decision, preserving the existing
user setting while keeping mask as its default. The aggregate privacy summary
contains counts only and never includes captured values.

This package contains no Chrome, DOM, NestJS, Prisma, database, HTTP client,
Playwright, or AI behavior. Storage limits, outbox state, database
transactions, authorization, and transport orchestration belong to their
respective application boundaries.

## Fixture

`fixtures/valid-recording-artifact.v1.json` is a reusable sanitized artifact
with public/allow, personal/mask, and authentication/block examples. It
contains no real credentials or personal information.

## Commands

```sh
pnpm --filter @tasktwin/recording-schema lint
pnpm --filter @tasktwin/recording-schema typecheck
pnpm --filter @tasktwin/recording-schema test
pnpm --filter @tasktwin/recording-schema build
```
