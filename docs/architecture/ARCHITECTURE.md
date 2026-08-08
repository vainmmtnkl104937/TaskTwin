# TaskTwin Architecture

## Overview

TaskTwin is designed as a local-first browser automation system with two
execution boundaries:

```text
Control plane                              Local execution plane
┌──────────────────────┐                   ┌──────────────────────┐
│ Web application      │                   │ Chrome extension     │
│ Review and status UI │                   │ Browser interaction  │
└──────────┬───────────┘                   └──────────┬───────────┘
           │                                          │
┌──────────▼───────────┐                   ┌──────────▼───────────┐
│ API                  │                   │ Local runner         │
│ Coordination boundary│                   │ Approved execution   │
└──────────────────────┘                   └──────────────────────┘
```

Session 01 establishes only the component shells shown above. The arrows
describe intended responsibility boundaries, not communication implemented in
this session.

## Control plane

The web application, API, and PostgreSQL database form the control-plane side
of the architecture.
The web application will eventually present workflow information and review
states. The API will coordinate control-plane operations. It is not intended to
drive a browser directly.

The web application remains a static landing page. The API exposes its original
`GET /health` liveness endpoint and `GET /health/database` for database
readiness. Session 04 adds registration, login, current-user, and
membership-scoped workspace reads. Session 10 adds one recording-to-draft
workflow creation endpoint, not general workflow CRUD. There is still no
workflow editor, queue, web authentication UI, or API-to-runner connection.

## Control-plane persistence

`@tasktwin/database` owns Prisma configuration, the generated client boundary,
and persistence code. It is a framework-independent package: NestJS dependency
injection and HTTP health behavior stay in `apps/api`.

The control-plane database stores identity and tenancy concepts alongside
versioned workflows:

- `User` stores a normalized unique email, Argon2id password hash, display name,
  and active state.
- `Organization` is the tenant boundary.
- `OrganizationMember` links a user to an organization with one exact role.
- `Workspace` belongs to one organization and scopes workflows.
- `Workflow` is the stable identity and current descriptive metadata.
- `WorkflowVersion` is an append-only revision containing lifecycle status,
  schema version, and the complete workflow definition as PostgreSQL `JSONB`.
- `RecordingWorkflowConversion` links a completed source recording and client
  idempotency key to the created workflow, version, actor, and validated
  conversion report.

`(workflowId, version)` is unique, so a second record cannot overwrite the same
revision. The repository exposes creation but no update operation. A workflow
definition is parsed with `WorkflowDefinitionSchema` before a transaction or
write begins; TypeScript alone is not trusted at this boundary. Application
validation enforces positive workflow and schema versions.

Every new workflow must belong to a workspace. Existing workflows cannot be
assigned safely without tenant knowledge, so the Session 04 migration refuses
to run if the pre-Session-04 workflow table is non-empty.

The `Workflow` relation cascades to versions only when no conversion receipt
depends on them. Conversion receipts use restrictive foreign keys for the
recording, workflow, version, and creator, so persisted provenance cannot be
orphaned by deleting a converted workflow. No administrative deletion or
workflow CRUD is exposed in this session, and normal version writes remain
immutable.

PostgreSQL belongs only to the control plane. The Chrome extension and local
runner do not connect to it, and browser execution remains local.

## Authentication and organization authorization

Registration normalizes email through the shared database-package boundary,
hashes the password with Argon2id, and creates the User, Organization, OWNER
membership, and Default Workspace in one Prisma transaction. Explicit response
mappers expose only safe user fields.

Login returns a short-lived HS256 access token. The application payload
contains only `sub`, the immutable user ID; standard `iat` and `exp` claims are
added by the JWT library. Organization roles and mutable workspace permissions
are not embedded in the token. Protected requests verify the token, then load
the current active user from the database.

`GET /workspaces` does not trust an organization ID from the client. Its
database query reaches workspaces only through organizations for which the
current user has an `OrganizationMember` record. A reusable role decorator and
guard operate only on an internally attached, verified organization context.
No Session 04 endpoint needs an organization role decision beyond the
membership-scoped query, so the role guard is provided and independently
tested without being attached to an artificial route.

## Local execution plane

The Chrome extension and local runner form the local execution side. Browser
access belongs here so that future browser interaction happens in the user's
environment rather than in a remote cloud browser.

Session 05 makes the extension service worker the authoritative recorder-state
coordinator. The popup sends validated commands and renders state, while a
dynamically injected content script receives validated state notifications.
Recorder state uses session-scoped Chrome storage so popup closure and
service-worker suspension do not lose it.

Session 06 keeps the service worker authoritative for the event timeline.
The content script uses document-level delegated listeners to construct strict,
sanitized event candidates. The worker accepts candidates only while recording
and only from the bound top-level tab and origin. It then assigns session ID,
tab ID, event ID, and monotonically increasing sequence before persisting the
accepted event. Candidates cannot choose authoritative envelope fields.

The capture boundary supports actionable primary clicks, debounced text-input
changes, single selects, checkboxes, and selected radios. Pending input is
flushed before blur, pause, and stop. Password and one-time-code values are
stored as masked nulls; hidden and file inputs are ignored. Target snapshots
use a bounded allowlist rather than DOM serialization or arbitrary attributes.
The popup receives only event count and a fixed event-category summary.

Session 07 adds a DOM-to-contract boundary without changing timeline
authority. The extension DOM adapter reads only bounded, allowlisted metadata,
derives accessible names and labels, and checks every proposed locator against
the current document. It passes observations to
`@tasktwin/locator-engine`, whose framework-independent rules score, deduplicate,
rank, explain, and assign confidence. Only candidates matching exactly one
element are included.

New accepted events use timeline schema version 2 and contain a validated
`LocatorBundle` version 1. The primary candidate is unique, fallbacks are
unique and ordered, and CSS is a bounded low-priority fallback. The storage
adapter writes the v2 key and can read the previous v1 key for popup summary
compatibility. A new recording always replaces legacy data with an empty v2
timeline; old events are not silently upgraded because they have no verified
locator bundle.

Session 08 introduces a second pure decision boundary:
`@tasktwin/privacy-engine`. The extension converts only bounded allowlisted
control metadata into a privacy input; the engine classifies sensitivity,
resolves an allow, mask, or block policy, and returns a strict version 1
decision with fixed matched-rule IDs, reasons, and confidence. The classifier
is deterministic and local. It sends no page metadata or recording value to
the control plane, a backend service, or an AI model.

Authentication, financial, identity, and health values are blocked regardless
of settings. Personal values are masked by default, and unknown-sensitive
values remain masked. Allowed values retain the existing length bounds, masked
values become null, and blocked values are omitted. Sanitization occurs before
the service worker persists the accepted event. The service worker still owns
sender/session validation, event identity, ordering, timeline capacity, and
storage.

Privacy-aware candidates, accepted events, and timelines use schema version 3
and the `tasktwin.recorder.timeline.v3` storage key. The loader retains
read-only summary compatibility with Session 07 v2 and Session 06 v1 data.
Legacy events are not assigned inferred privacy decisions or silently upgraded.

Target descriptions and locator observations pass through the same privacy
boundary. Sensitive literal text is removed from previews, labels, accessible
names, placeholders, and locator values. Safe structural metadata remains:
the extension can retain a stable test ID or stable ID on a sensitive control
when the identifier itself contains no sensitive data. Input values never
participate in locator identity.

Privacy settings use a strict version 1 contract in `chrome.storage.local`
under `tasktwin.privacy.settings.v1`. They control personal-data allow/mask
behavior, whether otherwise allowed text controls are included in redaction
geometry, and whether the local preview is visible. Missing or invalid settings
fall back safely. No setting can weaken a blocked classification.

The extension privacy DOM adapter scans only explicitly supported relevant
controls. It does not inspect a complete form or page body and does not read
field values while planning geometry. Visible non-zero rectangles enter a
pure `RedactionPlan` version 1 builder, which normalizes coordinates, clamps
them to the CSS-pixel viewport, rejects zero-area results, deterministically
merges or deduplicates significant overlaps, orders the result, and enforces a
hard region limit. Device pixel ratio is retained for a future image boundary;
Session 08 captures or stores no screenshot.

An optional fixture-only preview renders non-interactive removable overlays in
the active recording context. Overlays use `pointer-events: none`, do not
modify values, and are excluded from target and locator metadata.

The event timeline shares the recorder's `chrome.storage.session` lifecycle.
It has a hard capacity. Reaching the limit changes the recorder to an explicit
error instead of silently discarding older or newer events. Starting a new
recording explicitly replaces the prior session timeline; stopping preserves
the completed timeline for popup inspection until the next start.

Session 09 separates active recorder state from durable recording history.
State and the active timeline remain in `chrome.storage.session`. After
pending input has been flushed and capture has entered `stopping`, the service
worker validates the complete current timeline and builds
`RecordingArtifact` version 1. Only a fully validated artifact may enter the
bounded archive in `chrome.storage.local`.

The local archive and outbox are strict versioned data. Exact finalization
retries preserve the existing artifact and outbox state; different content
under the same client session ID is rejected. Capacity and byte limits fail
explicitly. No unsynced recording is evicted or overwritten automatically.
Outbox state contains only identifiers, fixed status/error codes, attempt
metadata, and timestamps. It contains no credential.

The extension exposes a create/batch/complete transport port for future
authenticated delivery. Session 09 tests this port with a mock but does not
connect it to an HTTP implementation, choose a workspace, store a JWT, or
schedule retries.

The extension requests only `activeTab`, `scripting`, and `storage`.
`activeTab` limits page access to the tab explicitly selected when the user
invokes the extension. There are no host permissions or static content
scripts.

Session 14 gives the runner a secure control-plane identity without giving it a
user JWT. Pairing uses a displayed one-time user code and an undisplayed
high-entropy device code. An OWNER or ADMIN binds the request to one Workspace.
The server persists only keyed code digests and a credential hash.

The runner stores its opaque credential locally through an atomic
credential-store abstraction and authenticates with the separate
`TaskTwinRunner` scheme. Heartbeats update last-seen and credential-last-used
timestamps. Online/offline is derived from last-seen; revocation invalidates
both device and credential. This foundation still has no Playwright, browser
launch, job polling, arbitrary command channel, or workflow execution.

## Package boundaries

- `packages/shared-types` contains framework-independent contracts that cross
  workspace boundaries. Session 01 defines only service health.
- `packages/workflow-schema` is the runtime-validated, framework-independent
  contract shared by the extension, API, web editor, and local runner. It
  defines data only and does not depend on any application framework.
- `packages/database` is the framework-independent Prisma persistence boundary.
  It depends on `workflow-schema` to validate definitions before writes, but it
  has no NestJS or application dependency.
- `packages/config` centralizes strict TypeScript and ESLint configuration.
- `packages/locator-engine` owns pure locator contracts, scoring constants,
  dynamic-value heuristics, deterministic ranking, explanations, and
  confidence. It depends only on the shared workflow locator contract and Zod;
  DOM and Chrome behavior remain in the extension.
- `packages/privacy-engine` owns pure privacy contracts, bounded rule
  dictionaries, deterministic classification and policy, sanitization
  results, and redaction-plan geometry. It depends on no browser or
  application framework; DOM metadata collection, Chrome storage, and preview
  rendering remain in the extension.
- `packages/recording-schema` owns current recording events, deterministic
  privacy summaries, immutable artifacts, bounded batch/completion contracts,
  and safe sync responses. It reuses locator and privacy schemas while
  remaining independent from Chrome, DOM, NestJS, Prisma, Playwright, and AI.
- `packages/recording-converter` owns pure deterministic translation from a
  validated recording artifact to a draft workflow and conversion report. It
  reuses recording, workflow, locator, and privacy contracts without depending
  on NestJS, Prisma, Chrome, DOM, Playwright, storage, network, or AI.
- `packages/runner-protocol` owns strict runner metadata, pairing, polling,
  authentication-header, heartbeat, connection-status, and local credential
  record contracts plus deterministic state rules. It has no filesystem,
  network, NestJS, Prisma, React, Next.js, Chrome, Playwright, or execution
  behavior.
- `packages/workflow-engine` owns framework-independent execution contracts,
  preflight, run and step state machines, sequential orchestration, timeout,
  cancellation, progress, safe results, and deterministic termination rules.
  Playwright and application-framework objects never cross its adapter
  boundary.
- Application packages own framework bootstrapping and presentation, without
  introducing domain behavior.

Recorder message contracts and deterministic transition logic currently live
inside `apps/extension` because only extension contexts consume them. They are
kept independent from Chrome adapters so they can be tested without a browser.

Future policy and execution packages described by the project direction are
intentionally absent until their sessions define them.

## Workflow contract

`@tasktwin/workflow-schema` uses Zod as the runtime source of truth. TypeScript
types are inferred from the same schemas so compile-time consumers and
untrusted JSON inputs share one contract.

Workflow definition version 1 is a strict, JSON-serializable object. Its
`steps` array records execution order explicitly. Steps, locators, value
sources, and assertions are discriminated unions, which gives each variant a
stable discriminator and variant-specific required fields. Unknown variants
and unexpected object properties are rejected.

Session 10 adds the backward-compatible `setChecked` step. It records the
desired boolean state of a checkbox or radio rather than representing a
stateful control as an ambiguous click.

`schemaVersion` versions the shape of the contract. The separate positive
workflow `version` identifies immutable workflow-version lineage. Session 13
enforces Published immutability at application and persistence boundaries;
the schema alone cannot enforce changes across stored records.

Runtime validation is required because workflow definitions will eventually
cross extension, API, editor, file, and local-runner boundaries. TypeScript
types disappear at runtime and cannot protect those boundaries by themselves.
The schema package remains independent from Next.js, NestJS, Chrome APIs,
Prisma, and Playwright so every plane can consume the same domain contract.

## Recording sync contract and persistence

The extension and control plane share `@tasktwin/recording-schema`; they do not
maintain separate interpretations of a current event. Artifact schema version
1 wraps current privacy-aware event version 3. Legacy extension timelines
remain explicit read-only compatibility formats and are not silently upgraded.

The control plane stores:

- `RecordingSession`: immutable artifact metadata, workspace, creator,
  declaration, received counters, and receiving/completed state.
- `RecordingEvent`: validated sanitized event JSON plus client event ID and
  sequence used by relational uniqueness.
- `RecordingSyncBatch`: processed client batch ID, range, count, and digest.

Session creation is idempotent by globally unique `clientSessionId`. Batch
receipt is idempotent by `(recordingSessionId, clientBatchId)`, while separate
unique constraints protect client event IDs and sequences. Batch receipt,
event insertion, and session counters share a serializable transaction.

Completion does not trust counters or JSONB. It loads ordered stored events,
parses each current event, reconstructs the artifact, recomputes its privacy
summary, and verifies the full contiguous sequence before atomically marking
the session completed. Completed sessions reject new batches. Metadata queries
use an explicit safe selection and never return event JSON.

The shared event validator also treats the client privacy decision as
untrusted input. It independently classifies the bounded persisted target,
rejects policy weakening, and checks allowed payload strings for deterministic
personal, authentication, token, long-number, and related sensitive-literal
patterns before the repository opens a transaction.

Recording API resources are resolved through the current user's
`OrganizationMember` relation. OWNER, ADMIN, and MEMBER can create, upload,
complete, and read; VIEWER can read safe metadata only. Role and workspace
authority are current database state, not JWT claims.

## Recording-to-workflow conversion

A completed recording remains immutable source evidence. It is reconstructed
from ordered persisted events and parsed as a complete `RecordingArtifact`
before conversion. `@tasktwin/recording-converter` then applies fixed rules:

```text
Completed RecordingArtifact
  -> complete runtime validation
  -> deterministic event mapping in sequence order
  -> draft WorkflowDefinition + RecordingConversionReport
  -> workflow-schema validation
  -> one transaction:
       Workflow
       WorkflowVersion(version 1, draft)
       RecordingWorkflowConversion receipt
```

The converter does not read the clock or generate random IDs. The persistence
layer supplies the workflow ID; step IDs, safe names, variable names, mappings,
deduplication, and issue order depend only on the validated artifact and
conversion options.

Click, allowed fill, select, checkbox, and selected-radio events map to explicit
workflow actions. Checkbox and radio use `setChecked`. Masked personal input
uses a required variable without reconstructing its value. A replayable
blocked password may use a secret reference name, never a secret value.
Unsupported, truncated, or unsafe events remain represented as unresolved
entries. Exact consecutive redundant state-setting events may be deduplicated,
but their provenance remains in the report.

The report maps every event ID and sequence to a generated step, retained step,
or unresolved issue. Recorded locator fallbacks and confidence stay in this
validated report because workflow steps currently store only their executable
primary locator. A blocking issue sets `publishable: false`; it does not
publish, execute, or silently repair the draft.

The conversion endpoint is authenticated and resolves the source recording
through current organization membership. OWNER, ADMIN, and MEMBER may convert;
VIEWER may not. The workflow workspace is copied from the source recording,
never accepted from the request. The unique
`(recordingSessionId, clientConversionId)` receipt key backs exact retry
idempotency, and Workflow, WorkflowVersion, and receipt share one serializable
transaction.

## Draft workflow editor

`@tasktwin/workflow-editor-core` contains pure immutable transformations over a
version 1 `WorkflowDefinition`. It has no React, Next.js, NestJS, Prisma, DOM,
or browser dependency. Callers provide IDs for inserted steps. The package
derives a deterministic linear node-and-edge projection, but
`WorkflowDefinition.steps` array order remains the only execution-order
authority.

The web editor uses React Flow only to display and select that projection.
Nodes cannot be dragged into a different execution order and arbitrary
connections, branches, loops, and conditional edges are disabled. Locators are
presented through safe summaries and remain read-only.

The browser sends authentication credentials only to a Next.js Server Action.
That boundary calls the NestJS login endpoint and stores the returned
short-lived access token in an HTTP-only, SameSite cookie. Client JavaScript
does not receive the token, and authenticated control-plane calls use an
explicit server-only route list rather than a general proxy.

Workflow version number and draft revision have different meanings. Version
identifies the immutable workflow-version lineage; revision is an optimistic
concurrency counter for the current draft. Saving requires the expected
revision. The database transaction scopes the row through current organization
membership, checks DRAFT status and immutable identity fields, conditionally
updates by expected revision, increments it atomically, and synchronizes
Workflow name and description. A stale request receives HTTP 409 and cannot
overwrite newer data.

OWNER, ADMIN, MEMBER, and VIEWER may read. Only OWNER, ADMIN, and MEMBER may
write a draft. Testing, Published, and Archived definitions remain immutable
through the editor API.

## Workflow version lifecycle

`@tasktwin/workflow-lifecycle` owns deterministic, framework-independent
transition and readiness rules:

```text
Draft --ready--> Testing --OWNER/ADMIN + ready--> Published --> Archived
  ^                 |
  +-----------------+

Published or Archived --clone--> new Draft (next version, revision 1)
```

Version and revision serve different purposes. A version is a preserved
lineage record. Revision is the optimistic concurrency counter of an editable
Draft and never increases after that Draft leaves editing. The
`WorkflowVersion.status` envelope is authoritative; lifecycle transitions
update status and audit metadata without rewriting definition JSON or
revision. Testing, Published, and Archived are read-only.

The API evaluates publish readiness before Draft enters Testing and again from
the stored definition immediately before publish. Structural validation,
workflow-input cross-reference analysis, a non-empty step list, duplicate step
IDs, and supported schema version are deterministic. Blocking issues stop the
transition; warnings remain visible and do not masquerade as errors. Messages
contain bounded structural context, never literal or secret values.

Publish and version allocation use serializable database transactions and a
row lock on the parent Workflow. Publishing archives any current Published
version and publishes the Testing candidate in the same transaction.
PostgreSQL additionally enforces a partial unique index for at most one
Published version per Workflow. New-version retries use the unique
`(workflowId, clientCreationId)` key and return the prior result. Bounded
serialization retries handle database conflicts without an in-memory mutex.

OWNER and ADMIN may publish and archive. MEMBER may edit Drafts, submit,
return to Draft, and create a new Draft. VIEWER may only read. Every action
resolves current organization membership through the Workflow or
WorkflowVersion resource.

## Safety and trust boundaries

- The extension uses temporary active-tab access and has no broad host
  permissions.
- Passwords cross only registration and login boundaries. Plaintext passwords
  are never logged or stored; password hashes are never selected by normal user
  reads or returned from API responses.
- No browser event, screenshot, cookie, access token, password, or OTP is
  captured as a plaintext secret. Authentication, financial, identity, and
  health values are blocked before timeline persistence. Personal data are
  masked by default, and token-like or unknown-sensitive values are not
  retained as plaintext.
- Recorder storage contains versioned state and a bounded interaction timeline.
  The timeline uses allowlisted, length-bounded target metadata and event
  payloads. Complete page URLs, full DOM, outerHTML, arbitrary attributes, raw
  inbound messages, and input values in the popup are excluded from logs and
  presentation.
- Finalized recording artifacts use bounded local storage and retain the same
  strict event, locator, and privacy validation. Local outbox state contains no
  JWT or raw transport error. Control-plane metadata responses omit raw events.
- Locator data never reads an input value and contains no DOM nodes, HTML,
  arbitrary attributes, complete DOM paths, or full page content. Test IDs use
  a four-attribute allowlist. Text, identifiers, labels, names, placeholders,
  and CSS selectors are normalized and bounded before persistence.
- Privacy classification uses only bounded allowlisted control metadata and
  fixed local rules. Sensitive literals are removed from target and locator
  text before persistence. Redaction plans contain only validated viewport
  geometry, sensitivity, and fixed reasons; no image, DOM node, browser handle,
  or field value is stored.
- Workflow secret value sources store only a validated reference name, never a
  secret value.
- Database credentials come from environment configuration. URLs and passwords
  are not returned by health endpoints or written to application logs.
- JWT signing configuration comes only from validated environment values. The
  access-token lifetime is bounded and the signing secret must be at least 32
  characters.
- The normal unit-test suite mocks persistence and does not silently skip or
  connect to PostgreSQL. The real integration check is opt-in and fails when
  configuration, connectivity, or migrations are missing.
- There is no AI behavior, policy bypass, or silent workflow repair.
- Runner pairing and heartbeat remain separate from local browser execution.
  Session 15 execution accepts no runner credential, JWT, cookie, or saved
  browser state.

## Local Playwright execution boundary

The Local Runner owns all Playwright Library objects. Every execution validates
its complete request before launch, then creates one Chromium Browser, one
isolated non-persistent BrowserContext, and one Page. It never uses a personal
profile, cookie import, persistent storage state, custom selector engine,
workflow JavaScript, or XPath.

The explicit origin allowlist accepts only HTTP/HTTPS origins. Navigate checks
the resolved destination before `page.goto` and the final origin afterward.
Fill and Select resolve only compatible literal or runtime-variable sources;
secret references fail closed before launch.

The workflow `steps` array remains the sole execution-order authority.
Navigate, Click, Fill, Select, SetChecked, and Wait execute sequentially and
stop at the first failure. Playwright actionability and bounded auto-wait are
used without force, retry, or locator repair. BrowserContext and Browser close
on success, step failure, cancellation, and partial setup failure.

Execution results contain bounded identifiers, status, timing, locator kind,
and fixed error codes. Runtime values, complete URLs, query parameters,
cookies, page HTML, console payloads, and raw Playwright errors do not cross
the reporting boundary. Control Plane job coordination and run persistence
remain absent.

## Deterministic workflow-engine boundary

`@tasktwin/workflow-engine` owns execution lifecycle independently from
Playwright. It preflights workflow structure, runtime inputs, secret
requirements, supported steps, explicit origins, and bounded timeout options
before calling an adapter. The engine executes only in steps-array order,
allows one running step, stops at the first failure/cancellation/timeout, and
creates a terminal result for every source step.

The total deadline covers adapter startup and steps. Effective step timeout is
capped by remaining total budget. Step timeout fails the run while total
deadline expiration produces `timed_out`. Cancellation uses an external
AbortSignal and is idempotent. Near-simultaneous termination causes are chosen
by monotonic timestamp with a fixed tie rule: total timeout, cancellation,
then adapter failure.

The Local Runner implements `PlaywrightWorkflowExecutionAdapter`. Browser,
BrowserContext, Page, Locator, post-navigation checks, and raw Playwright
errors remain inside that adapter. Adapter cleanup is awaited after startup
begins; cleanup warnings cannot replace an earlier primary failure.

Progress events and final results contain only bounded identifiers, states,
timestamps, counts, and safe codes. They never contain runtime values, secret
references, complete URLs, raw locators, DOM content, browser objects, or raw
errors. Execution persistence, job delivery, retry, and resume remain absent.

## Build architecture

pnpm manages workspace dependencies through a single lockfile. Turborepo
orders tasks so shared packages build before consumers. Each application and
package exposes its own build, lint, and typecheck scripts where applicable,
while root commands validate the repository consistently.

## Workflow input boundary

`packages/workflow-inputs` sits between the versioned workflow contract and
framework consumers. It scans only allowlisted ValueSource properties in
`steps` array order. The package owns variable usage, secret requirement,
cross-reference, compatibility, temporary runtime-input contracts, and safe
count summaries.

Structural workflow validation remains in `workflow-schema`. Semantic input
validation is repeated by the API before Draft persistence, while the
database repository keeps its existing defense-in-depth complete-definition
validation. Variables remain JSON inside `WorkflowVersion.definition`; no
additional persistence model is introduced.

The web editor holds temporary run-input values only in the mounted preview
component. Secret values have no contract or UI field. File content is never
read or uploaded; only bounded size and media-type metadata may exist until
the preview closes.

## Persisted run-dispatch boundary

`@tasktwin/run-protocol` defines strict JSON contracts around the existing
workflow-engine progress and result schemas. The API creates a WorkflowRun only
from a validated Published WorkflowVersion whose execution needs no runtime
variables, files, secrets or unsupported steps. Allowed origins are derived
from literal Navigate steps and never supplied by the client.

A run is assigned to one RunnerDevice in the same Workspace. Runner
authentication identifies the device; a separate short-lived run lease
authorizes renewal, progress and completion. Only the lease hash is stored.
PostgreSQL row locks, serializable transactions, unique constraints and a
partial one-active-run-per-device index protect concurrent claims.

The Local Runner claims at most one run, renews its lease, executes through the
workflow engine, uploads monotonically sequenced progress and delivers one
validated completion. Cancellation is cooperative. Expired active runs become
Interrupted and are never automatically requeued or executed again.

## Secure run-input boundary

`@tasktwin/secure-run-inputs` owns strict JSON contracts for Runner public
keys, variable and secret-alias manifests, preparations, deterministic AAD,
plaintext payloads and encrypted envelopes. It contains no framework,
database, filesystem, browser DOM, Playwright or platform crypto objects.

The assigned Runner creates a 3072-bit RSA key pair. Only SPKI public-key
material and its SHA-256 fingerprint reach the Control Plane; the PKCS8 private
key remains in the atomic local Runner key store. A Web client obtains a
short-lived preparation, validates variables, generates a fresh AES-256 key
and 96-bit IV, encrypts with AES-GCM, and wraps the content key with RSA-OAEP
SHA-256. The browser posts only the envelope.

AAD binds the preparation, reserved run, Workspace, Workflow and version,
definition digest, assigned Runner, encryption key, client run ID, allowed
origins, execution options and expiry. Commit verifies the exact canonical AAD
and ciphertext digest without decrypting, then creates the run, all step rows,
immutable envelope and consumed preparation in one transaction.

The assigned authenticated Runner receives the envelope only after a valid
claim. It validates binding and expiry, decrypts in memory, validates variables
again, then supplies a non-serializable resolver to the workflow engine.
Secret aliases are resolved by an attended no-echo local prompt; secret values
never pass through Web or Control Plane. Secret leases and mutable buffers are
disposed on terminal paths. JavaScript string memory cannot be guaranteed to
be immediately zeroized.

## Deterministic workflow verification boundary

`@tasktwin/workflow-verification` defines framework-independent verification
contracts, semantic analysis, URL normalization, text normalization, and safe
outcomes. It extends the versioned workflow `VerifyStep` contract instead of
introducing a second step format. Supported rules are deliberately limited to
URL, text, visibility, field value, and checked state.

The workflow engine performs verification preflight before adapter startup and
preserves sequential fail-fast, timeout, cancellation, skipped-step, and
cleanup behavior. Playwright querying and polling remain inside the Local
Runner adapter. Element rules require one unique locator, except that an
absent target satisfies a hidden assertion. Expected and observed values,
complete URLs, raw locators, and Playwright errors never cross the safe-report
boundary.

Runner devices advertise `workflow_verification_v1` only when their execution
adapter supports this behavior. Run preparation and direct dispatch reject a
Verify workflow assigned to a Runner without that capability. No persistence
migration is required because Verify remains part of the existing versioned
workflow JSON and safe per-step results use the existing final-result JSON.

## Ephemeral workflow-output boundary

`packages/workflow-extraction` owns framework-independent output contracts,
producer/consumer analysis, compatibility rules, and safe summaries. An Extract
step produces exactly one immutable string or boolean output. The producer must
precede every consumer in `WorkflowDefinition.steps`.

The Workflow Engine owns a per-execution RuntimeOutputStore. Playwright returns
the produced value only through the internal adapter boundary. The store is
cleared after success, failure, cancellation, or timeout. Public progress and
completion contracts carry metadata only. PostgreSQL mirrors that metadata in
WorkflowRunOutput and never stores output values.

## Human approval boundary

`@tasktwin/workflow-approval` owns deterministic next-step binding, lifecycle
contracts, transition rules, and safe summaries. It has no HTTP, Prisma,
Playwright, UI, filesystem, or browser dependency. An Approval Step gates only
the following entry in `WorkflowDefinition.steps` and is invalid at the end.

The workflow engine enters `waiting_for_approval` and delegates coordination
through an injected interface without invoking the browser adapter. The Local
Runner creates and polls the persisted request while heartbeat and lease
renewal remain active. The isolated BrowserContext is retained but inactive.
Rejection cancels, expiry times out, and lease loss or Runner revocation
interrupts the run.

The API derives message, risk, and gated-step metadata from the immutable
Published WorkflowVersion. OWNER and ADMIN may decide; MEMBER and VIEWER have
read-only access. Unique request and decision identifiers plus atomic updates
make exact retries idempotent and concurrent decisions single-winner.

## Conservative recovery boundary

`@tasktwin/workflow-recovery` owns framework-independent effect certainty,
retry classification, attempt limits, repair state transitions and safe JSON
contracts. Unknown or possibly side-effecting failures fail closed. Only
explicitly transient Verify and Extract failures may retry automatically, at
most once; action and navigation steps never retry automatically.

Manual repair is opt-in per run and requires an attended headed Runner that
advertises `workflow_manual_repair_v1`. The engine pauses only the current
failed step and retains in-memory runtime state. The Runner keeps the isolated
BrowserContext and run lease alive without performing browser actions until a
Retry or Abort decision arrives. Every manual retry is bound to an approved,
persisted repair request; approval-gated steps and uncertain side effects
require a new run.

PostgreSQL stores bounded safe attempt and repair metadata only. It excludes
raw errors, runtime values, secrets, outputs, locators, complete URLs, DOM and
screenshots. Idempotency keys and serializable row-locked decisions provide a
single winner for concurrent Retry and Abort.

## Locator repair proposal boundary

`@tasktwin/workflow-locator-repair` owns framework-independent eligibility,
privacy eligibility, deterministic ranking, candidate contracts and immutable
locator-only patching. It reuses the workflow locator contract, locator engine,
privacy engine and recovery effect certainty without importing Playwright,
Prisma, NestJS or React.

For a locator-not-found or locator-not-unique failure, mutating steps are
eligible only when the action is known `not_started`; read-only Verify and
Extract steps may also use `read_only`. The Local Runner inspects only bounded
relevant elements, removes privacy-blocked candidates, and uploads at most five
safe locator candidates. It never uploads DOM, HTML, field values, screenshots
or complete URLs.

Candidate tests remain inside the current isolated BrowserContext and use only
read operations. A navigation-derived page-context digest rejects stale tests.
The failed run stays paused and is never continued with a replacement locator.
A passed candidate can replace exactly one locator in a compatible existing
Draft. PostgreSQL row locks, idempotency digests, source-locator digests and
expected Draft revision prevent conflicting or stale application; complete
workflow validation runs before the Draft revision is atomically incremented.

## Deterministic execution-policy boundary

`@tasktwin/workflow-policy` owns JSON policy contracts, canonicalization,
origin matching, action intent, risk aggregation and safe evaluations without
framework or runtime dependencies. Validation answers whether data is shaped
correctly; policy answers whether a valid action may execute.

The Control Plane versions policy per Workspace, evaluates it during authoring
and run creation, and pins one immutable policy revision to each run. Queued
runs fail if that revision is no longer active. Claimed runs retain their
pinned semantics. The Local Runner recomputes both digests and evaluation,
checks navigation destinations and redirects, and checks current page origin
before browser actions. Neither Web, Runner payloads nor AI output can supply an
override.

## Append-only audit trail boundary

`@tasktwin/audit-trail` owns the canonical event taxonomy, payload schemas,
canonical JSON, hash-chain construction, the appender and the
`verifyAuditChain` helper without framework or database dependencies. It
exposes a `WorkspaceAuditTrailReader` interface that the API's
`WorkspaceAuditTrailRepository` implements against PostgreSQL.

The Control Plane appends one typed audit event inside the same Prisma
transaction as the domain mutation. Append-only enforcement is dual: the
application refuses updates/deletes through repository wrappers and a
PostgreSQL trigger raises an exception for any `UPDATE` or `DELETE` against
`workspace_audit_events`. The hash chain uses SHA-256 over canonical JSON,
linking each event to its predecessor. Verification re-hashes the chain from
the first recorded event through the latest head and returns `ok`,
`sequence_gap` or `tampered` with the first failure sequence and kind.

Payloads are validated by per-event-family zod schemas and never contain
observed/expected values, secrets, tokens, locators, URLs, screenshots or
runtime outputs. Run evidence is a typed subset of safe execution events
that omits attempt-level and output-level events.

## Scheduled Execution

TaskTwin supports scheduled workflow runs through a database-backed scheduler.
The scheduler is implemented in `apps/api/src/scheduler` and is powered by the
framework-independent `packages/workflow-scheduling` package.

### Scheduler

- Polls every 30 seconds for due ACTIVE schedules.
- Multiple instances use `FOR UPDATE SKIP LOCKED` for safe concurrency without
  Redis or in-memory mutexes.
- Creates occurrence and WorkflowRun in a serializable transaction.
- The `scheduled_execution_v1` capability is advertised only when the Runner
  is in unattended headless mode.

### Schedule Types

- **one_time**: fires once at a specific local instant in an IANA timezone.
- **daily**: fires every N days (1-365) at a local time, with an optional
  end date.
- **weekly**: fires on selected weekdays every N weeks (1-52) at a local time,
  with an optional end date.

All schedules are created with a pinned WorkflowVersion and use validated IANA
timezone identifiers.

### Timezone Handling

- All schedules use validated IANA timezone identifiers.
- DST handling: nonexistent local times are skipped, ambiguous times use the
  earlier UTC instant.
- Uses Luxon for timezone arithmetic; no manual Date manipulation.

### Concurrency

- Occurrence idempotency: unique constraint on `[scheduleId, scheduledFor]`
  (stored as UTC instant).
- Active run guard: unique constraint on `[scheduleId]` for active scheduled
  runs.
- Runner capacity: active scheduled run check per runner.

### Policy

- The current active policy is evaluated at every occurrence dispatch.
- Policy change: occurrence skipped, schedule auto-paused.
- WorkflowVersion pinning: schedule stays on selected version.

### Start Window

- Scheduled runs must start within a bounded window (default 5 minutes).
- Expired unclaimed runs are reconciled to `TIMED_OUT`.
- `missed_start_window` policy controls behavior on missed windows.

### Ambiguous Outcomes

- INTERRUPTED or side-effect-unknown runs trigger automatic schedule pause.
- OWNER or ADMIN must review and manually resume.
- No automatic retry or Run Now for scheduled runs.

# Operational alerts and notification delivery

Durable domain transitions can call the API `OperationalAlertAppender` with their existing Prisma transaction. The appender validates `@tasktwin/operational-alerts`, resolves recipients from current membership, persists the unique alert and per-user IN_APP outbox rows, and appends a safe audit event before commit. It never performs delivery.

`apps/notification-worker` is a non-HTTP database consumer. PostgreSQL `SKIP LOCKED`, database time, worker fencing and expiring leases allow multiple instances and crash recovery. In-app delivery rechecks membership, creates a unique UserNotification, and completes the outbox message atomically. This is at-least-once processing with idempotent effects, bounded retry and a terminal dead-letter state.

# Privacy-safe operational telemetry

`@tasktwin/operational-telemetry` owns component-health, freshness, fixed-window, bucket, rate and strict snapshot logic without knowledge of NestJS, Prisma, React or infrastructure providers. API, enabled Scheduler and Notification Worker processes persist only random boot UUIDs and lifecycle timestamps using database time.

Liveness is independent of PostgreSQL; readiness is a lightweight dependency/configuration check. Authorized Operations reads aggregate structured Workspace data directly and are not audit events. Audit integrity is distinct from process health: a chain is valid only after an authoritative full verification, and a later chain head returns it to `not_verified`.

The Operations Dashboard is deliberately not a public metrics endpoint. IDs, workflow data, runtime values, secrets, locators, URLs and browser errors are not metric labels or snapshot fields. External telemetry vendors, distributed tracing and infrastructure alerting remain outside the architecture.

# Local Secret Store

Secret plaintext belongs exclusively to the Local Runner. `packages/local-secret-store` defines portable vault, inventory, AAD and pin contracts, while the Runner owns platform cryptography, no-echo input, file locking and atomic persistence. The Control Plane stores only alias/random-version inventory metadata and monotonic revision trust. Scheduled runs pin this safe inventory identity and are rejected before execution when it changes. See [ADR-030](../adr/ADR-030-local-secret-store.md).

# Windows production Runner service

`@tasktwin/runner-service-runtime` defines platform-independent modes,
autonomy, lifecycle, reconnect, drain and capability derivation. The Windows
adapter remains in `apps/local-runner`: local WinSW service management,
Runner-ID filesystem locking, DPAPI-NG master-key protection and fixed native
process invocation never enter Control Plane packages.

The service is `boot_resilient` only after SCM state, native vault unlock,
vault integrity and inventory synchronization are verified. A native-unlock
failure yields partial operation for non-secret workflows and withholds secret
capabilities. Transient network failures reconnect with bounded backoff;
revocation stops polling. Graceful stop drains and cleans up, while crash/reboot
starts a fresh worker and never resumes an old WorkflowRun lease or browser.

The Control Plane stores strict safe runtime metadata and audits accepted mode
and protector transitions. Native blobs, local identities and paths never
cross that boundary. See [ADR-031](../adr/ADR-031-production-runner-service.md)
and [ADR-032](../adr/ADR-032-os-native-secret-protection.md).
