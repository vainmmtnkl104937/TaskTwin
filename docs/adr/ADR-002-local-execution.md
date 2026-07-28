# ADR-002: Run browser execution locally

- Status: Accepted
- Date: 2026-07-28

## Context

Browser workflows can encounter private pages, user sessions, and sensitive
input. Remote browser execution would expand the trust boundary, require
transfer of browser state, and create additional credential and privacy risks.

TaskTwin also needs to separate coordination from the authority to interact
with a user's browser.

## Decision

Browser automation will run in the local execution plane on the user's
machine. The Chrome extension will provide browser-facing interaction, and a
local runner will eventually perform approved, deterministic execution.

The web application and API form a control plane. They may coordinate workflow
metadata and review states in later sessions, but they will not directly
operate the browser.

## Consequences

Browser state can remain local, the extension can follow least-privilege access,
and execution can stay visible to the user. The design must eventually address
secure local communication, installation, version compatibility, and explicit
authorization.

Session 01 does not implement any of that communication or execution. The
extension requests no permissions, and the runner contains no browser
automation library.
