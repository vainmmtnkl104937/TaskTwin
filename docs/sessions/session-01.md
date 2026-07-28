# Session 01: Monorepo foundation

## Goal

Create the initial TaskTwin monorepo foundation with independently buildable
application and package shells.

## Included

- pnpm workspaces and Turborepo orchestration
- Node.js 22-compatible configuration
- Strict shared TypeScript configuration
- Shared flat ESLint configuration and Prettier formatting
- Next.js landing page with product message and running status
- NestJS `GET /health` endpoint and health-service unit test
- Manifest V3 popup with idle state and disabled recorder controls
- Node.js local-runner status, safe startup message, and unit test
- Shared generic service health response type
- Product, roadmap, architecture, and decision documentation

## Excluded

- PostgreSQL, Prisma, and business database models
- Authentication
- Redis and BullMQ
- Playwright
- Browser recording or browser-event capture
- Workflow definition or execution
- AI integration
- Cloud deployment and CI/CD
- Docker
- React Flow

No placeholder dependencies for excluded capabilities are installed.

## Component behavior

- `apps/web` renders the TaskTwin name, “Show it once. Review the plan. Run it
  safely.”, and a visible web-running status.
- `apps/api` returns `{ "service": "tasktwin-api", "status": "healthy" }`
  from `GET /health`.
- `apps/extension` builds a loadable, permission-free Chrome extension popup.
- `apps/local-runner` reports a shared typed status and logs a safe startup
  message.

## Validation

The repository is accepted when dependency installation and these commands
succeed:

```shell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

The extension also requires manual loading in Chrome to verify popup rendering,
because Session 01 intentionally includes no browser automation test tooling.
