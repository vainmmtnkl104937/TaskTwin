# @tasktwin/runner-protocol

Framework-independent runtime contracts and deterministic state rules for
TaskTwin Local Runner pairing, runner authentication, heartbeat, and safe
device presentation.

Zod is the runtime source of truth. The package contains no NestJS, Prisma,
React, Next.js, Node filesystem, Playwright, Chrome, persistence, network, or
execution behavior.

Pairing polling is a discriminated union. Device metadata is a bounded
allowlist and excludes usernames, paths, environment values, process data,
cookies, and arbitrary machine metadata. Secret-bearing protocol values are
strictly bounded but must never be logged or exposed to the web management UI.

Execution features are explicit bounded capabilities. A Local Runner advertises
`workflow_verification_v1` only when its Playwright workflow adapter supports
the Session 19 verification contract; the Control Plane uses that capability
to reject incompatible dispatch before a run starts.
