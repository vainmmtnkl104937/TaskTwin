# Scheduler process lifecycle

The Scheduler runs inside the Control Plane API when `SCHEDULER_ENABLED=true`. It polls every 30 seconds and retains the existing PostgreSQL row-lock and idempotency guarantees for occurrence creation.

An enabled instance reports a `scheduler` heartbeat using a random boot UUID and database time. Shutdown clears the polling interval, refuses a new tick, waits for the current tick, records graceful stop when PostgreSQL is available and then allows application resource disposal. Heartbeat failures use only the safe `TELEMETRY_STORAGE_UNAVAILABLE` code and do not create audit events or alerts.
