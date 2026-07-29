# Session 11: authenticated draft workflow editor

## Goal

Provide TaskTwin's first authenticated review and editing surface for an
existing `DRAFT` WorkflowVersion.

## Included

- Pure immutable `@tasktwin/workflow-editor-core` operations
- Deterministic linear graph projection
- Next.js login through the existing NestJS API
- HTTP-only short-lived access-token cookie
- Membership-scoped workflow list and detail APIs
- Safe property inspector with read-only locator summaries
- Wait and Approval insertion, deletion confirmation, and step reordering
- Field and complete-definition validation
- Explicit save, dirty, error, read-only, and conflict states
- Prisma draft revision migration and atomic optimistic concurrency
- OWNER/ADMIN/MEMBER writes and VIEWER reads

## Execution order and visualization

The workflow definition's `steps` array is authoritative. Moving a step
changes that array through a pure operation. React Flow then renders a fixed
node for each element and one edge between consecutive elements. Canvas
coordinates never affect behavior; connection creation and branching are
disabled.

## Editing boundaries

Common names and approved type-specific fields are editable. Literal
fill/select values can be changed, but variable and secret references are not
resolved. Secret values are never requested or displayed. Locator data is
read-only and the UI displays only kind, safe semantic context, and available
confidence/provenance. Navigate URLs reject unsupported protocols,
credentials, and sensitive query names.

The client validates fields and the complete `WorkflowDefinition` before
Save. The API repeats runtime validation and the database boundary validates
again.

## Draft concurrency

Workflow version number remains 1 for this session. Draft revision starts at 1
and increments after each successful save. The PATCH request includes the
expected revision. A stale revision receives HTTP 409; persisted content is not
overwritten and the browser keeps its local unsaved draft.

## Authentication and authorization

Login runs at a Next.js server boundary. The API bearer token is stored only in
an HTTP-only, SameSite cookie and is forwarded only to explicitly implemented
control-plane routes. Logout clears the cookie locally. An expired or rejected
token is cleared and redirects to login.

All workflow reads are resolved through current organization membership.
OWNER, ADMIN, MEMBER, and VIEWER can read. VIEWER cannot write.

## Excluded

Publishing, new workflow-version creation, lifecycle transitions, advanced
variable management, secret storage, locator editing or repair, branching,
loops, arbitrary connections, collaboration, auto-save, full undo/redo,
workflow execution, Playwright, AI, and refresh tokens remain out of scope.
