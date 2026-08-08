# @tasktwin/runner-service-runtime

Framework-independent deterministic contracts for Local Runner process modes,
service lifecycle, autonomy, reconnect backoff, bounded drain decisions and
capability derivation. Platform service managers, native key protection,
filesystems, browser runtimes and Control Plane transports remain in the Local
Runner application.

It defines `interactive`, `unattended_process` and `service` modes;
`interactive`, `process_unattended` and `boot_resilient` autonomy; strict safe
runtime reports; lifecycle transitions; retry classification and capped
backoff; bounded drain decisions; and derivation of
`runner_service_v1`/`os_native_secret_unlock_v1` alongside existing scheduling
and local-secret capabilities. It depends only on Zod.
