# Session 04: Authentication and workspace foundation

## Goal

Add the smallest production-oriented identity and organization boundary needed
for later control-plane workflow features, while keeping browser execution
local and keeping persistence independent from NestJS.

## Included

- New User, Organization, OrganizationMember, Workspace, and OrganizationRole
  Prisma concepts
- Required Workspace relation on Workflow
- A new migration with an explicit safety stop for existing unassigned
  workflows
- Shared, tested email normalization
- Argon2id password hashing
- Atomic registration provisioning a user, organization, OWNER membership, and
  Default Workspace
- `POST /auth/register` and `POST /auth/login`
- Short-lived Bearer access tokens with only `sub` in the application payload
- Protected `GET /auth/me`
- Protected, membership-scoped `GET /workspaces`
- Reusable and independently tested organization-role authorization primitives
- Database-independent unit tests and opt-in database/API integration tests

## API behavior

Registration accepts email, password, display name, and organization name.
Input objects reject unexpected properties. Emails are trimmed and lowercased
at the shared persistence boundary. Passwords must contain 12 through 128
characters. A successful response contains safe user, organization, workspace,
and access-token data only.

Login uses the same normalized email boundary and returns a generic
`Invalid email or password` response for unknown accounts and bad passwords.
The current-user and workspace endpoints require an exact Bearer token.

Access tokens use HS256, contain only the user ID in `sub` plus standard JWT
time claims, and expire after a configured 60 through 3600 seconds. The
recommended local default is 900 seconds.

## Persistence and tenant boundary

User email and organization slug are globally unique. Membership uses the
composite primary key `(userId, organizationId)`. Workspace slug is unique
inside an organization. Workspace reads join through organization membership,
so a caller cannot select another tenant merely by supplying an identifier.

Authentication establishes who the current user is; authorization decides
which organization resources that identity can reach. The initial role
meanings are:

- `OWNER`: owns the organization and is the initial registration role.
- `ADMIN`: reserved for future organization administration.
- `MEMBER`: reserved for normal future organization participation.
- `VIEWER`: reserved for future read-only participation.

Session 04 persists and evaluates exact roles in reusable infrastructure but
does not expose role-management or organization mutation endpoints.

Workflow now has a required workspace foreign key. Because Session 03 had no
tenant ownership information, the new migration deliberately fails if existing
workflows are present. A developer must make an explicit ownership decision
before applying it; the migration never invents a tenant.

## Configuration and verification

The ignored root `.env` must contain:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET` with at least 32 characters
- optional `JWT_ACCESS_EXPIRES_IN` from 60 through 3600 seconds
- optional `API_PORT`

Normal `pnpm test` uses mocks and does not require PostgreSQL. After starting
PostgreSQL and applying migrations, `pnpm auth:check` runs the opt-in API and
database integration suite. It registers isolated temporary users, verifies
hash persistence and response safety, exercises protected endpoints and tenant
isolation, then deletes only its own test records.

`pnpm db:reset` is destructive and erases the configured local development
database before reapplying migrations. It must be used only with a disposable
loopback database and the explicit confirmation documented in the README.

## Excluded and limitations

- Refresh tokens, revocation, logout, password reset, and email verification
- Invitations, organization CRUD, workspace CRUD, and role-management APIs;
  refresh-token and invitation designs remain future work
- Frontend authentication and browser-extension authentication
- Workflow CRUD or authorization endpoints
- Multi-factor authentication, rate limiting, audit logging, and secret storage
- Browser recording, Playwright execution, policy execution, AI, and deployment

The role guard is intentionally not attached to an endpoint in this session:
there is no approved organization-targeted mutation that needs it. It only
accepts verified internal organization context, ready for a future authorized
endpoint to populate through a membership resolver.
