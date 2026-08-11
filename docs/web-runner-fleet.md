# Runner Fleet and rollout UI

The Workspace Fleet page presents actual authenticated version, declarative
desired version, derived compliance, online/offline state, runtime state and
service state. These columns are intentionally separate so operators do not
confuse rollout intent with installed software or compatibility.

The rollout list and detail pages present the trusted target release, lifecycle,
ordered explicit stages, convergence counts and rolled-back assignments.
OWNER/ADMIN operators can activate, pause or cancel and can activate the next
eligible stage manually. MEMBER/VIEWER users can inspect the same Workspace data
without write controls.

There is no Update Now, Install, remote shell, PowerShell or remote rollback
control. Operators use the Session 32 local CLI on the Runner host.
