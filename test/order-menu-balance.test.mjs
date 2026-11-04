// Execute the shipped component's balance lifecycle with explicit memory-only
// Vue/client capabilities. No browser, SDK, endpoint or wallet is started.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'

const component = readFileSync(new URL('../src/components/ConnectButton.vue', import.meta.url), 'utf8')
const script = component.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
async function fixture() {
  const requests = [], watches = [], unmounts = []
  const wallet = {address: '0x' + '1'.repeat(40), chainId: 1, name: 'Fixture', provider: {}}
  const endpoint = {chainId: 1, rpc: 'http://fixture.invalid/rpc', health: 'ok'}
  const chain = {head: 1}
  const context = createContext({console})
  const exports = {
    vue: {computed: () => ({value: null}), ref: value => ({value}), onMounted() {},
      onUnmounted: callback => unmounts.push(callback), watch: (get, callback, options) => watches.push({get, callback, options})},
    'vue-router': {useRouter: () => ({push() {}})},
    '../core/wallet': {wallet, walletPicker: {open: false}, connectWallet() {}, disconnectWallet() {}, wrongChain: false, switchToChain() {}},
    '@zvm/web/evm': {knownWallets() {}, requestWallets() {}, onWallets() {}, publicClient: chainId => ({getBalance: params => {
      let resolve, reject
      const promise = new Promise((yes, no) => {resolve = yes; reject = no})
      requests.push({chainId, params, resolve, reject}); return promise
    }})},
    '../core/endpoint': {endpoint, explorerUrl() {}}, '../core/chains': {chainName() {}}, '../core/chain': {chain},
    '../core/tx': {activity: {items: []}, clearActivity() {}, STEP_WORD: {}},
    '../core/format': {ago() {}, short() {}, units() {}}, '@zvm/web/names': {cachedName() {}, nameOf() {}},
  }
  const program = new SourceTextModule(stripTypeScriptTypes(script, {mode: 'strip'}) + '\nexport {account, balance, readBalance};', {context})
  await program.link(name => {
    const values = exports[name] ?? (name.endsWith('.vue') ? {default: {}} : null)
    assert.ok(values, 'Only declared component dependencies may be linked: ' + name)
    return new SyntheticModule(Object.keys(values), function() {for (const [key, value] of Object.entries(values)) this.setExport(key, value)}, {context})
  })
  await program.evaluate({timeout: 5000})
  const api = program.namespace, watch = watches.find(row => row.callback === api.readBalance)
  assert.ok(watch); assert.equal(watch.options.flush, 'sync')
  assert.equal(watch.get().length, 7)
  return {wallet, endpoint, chain, requests, api, watches, unmounts, refresh: () => watch.callback(),
    async open(value = 100n) {api.account.value = true; const pending = watch.callback(); requests.at(-1).resolve(value); await pending}}
}

test('a closed account menu issues no balance request across account, endpoint and head changes', async () => {
  const f = await fixture()
  for (let i = 0; i < 100; i++) {f.chain.head++; f.wallet.address = '0x' + (i % 2 ? '1' : '2').repeat(40); await f.refresh()}
  f.endpoint.rpc = 'http://other.invalid/rpc'; await f.refresh()
  assert.equal(f.requests.length, 0); assert.equal(f.api.balance.value, null)
})
test('opening the menu reads the selected real client capability and preserves uint256 precision', async () => {
  const f = await fixture(), amount = (1n << 256n) - 1n; await f.open(amount)
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].chainId, 1)
  assert.deepEqual({...f.requests[0].params}, {address: f.wallet.address}); assert.equal(f.api.balance.value, amount)
})
test('late success for an old account cannot replace the new account amount', async () => {
  const f = await fixture(); f.api.account.value = true; const old = f.refresh()
  f.wallet.address = '0x' + '2'.repeat(40); const next = f.refresh(); f.requests[1].resolve(20n); await next
  f.requests[0].resolve(10n); await old; assert.equal(f.api.balance.value, 20n)
})
test('late failure for an old account cannot clear the new amount', async () => {
  const f = await fixture(); f.api.account.value = true; const old = f.refresh()
  f.wallet.address = '0x' + '2'.repeat(40); const next = f.refresh(); f.requests[1].resolve(20n); await next
  f.requests[0].reject(new Error('Old read failed')); await old; assert.equal(f.api.balance.value, 20n)
})
test('closing a menu clears its amount and refuses an in-flight completion', async () => {
  const f = await fixture(); await f.open(); const pending = f.refresh()
  f.api.account.value = false; await f.refresh(); assert.equal(f.api.balance.value, null)
  f.requests[1].resolve(200n); await pending; assert.equal(f.api.balance.value, null)
})
test('unmount invalidates in-flight work and prevents subsequent reads', async () => {
  const f = await fixture(); f.api.account.value = true; const pending = f.refresh()
  f.unmounts.forEach(callback => callback()); f.requests[0].resolve(200n); await pending; await f.refresh()
  assert.equal(f.requests.length, 1); assert.equal(f.api.balance.value, null)
})
for (const [name, change] of [
  ['chain', f => {f.endpoint.chainId = 2; f.wallet.chainId = 2}],
  ['same-chain endpoint', f => {f.endpoint.rpc = 'http://replacement.invalid/rpc'}],
  ['head', f => {f.chain.head = 2}],
]) test('a changed ' + name + ' cannot receive an older balance', async () => {
  const f = await fixture(); f.api.account.value = true; const old = f.refresh(); change(f)
  const next = f.refresh(); assert.equal(f.api.balance.value, null); f.requests[1].resolve(20n); await next
  f.requests[0].resolve(10n); await old; assert.equal(f.api.balance.value, 20n)
})
test('endpoint health loss clears the amount and invalidates a pending read', async () => {
  const f = await fixture(); await f.open(); const pending = f.refresh(); f.endpoint.health = 'checking'; await f.refresh()
  f.requests[1].resolve(200n); await pending; assert.equal(f.api.balance.value, null); assert.equal(f.requests.length, 2)
})
test('a wallet on another chain or a disconnected wallet cannot start a balance read', async () => {
  const f = await fixture(); f.api.account.value = true; f.wallet.chainId = 2; await f.refresh()
  f.wallet.chainId = 1; f.wallet.address = null; await f.refresh(); assert.equal(f.requests.length, 0)
})
test('a current failure remains unavailable instead of becoming zero', async () => {
  const f = await fixture(); f.api.account.value = true; const pending = f.refresh()
  f.requests[0].reject(new Error('Unavailable')); await pending; assert.equal(f.api.balance.value, null)
})
test('an A-to-B-to-A account transition still refuses the first A completion', async () => {
  const f = await fixture(); f.api.account.value = true; const first = f.refresh(); const a = f.wallet.address
  f.wallet.address = '0x' + '2'.repeat(40); const middle = f.refresh(); f.wallet.address = a; const last = f.refresh()
  f.requests[2].resolve(30n); await last; f.requests[1].resolve(20n); await middle; f.requests[0].resolve(10n); await first
  assert.equal(f.api.balance.value, 30n)
})
test('a reopened menu starts fresh and refuses a pre-close completion', async () => {
  const f = await fixture(); f.api.account.value = true; const old = f.refresh(); f.api.account.value = false; await f.refresh()
  await f.open(30n); f.requests[0].resolve(10n); await old; assert.equal(f.requests.length, 2); assert.equal(f.api.balance.value, 30n)
})
test('a result is refused after a context change even before the watch callback runs', async () => {
  const f = await fixture(); f.api.account.value = true; const pending = f.refresh(); f.endpoint.rpc = 'http://replacement.invalid/rpc'
  f.requests[0].resolve(100n); await pending; assert.equal(f.api.balance.value, null)
})
