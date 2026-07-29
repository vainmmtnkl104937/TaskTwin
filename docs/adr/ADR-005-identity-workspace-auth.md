# ADR-005: Use short-lived JWT access tokens and organization memberships

- Status: Accepted
- Date: 2026-07-29

## Context

TaskTwin's control plane needs a minimal identity and tenant foundation before
workflow APIs can be authorized. The first boundary must support registration,
login, identifying the current user, and listing only workspaces reachable
through that user's organization membership.

Passwords and tenant permissions are sensitive and mutable. They must not be
encoded wholesale into a bearer token, exposed by response serialization, or
spread across framework-specific persistence code.

## Decision

The database package owns framework-independent repositories for User,
Organization, OrganizationMember, and Workspace. Email is normalized by one
exported boundary before storage or lookup. A unique normalized email prevents
duplicate identities.

Registration hashes the password with Argon2id, then creates the user,
organization, OWNER membership, and Default Workspace in one database
transaction. Failure of any write rolls back the complete registration.

NestJS owns HTTP DTO validation, dependency injection, authentication services,
and guards. Login issues a short-lived HS256 JWT whose application payload
contains only `sub`, the user ID. The signing secret and bounded expiration are
read from validated environment configuration. Protected requests reload the
active user rather than trusting mutable user or tenant state from the token.

Workspace access is derived by joining from the current user through
OrganizationMember to Organization and Workspace. A reusable role decorator
and guard consume only verified organization context attached internally; raw
organization identifiers from request input are not sufficient authorization.

Explicit response mappers allow-list safe fields. `passwordHash` is selected
only for credential verification and never returned from an API endpoint.

## Consequences

Tokens remain small and role changes can take effect without waiting for a
role-bearing token to expire. Database reads are required for protected
requests, which favors correct current authorization over statelessness.

The first registered user owns a newly created organization and workspace.
Cross-organization workspace reads are prevented at the query boundary.

This decision does not provide refresh tokens, revocation lists, logout,
password recovery, email verification, invitations, multi-factor
authentication, organization management, workspace management, or frontend
session storage. Those require separate requirements and threat analysis.
