# ADR-001: Use a pnpm and Turborepo monorepo

- Status: Accepted
- Date: 2026-07-28

## Context

TaskTwin has multiple deployable or distributable components: a web
application, control-plane API, Chrome extension, and local runner. These
components share contracts and engineering configuration, but must retain clear
ownership boundaries.

Managing them in separate repositories would make atomic contract changes,
consistent validation, and early-stage development more expensive.

## Decision

TaskTwin will use one monorepo with:

- pnpm workspaces for dependency installation and local package linking
- Turborepo for dependency-aware task orchestration
- Application workspaces under `apps/`
- Reusable packages under `packages/`
- One lockfile for reproducible dependency resolution

Each workspace remains independently identifiable through a unique package
name and exposes its own relevant build and validation scripts.

## Consequences

Shared types can change atomically with their consumers, and root commands can
lint, typecheck, test, and build the whole system consistently. Turborepo also
makes dependency ordering explicit.

The repository requires disciplined package boundaries. A monorepo must not
become permission to couple framework code or business logic across
applications, and future packages should be added only when their session
requires them.
