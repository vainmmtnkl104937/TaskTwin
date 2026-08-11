# Runner release governance

Release administrators import the complete Session 31 manifest plus detached
signature. The API does not accept an unsigned trusted-release record. Import
fails for an unknown key, invalid signature, malformed strict manifest,
incompatible metadata or a version whose canonical manifest digest differs
from the existing catalog entry.

`available` releases may be selected for a new rollout. `deprecated` releases
remain historical but cannot be new targets. `blocked` releases also cannot be
new targets; blocking an active target pauses its rollouts and requires review.
Status reasons use a bounded code set rather than executable scripts or free-form
policy.

The trusted registry contains public keys only. Production private signing keys
must remain in the Session 31 signing environment. Catalog audit metadata must
never contain artifact bytes, signatures, private keys or machine-local paths.
