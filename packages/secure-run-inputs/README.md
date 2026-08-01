# TaskTwin secure run inputs

`@tasktwin/secure-run-inputs` defines strict, framework-independent contracts
for short-lived run preparations, Runner public keys, AES-256-GCM/RSA-OAEP-256
envelopes, deterministic Additional Authenticated Data, safe manifests and
local secret-provider leases.

The package performs no cryptography and imports no filesystem, browser DOM,
NestJS, Prisma, React or Playwright API. Web and Local Runner adapters use their
platform cryptographic APIs. Secret values have no Web or Control Plane
contract and a lease must be disposed after execution.
