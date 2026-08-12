# Session 36: Control Plane security hardening

TaskTwin's production Control Plane HTTP boundary is hardened without changing
Auth/RBAC, Runner credentials, revocation or run-lease authorization.

## Current behavior

- Production Web and API responses use safe security headers; browser CORS is
  restricted to the configured Web origin.
- JSON bodies, URL/header sizes, server connection lifetimes and Web-to-API
  response reads are bounded.
- Login, registration, pairing and Runner endpoints use endpoint-appropriate
  process-local limits. Authenticated Runner limits use only identity attached
  by the existing credential guard.
- Request IDs are validated or generated, returned to clients and carried into
  bounded error responses.
- Unexpected production errors are generic and structured domain errors retain
  only allowlisted safe metadata. Production logs recursively redact sensitive
  keys and token-shaped text.
- Auth remains a short-lived secure HTTP-only cookie in production. The Web
  server enforces bounded Control Plane requests and does not enumerate raw
  API error bodies.
- Application containers run non-root with a read-only root, dropped
  capabilities, no-new-privileges, bounded process/file-descriptor resources
  and restricted temporary filesystems. Runtime images omit package managers.
- CI audits production dependencies and scans built images for fixed high or
  critical vulnerabilities using commit-pinned actions.

## Boundaries

Throttling is defense in depth and never substitutes for authentication,
revocation, RBAC or lease validation. The portable Compose baseline uses
process-local counters; deployments with multiple API replicas require a
trusted shared limiter. Reverse-proxy TLS, WAF, CAPTCHA, SSO, SIEM and broad
dependency upgrades remain outside this session.
