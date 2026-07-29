# TaskTwin Control Plane API

The NestJS API is TaskTwin's authenticated control plane. PostgreSQL access is
provided by the framework-independent `@tasktwin/database` package.

## Development

From the repository root:

```powershell
pnpm db:up
pnpm db:migrate
pnpm --filter @tasktwin/api dev
```

The root `.env` must provide the documented development `DATABASE_URL` and
`JWT_ACCESS_SECRET`. Never commit a real `.env` file.

## Recording sync

Session 09 exposes:

- `POST /workspaces/:workspaceId/recording-sessions`
- `POST /recording-sessions/:recordingSessionId/batches`
- `POST /recording-sessions/:recordingSessionId/complete`
- `GET /recording-sessions/:recordingSessionId`

Every endpoint requires `Authorization: Bearer <access-token>`. OWNER, ADMIN,
and MEMBER may create, upload, and complete. VIEWER may call only the metadata
endpoint. All resource lookup is scoped through the current user's
organization membership.

Bodies are strict versioned contracts from `@tasktwin/recording-schema`.
Unexpected properties, invalid event privacy payloads, mismatched client
sessions, invalid ranges, and oversized batches are rejected. The shared
boundary independently classifies persisted target metadata and scans allowed
payload strings for recognized sensitive literals; it does not trust a
client-declared general policy for a deterministically sensitive control.

Creation and exact batch retries are idempotent. A batch contains at most 100
ordered contiguous events. Different batches may arrive out of order, but
completion succeeds only when the complete stored sequence is contiguous.

The metadata endpoint intentionally does not return recording events. API logs
must not contain request bodies, event values, database URLs, access tokens, or
raw persistence errors.

## Recording conversion

Session 10 adds:

- `POST /recording-sessions/:recordingSessionId/workflow-drafts`

The endpoint accepts a strict request containing `clientConversionId`, a
bounded workflow name, and an optional bounded description. OWNER, ADMIN, and
MEMBER may convert a completed recording; VIEWER cannot. The source recording
is resolved through workspace organization membership and is never modified.

Conversion is deterministic and creates the Workflow, its version 1 DRAFT
definition, and an idempotency receipt in one database transaction. An exact
`clientConversionId` retry returns the existing draft. The response is a safe
summary containing IDs, counts, publishability, and issue codes. It does not
return the generated definition, raw recording events, locator metadata, or
captured values.

## Verification

Default tests do not require PostgreSQL:

```powershell
pnpm --filter @tasktwin/api test
```

Opt-in integration tests require the development database and applied
migrations:

```powershell
pnpm db:up
pnpm db:migrate
pnpm --filter @tasktwin/api test:integration
```
