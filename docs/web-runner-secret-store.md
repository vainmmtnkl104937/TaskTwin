# Web Runner and Schedule secret readiness

The Workspace Local Runners view shows only READY/LOCKED/UNAVAILABLE/CORRUPTED state, accepted vault revision, configured count, last sync, and alias/random-version metadata. It never receives or renders a secret value, value hash, ciphertext, nonce, passphrase, or local vault path.

Schedule creation displays the selected Runner's safe Local Secret Store readiness and instructs operators to configure missing aliases with the local `runner secrets set <alias>` command. There is no Web input, reveal, copy, edit, export, or arbitrary JSON rendering path for secrets. Normal Workspace authorization continues to apply.

Runner Detail also shows safe runtime mode, service state, autonomy, unlock
mode, scheduled availability and restart resilience. It never exposes the
Windows account, host, native protected blob, machine path or service instance,
and it deliberately provides no remote service-management controls.
