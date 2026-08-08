# Windows service wrapper

The Windows service integration uses WinSW 2.12.0, distributed under the MIT
license. The executable is not downloaded at service-install time. Maintainers
must run `pnpm --filter @tasktwin/local-runner service:prepare-windows`, which downloads the pinned upstream
artifact and verifies SHA-256
`b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f`.

Upstream: https://github.com/winsw/winsw/releases/tag/v2.12.0
