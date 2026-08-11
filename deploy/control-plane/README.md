# Production Control Plane deployment

This directory documents the portable Docker Compose baseline for the
TaskTwin Control Plane. It deploys Web, API, Scheduler, Notification Worker,
an explicit migration job and PostgreSQL as separate containers. It never
packages or starts the Local Runner.

## Required configuration

Copy `production.env.example` to a host-owned configuration file and replace
the public origin and secret-file paths. The configuration file contains no
secret values. Create each referenced secret as a regular file readable only
by the deployment operator and Docker daemon:

- PostgreSQL password;
- complete PostgreSQL `DATABASE_URL` using the Compose hostname `postgres`;
- JWT access secret of at least 32 characters;
- three distinct Runner pairing, credential and job-lease peppers of at least
  32 characters each.

Do not store these files in the repository or below the Docker build context.
Direct environment values remain supported for non-Compose installations,
but direct and `_FILE` variants are mutually exclusive.

## Build and validate

```sh
docker compose --env-file /secure/tasktwin/production.env \
  -f compose.production.yaml config --quiet
docker compose --env-file /secure/tasktwin/production.env \
  -f compose.production.yaml build
```

The root build context is constrained by `.dockerignore`. The Dockerfile has
separate `web`, `api`, `scheduler`, `notification-worker` and `migrate` final
targets. Production secret files are mounted only when containers start and
never enter an image layer.

## Start and migrate

```sh
docker compose --env-file /secure/tasktwin/production.env \
  -f compose.production.yaml up --detach --wait
```

PostgreSQL must become healthy before the one-shot `migrate` service runs
`prisma migrate deploy`. API, Scheduler and Notification Worker start only
after migration exits successfully; Web starts after API readiness succeeds.
A migration failure blocks startup. Back up the database before deployment;
the baseline never rewrites migration history or attempts automatic rollback.

## Edge and shutdown behavior

Web and API bind to loopback by default for a host-managed HTTPS reverse
proxy. Set `TASKTWIN_WEB_BASE_URL` to the public HTTPS Web origin. Web reaches
API over their private Compose network; the explicit internal-HTTP flag applies
only to this server-side hop. PostgreSQL has no published host port.

Long-running services use bounded restart/logging policies, read-only root
filesystems and graceful stop periods. API uses Nest shutdown hooks, Scheduler
waits for its current tick, and Notification Worker finishes its current
claimed batch. `docker compose down` retains the named PostgreSQL volume;
deleting that volume is a separate destructive operator action.
