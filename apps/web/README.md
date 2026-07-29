# TaskTwin web

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
