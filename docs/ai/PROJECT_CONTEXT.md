# TaskTwin Project Context

## Product

TaskTwin is a local-first browser workflow automation platform: a user records
a browser task, reviews the generated workflow, publishes an approved version
and runs it safely on a machine they control. The product is intentionally
browser-first and does not provide general desktop automation or remote shell
access.

## Architectural boundaries

The Control Plane consists of the Next.js web application, NestJS API,
notification worker and PostgreSQL/Prisma persistence. It owns identity,
tenancy, workflow metadata and lifecycle, coordination, policy, scheduling,
safe operational evidence, Runner registration and declarative fleet state. It
does not drive a browser or receive plaintext local secrets.

The execution plane consists of the Chrome extension and Local Runner. The
Manifest V3 extension records a bounded, privacy-filtered interaction stream.
The Local Runner authenticates as a device, claims approved work and executes
deterministic workflows locally through Playwright in isolated Chromium
contexts.

Framework-independent packages own contracts and deterministic decisions.
Application packages own HTTP, UI, Prisma, Chrome, Playwright, filesystem and
operating-system adapters.

## Product capabilities

- **Chrome Recorder:** records supported browser interactions, constructs
  semantic locators, applies local privacy rules and produces immutable,
  validated recording artifacts.
- **Workflow authoring:** deterministic recording conversion, a reviewable
  linear editor, typed variables and secret references, lifecycle controls and
  immutable Published versions.
- **Execution:** a deterministic Workflow Engine coordinates sequential local
  Playwright execution, persisted runs, leases, encrypted runtime inputs,
  verification and ephemeral outputs.
- **Safety and recovery:** Workspace policy is evaluated independently by the
  Control Plane and Runner. Approval gates, bounded read-only retry, attended
  repair and privacy-filtered locator proposals fail closed.
- **Operations:** the scheduler creates eligible unattended runs. Append-only
  tamper-evident Audit, in-app operational notifications and privacy-safe
  aggregate telemetry expose control-plane state without runtime values.
- **Local secrets:** the encrypted Local Secret Store resolves scheduled-run
  secrets only on the Runner; native Windows protection supports unattended
  service startup.
- **Runner lifecycle:** the Windows Runner Service supports bounded reconnect,
  graceful drain and non-resumable crash recovery. Signed Runner releases,
  explicit compatibility and secure local update/rollback use
  verify-before-mutate rules.
- **Fleet governance:** the trusted release catalog imports only signed
  manifests. Workspace rollouts use explicit ordered stages and declarative
  desired versions; authenticated heartbeat identity determines convergence.

## Main execution flow

```text
Chrome recording
  -> privacy and locator validation
  -> immutable recording artifact
  -> deterministic Draft conversion and review
  -> Testing and Published WorkflowVersion
  -> policy/readiness evaluation
  -> direct or scheduled WorkflowRun
  -> assigned Runner claim and renewable lease
  -> local input/secret resolution
  -> deterministic engine and isolated Playwright execution
  -> safe progress/completion metadata
  -> Audit, Alerts and aggregate operational views
```

Human approval may pause the immediate next step while the Runner retains its
lease and browser context. Conservative recovery may retry only explicitly
safe read-only failures or request attended action; it never silently changes
the Published workflow or resumes a crashed run.

Runner fleet rollout is a separate declarative flow. The Control Plane can set
a desired signed release, but download, installation, update and rollback are
explicit local operator actions handled by the secure Runner update controller.

## Context use

Use current code, schemas, migrations and tests as the implementation source of
truth. `CURRENT_STATE.md` records present capabilities, `MODULE_MAP.md` routes
code inspection, `INVARIANTS.md` records durable safety rules, and
`SESSION_INDEX.md` locates historical documentation only when needed.
