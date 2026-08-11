# Session 35 — Production Deployment Architecture

Session 35 adds a portable production deployment baseline for the TaskTwin
Control Plane. Separate Docker images and containers run Web, API, Scheduler
and Notification Worker. PostgreSQL uses persistent storage and an explicit
one-shot Prisma migration job gates application startup.

Production configuration fails closed, supports bounded file-mounted secrets
and preserves safe health/readiness responses. Containers run without root,
use controlled build inputs, bounded logs/restarts and graceful shutdown. The
network layout is ready for an operator-managed HTTPS reverse proxy.

The Scheduler algorithm, notification delivery behavior, run leases and
database migration history are unchanged. The deployment contains no Local
Runner, Playwright runtime, remote shell, production signing secret or local
Runner state. Kubernetes, cloud infrastructure, database HA, autoscaling and
automatic database rollback remain out of scope.
