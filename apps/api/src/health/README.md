# API health

`GET /health/live` is a minimal process liveness probe and never accesses PostgreSQL or configuration. `GET /health/ready` performs `SELECT 1` and validates existing required configuration parsers. It returns only stable pass/fail codes and HTTP 503 when a required check fails; raw database errors and environment values are never returned.

Legacy `/health` and `/health/database` endpoints remain for deployment compatibility. Liveness must not be changed to depend on readiness, audit verification or Workspace metric aggregation.
