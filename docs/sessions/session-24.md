# Session 24: Deterministic Workspace Execution Policy

Session 24 adds immutable Workspace policy versions and deterministic workflow
decisions: `allow`, `require_approval`, or `deny`. Risk and decision precedence,
origin matching, immediate Approval binding, authoring checks, server-side run
pinning, queued-run staleness, and Runner re-evaluation are explicit contracts.

Every Workspace receives a fail-closed default policy. OWNER and ADMIN may
activate a complete replacement using optimistic revision control; earlier
versions remain archived. A run stores the selected policy version, digest and
safe evaluation. A policy change rejects a queued run, while a claimed run
remains pinned and must be stopped through cancellation or Runner revocation.

The Local Runner recomputes policy and workflow digests before Chromium launch,
then checks the destination and final origin around navigation and the current
origin before browser actions. Reports exclude values, secrets, outputs,
locators, complete URLs and page content.

This session excludes OPA/Rego, scripts, AI classification, automatic Approval
insertion, policy overrides, active-run policy mutation and an emergency kill
switch.
