# Collection requests across navigation

Collection reads capture a validated route address and the current request
generation before awaiting HTTP or royalty metadata. After an await, only the
still-current route may publish results or launch dependent reads. Unmount
invalidates the generation and detaches the block listener. Item pagination,
side listings/offers, tab sales/activity and block refresh use the same fence.

This keeps late collection work from launching requests with the next page's
parameters or replacing its state. The real Chrome/Go HTTP regression checks
canonical collection-to-item navigation and requires no page HTTP failures.
Its prior run retained three 400 responses from collection side endpoints.
This change does not alter order inputs, signing, settlement or API schemas.

An invalid collection route clears prior collection/item/side data, completes
loading and shows an explicit address error without sending a malformed API
request. The browser history regression starts on a valid collection, changes
its address to an invalid value in the same application, checks that the old
item card is gone, and returns to the valid item. Late responses retain the
same generation fence.

The actual 25-check browser revision also exposed a late item-page sibling
request to `/api/nft/collections/undefined/items`. Item reads now capture both
collection and token ID with their generation. Sibling pagination and royalty
metadata stop after navigation or unmount; obsolete results are ignored.
The block listener is registered synchronously before awaited initialization,
so unmount can always detach it. Invalid item routes clear old data and settle
with an explicit error. Token IDs remain strings and valid-route signing and
settlement code is unchanged. This regression requires zero failed page HTTP
responses rather than accepting the passing main checks alone.


The header account menu now reads its native balance only while open, with a
connected account on the selected healthy chain. A close, account/chain/RPC/head
change or unmount invalidates the displayed amount and every older completion.
Generation and captured-context checks prevent both late success and late failure
from replacing the current menu, including an A-to-B-to-A transition. A reopened
menu starts a fresh read. Amounts remain bigint values from the production client;
requests are not fabricated, retried or substituted. In-flight HTTP cancellation
and the earlier browser navigation timeout cause are not established by this fix.
The complete original marketplace signature/receipt/balance predicates and all
52 production-browser profiles remain required in the Node integration lane.


## Collection permission refresh lifecycle

The permission component retains at most four concurrent read calls and one
pending refresh for the latest account, selected node and collection context.
Requests made while a read or market action is active are coalesced, then run
when that work settles. A completed action therefore does not depend on waiting
for the five-second fallback timer. Hidden tabs do not start new batches;
visibility restoration and focus request a current refresh.

Synchronous context invalidation rejects obsolete success and failure, including
account or endpoint A-to-B-to-A transitions. Revoke preparation and its later
transaction guard retain that context generation. Polling the same context does
not invalidate a valid transaction preparation. Detached rows and callbacks
after unmount cannot dispatch another action or replace the current view.

The original five-second polling interval remains for external changes and
same-height replacements. Permission reads still use the production public
client, original ABI and a strict boolean response. A request failure displays
unknown permission. A signature, wallet response or queue completion does not
establish an executed transaction. Real receipts remain the transaction runner's
responsibility.

The component controls execute the actual script with declared in-memory Vue,
read and market capabilities. They establish lifecycle behavior and the four-read
bound; they are not browser, SDK, settlement, public-chain or reorg execution.
The complete unchanged Node marketplace cohort remains a separate integration
gate when adopting this frontend revision.
