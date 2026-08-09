# Web Runner runtime metadata

Runner Detail shows only safe operational state: Interactive, Unattended
Process or Service mode; service state; autonomy; manual/native/unavailable
unlock; scheduled availability; and reboot resilience.

Session 31 also shows the installed product version, canonical
platform/architecture, derived compatibility, run protocol, Workflow schema
and aggregate local-state schema. `update_required` and `unsupported` are clear
blocking states because the Runner cannot claim new work. Compatibility is
derived from current Control Plane policy, not persisted as release-catalog
state or inferred from newest SemVer alone.

The Web never receives service account names, hostnames, instance IDs, machine
paths, native protected-key blobs, master keys or secret values. It has no
Install, Stop, Restart, Uninstall, protector-migration, shell or vault-reset
controls. Runner revocation remains the only remote safety action.
