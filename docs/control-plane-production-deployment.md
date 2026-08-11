# Control Plane production deployment

TaskTwin's portable production baseline is `compose.production.yaml` with the
multi-target `docker/control-plane.Dockerfile`. The deployment contains only
Control Plane services: Web, API, Scheduler, Notification Worker, migration
job and PostgreSQL. Local Runner, Playwright, browser profiles, local secret
stores and Runner update state stay outside these images.

## Service topology

- Web and API are separately replaceable HTTP containers on the edge network.
- API also joins the internal backend network for PostgreSQL.
- Scheduler and Notification Worker are independent non-HTTP containers on
  the backend network.
- PostgreSQL is backend-only and persists to a named volume.
- A one-shot migration container owns schema deployment before application
  processes start.

The baseline intentionally omits a reverse-proxy product. A host or external
proxy terminates HTTPS and forwards only Web/API traffic to their loopback
bindings. Operators must configure forwarded headers, request limits and
timeouts for their chosen proxy.

## Readiness and lifecycle

API preserves its process-only `/health/live` and database/configuration-aware
`/health/ready` semantics. Web exposes equivalent safe endpoints; Web readiness
uses a bounded API readiness request. Scheduler and Notification Worker expose
one-shot database/configuration probes for container health while existing
operational heartbeats detect stale processing.

Compose orders PostgreSQL health, migration completion and service startup.
It does not make readiness an authorization decision. Signals stop new
Scheduler/Worker cycles, wait for current bounded work and disconnect cleanly.

## Configuration and secrets

Production configuration is validated before each process starts. Secret
values can be supplied through bounded regular files using `_FILE` variables.
Symlinks, oversized files, unreadable files and simultaneous direct/file
configuration fail closed with safe error codes. Neither health responses nor
startup logs echo values or secret paths.

See `deploy/control-plane/README.md` for the operator procedure. Database HA,
automatic backups, registry publishing, image signing, autoscaling and
cloud-specific infrastructure are outside this baseline.
