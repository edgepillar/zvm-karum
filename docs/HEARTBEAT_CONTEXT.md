# Heartbeat request ownership

The heartbeat captures its RPC, chain ID and context generation before reading
the height. It rechecks that context after both the height and block replies,
and before showing a failure. A synchronous RPC, chain-ID or health change
clears the old chain identity, head, fee, timestamp, cadence and error. An
A-to-B-to-A change does not make the original A request current again.

One current-generation read owns the complete height/block pair. Timer and
visibility polls share that read instead of starting overlapping pairs. A new
context starts independently; an older request may still settle, and its result
and cleanup cannot replace or release the new context's read. Ownership is
registered before constructing a client, including synchronous callback entry.

The original three-second interval, hidden-tab behavior, uncached height query,
exact block-number argument, eight valid cadence gaps and block listeners remain.
An unchanged height still avoids a block-body read. Initial height zero is read
once rather than being mistaken for an already observed tip. A newly read lower
canonical height is accepted, so rollback observation is preserved; this is not
a monotonic-height filter or a chain-finality guarantee.

The new memory-only controls execute the shipped TypeScript module with explicit
Vue, client, clock, interval and visibility capabilities. The test view exposes
the existing private poll function; the published module's API is unchanged.
Five regressions were reproduced in the preceding source: late height, block and
failure publication from an old endpoint, overlapping reads regressing the shown
tip, and stale metadata after endpoint health loss. New controls also cover
same-chain RPC and chain-ID changes, A-to-B-to-A, old cleanup, client failures,
visibility, genesis zero, legitimate lower tips, cadence and listener detachment.
Two hundred repeated current-context poll calls share one height/block pair in
the controlled fixture. This is a bounded capability observation, not a timing,
SDK, browser, real endpoint or default-scale performance result.

All prior endpoint, component, permission, order and settlement tests retain their
bytes. Dependency pins, the shared Core source and workflows remain unchanged.
Fresh hosted typecheck/build and complete Node consumer qualification are required
for this revision. Previous Node execution remains bound to its original frontend
pins. Real-wallet, independent NoM canonicality/finality, supported-browser,
operator/owner/governance/release and production acceptance remain open.
