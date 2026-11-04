# Endpoint selection and late replies

An explicit endpoint selection starts its own check. Calls to `check()` share
work only while the same selection is pending. A response belongs to the
selection generation and URL that started it; selecting A, B, then A does not
make the first A request current again. An older request's cleanup cannot clear
the newer pending check.

Starting a check clears the previously established chain metadata. Invalid input
also invalidates pending work and clears that metadata. Success and failure are
published only for the current selection. Endpoint normalization, the eight-second
request limit, URL persistence and failure descriptions retain their existing
contracts. Karum also checks ownership before reading optional deployment info
and before trying a failed bare-host request's next candidate. An unavailable
optional API still leaves a reachable standalone RPC usable for reads.

`test/order-endpoint-race.test.mjs` executes the shipped TypeScript module with
explicit memory-only Vue, fetch, URL, clock and storage capabilities. It covers
out-of-order success and failure, invalid input, repeated and A-to-B-to-A
selections, pending-check sharing and cleanup, and the original current-response
paths. The preceding modules independently reproduced two races each: a new
selection reused the old request, and a late success reversed an invalid-input
error. These controls do not run a browser, SDK, real endpoint or wallet.

All existing tests, dependency pins, shared Core source, deployment workflows,
transaction behavior and financial oracles remain. Hosted typecheck/build and
complete Node consumer integration require fresh exact-source qualification;
older Node CI does not qualify these new frontend revisions. This change does
not establish real-wallet, cross-browser, independent NoM finality, release or
production acceptance. Karum's separate heartbeat reader still needs its own
late-response and concurrent-poll qualification.
