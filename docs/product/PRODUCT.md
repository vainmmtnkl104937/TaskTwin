# TaskTwin Product

## Product goal

TaskTwin helps a person turn a demonstrated browser task into a reviewable,
repeatable workflow. The target experience is:

1. Show TaskTwin how a browser task is performed.
2. Review the structured plan before it can run.
3. Run an approved plan locally with visible safety controls.

The product should make automation understandable and deliberate. Generated
suggestions are not authority to act, and later execution must remain
deterministic and subject to policy and human approval.

## Browser-first MVP boundary

The MVP focuses on browser workflows initiated through a Chrome extension.
TaskTwin may eventually help record browser interactions, turn them into a
workflow proposal, present that proposal for review, and ask a local runner to
execute an approved version.

The MVP boundary does not include desktop automation, arbitrary shell control,
mobile applications, or unattended cloud browsers. Session 01 is narrower
still: it establishes application boundaries and health/status behavior only.
It does not record, propose, approve, or execute a workflow.

## Product principles

- **Review before execution:** a user must be able to understand a plan before
  it runs.
- **Local browser control:** browser interaction stays on the user's machine.
- **Least privilege:** extension and service access should be requested only
  when a current feature requires it.
- **Safe failure:** the system should report its state clearly and avoid
  silently changing an approved workflow.
- **No secret capture:** credentials, cookies, access tokens, and one-time
  passwords must not become workflow data, logs, screenshots, or source code.

## Session 01 outcome

Session 01 provides identifiable, independently buildable shells for the web
application, API, Chrome extension, and local runner. It also establishes
shared configuration and a service health contract. These are foundations, not
an implemented automation product.

## Runner release safety

Session 31 makes the production Local Runner a reviewable, versioned software
component. Operators receive an immutable Windows x64 archive together with a
strict signed manifest. They can verify its trusted signing key, canonical
manifest signature, exact size and SHA-256, then run compatibility preflight
before stopping the installed service.

The repository does not ship a production signing root. The first production
publication remains fail-closed until a reviewed production public key and its
matching protected CI credential are provisioned.

Product SemVer communicates release identity; execution safety additionally
depends on run protocol, Workflow definition, local-state and Local Secret Vault
compatibility. The dashboard explains when an update is recommended or blocks
new work. It cannot remotely download, install, execute or roll back Runner
software.
