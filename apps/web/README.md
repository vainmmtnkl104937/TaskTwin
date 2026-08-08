# TaskTwin web

## Workflow outputs

Draft editors can add Extract steps, reuse an existing read-only locator, and
bind compatible later steps to ephemeral outputs. The Outputs panel shows only
declarations and usages. Run Detail displays metadata and never an output value
or preview.
The Next.js application provides the Session 11 login, workspace workflow list,
and draft editor.

Set `TASKTWIN_API_BASE_URL` to the trusted NestJS API origin. For local
development it defaults to `http://127.0.0.1:3001`.

```powershell
pnpm --filter @tasktwin/api dev
pnpm --filter @tasktwin/web dev
```

Open `http://localhost:3000/login`. Authentication is performed by a Server
Action and the short-lived API token is held in an HTTP-only cookie. It must
not be copied into localStorage, sessionStorage, client props, logs, or URLs.

React Flow renders the `steps` array as a fixed linear view. Reordering uses
explicit Move buttons and changes the array; canvas layout never changes
execution order.

The Variables panel manages Draft declarations and displays their step usages.
ValueSource selectors offer only compatible variables and ask for a secret
alias, never a secret value.

Run Inputs Preview is local UI validation only. Its values stay in component
memory, are cleared when the dialog closes, and are never put in localStorage,
sessionStorage, API requests, or logs. File content and filenames are not read
or uploaded.

Session 13 adds workflow version history, lifecycle badges, deterministic
publish-readiness issues, and role-aware lifecycle actions. Draft is the only
editable status. Testing, Published, and Archived are read-only; future edits
start by cloning a Published or Archived version into a new Draft. Publish and
Archive require explicit confirmation. These controls do not execute or deploy
the workflow.

Session 14 adds `/runner-pairing` and Workspace runner-device lists. Pairing
inspection and approval continue through the HTTP-only user-token server
boundary. The web application never receives a runner device code, runner
credential, or database digest. Only OWNER and ADMIN workspaces appear as
approval targets and revoke controls require confirmation.

Session 17 adds Published workflow run creation, required Local Runner
selection, Workspace run history, safe run/step detail, terminal-aware polling
and cooperative cancellation. Access tokens remain in the HTTP-only cookie and
runner credentials or lease tokens never reach browser code.

Session 18 adds a two-phase run form for workflows with runtime variables.
Preparation returns the selected Runner public key and safe manifest; the
browser validates variables and encrypts them with Web Crypto before the
commit Server Action. Plaintext values stay in component memory, are cleared
after success, and are never written to localStorage or sessionStorage.
Secret aliases are displayed only as local Runner requirements; Web never asks
for a secret value.

Session 22 adds a recovery-mode selector, safe per-step attempt history and a
Workspace Repair Center. Retry appears only for an eligible request and an
OWNER/ADMIN; MEMBER may Abort. The UI never renders runtime inputs, secrets,
outputs, raw errors, locators, full URLs or screenshots, and warns that manual
browser changes are not fully audited.

Session 25 adds an Audit Trail page (`/workspaces/:workspaceId/audit`),
typed detail and verification pages, a typed Evidence tab on the run
detail page, and an audit link in workspace navigation. All audit
components are rendered from typed zod-validated DTOs; no
`dangerouslySetInnerHTML` or JSON blob dumps are used. Forbidden payload
keys (secrets, tokens, URLs, screenshots, observed/expected values, …) are
rejected at the API boundary and re-validated on the web boundary before
rendering.

# Notification Inbox

The authenticated header contains a server-rendered notification bell with unread badge and five recent safe summaries. `/notifications` groups active action-required alerts, supports unread/severity filters, shows resolved state, and maps typed actions to Approval, Repair, Run, Schedule and Audit routes. It does not render HTML or raw template JSON.

# Workspace Operations Dashboard

`/workspaces/:workspaceId/operations` displays component freshness, Runner availability, recent run outcomes and rates, Approval/Repair backlog, Schedule state, Notification outbox/dead-letter state and the latest authoritative Audit integrity status. The selector supports only 1h, 24h, 7d and 30d windows. The run timeline is an accessible table and adds no chart dependency.

The page consumes a strict `@tasktwin/operational-telemetry` snapshot and never renders runtime values, secrets, outputs, locators, full URLs, browser errors, arbitrary JSON or HTML.
