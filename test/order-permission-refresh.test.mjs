import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'

// Execute the actual component script. Vue scheduling, reads, time and market
// completion are explicit in-memory capabilities; no SDK or browser is started.
const component = readFileSync(new URL('../src/components/CollectionPermissions.vue', import.meta.url), 'utf8')
const karum = component.includes("from '@zvm/web/evm'")
const address = n => '0x' + n.toString(16).padStart(40, '0')
const owner = address(1), operator = address(2), collection = address(10)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {resolve = yes; reject = no})
  return {promise, resolve, reject}
}
async function settle() {for (let i = 0; i < 40; i++) await Promise.resolve()}
async function fixture(options = {}) {
  const watchers = [], mounted = [], unmounted = [], timers = [], emitted = [], requests = [], runs = [], revokeCalls = []
  const cache = new WeakMap(), proxies = new WeakSet()
  let checking = false, again = false, stopped = false, activeReads = 0, maximumReads = 0, factoryError = options.factoryError
  function changed() {
    if (stopped) return
    if (checking) {again = true; return}
    checking = true
    try {
      do {
        again = false
        for (const row of watchers) {
          const next = row.get()
          if (!Object.is(next, row.previous)) {
            const before = row.previous; row.previous = next
            row.callback(next, before)
          }
        }
      } while (again)
    } finally {checking = false}
  }
  function reactive(value) {
    if (!value || typeof value !== 'object' || proxies.has(value)) return value
    if (cache.has(value)) return cache.get(value)
    const proxy = new Proxy(value, {
      get: (target, key, receiver) => reactive(Reflect.get(target, key, receiver)),
      set(target, key, next, receiver) {
        const before = target[key], ok = Reflect.set(target, key, next, receiver)
        if (!Object.is(before, next)) changed()
        return ok
      },
    })
    cache.set(value, proxy); proxies.add(proxy); return proxy
  }
  const ref = value => reactive({value})
  const vue = {
    computed: get => ({get value() {return get()}}), ref,
    watch(source, callback, options = {}) {
      const get = typeof source === 'function' ? source : () => source.value
      const row = {get, callback, options, previous: get()}; watchers.push(row)
      if (options.immediate) callback(row.previous, undefined)
      return () => watchers.splice(watchers.indexOf(row), 1)
    },
    onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn),
  }
  const wallet = reactive({address: owner, chainId: 7, provider: {},
    evm: {address: owner, chainId: 7, provider: {}}, info: {l2: {chainId: 7}, apps: {exchange: operator}}})
  const endpoint = reactive({chainId: 7, health: 'ok', rpc: 'https://read.example.invalid/rpc', url: 'https://read.example.invalid'})
  const wrongChain = ref(false)
  const props = reactive({owner, collections: options.collections ?? [{collection, collectionName: 'Fixture collection'}]})
  const market = {busy: ref(!!options.busy), error: ref(''), steps: ref([]),
    run(build, opts) {
      market.busy.value = true
      const done = deferred()
      const after = typeof opts === 'function' ? opts : opts?.after
      const entry = {build, after, async finish(ok) {
        if (ok) await after?.()
        market.busy.value = false
        done.resolve(ok)
      }}
      runs.push(entry); return done.promise
    }}
  function publicClient(chainId) {
    assert.equal(chainId, endpoint.chainId)
    if (factoryError) throw factoryError
    return {readContract(args) {
      const result = deferred()
      activeReads++; maximumReads = Math.max(maximumReads, activeReads)
      requests.push({...result, args, chainId})
      return result.promise.finally(() => {activeReads--})
    }}
  }
  const docListeners = new Map(), winListeners = new Map()
  const listeners = map => ({
    addEventListener(name, fn) {assert.ok(!map.has(name)); map.set(name, fn)},
    removeEventListener(name, fn) {assert.strictEqual(map.get(name), fn); map.delete(name)},
  })
  const document = reactive({hidden: !!options.hidden, ...listeners(docListeners)})
  const window = listeners(winListeners)
  const context = createContext({console, document, window,
    setInterval(fn, ms) {const token = {fn, ms, cleared: false}; timers.push(token); return token},
    clearInterval(token) {token.cleared = true},
    defineProps: () => props, defineEmits: () => (...values) => emitted.push(values),
  })
  const modules = new Map([
    ['vue', vue], ['viem', {isAddress: value => /^0x[a-fA-F0-9]{40}$/.test(value ?? '')}],
    ['@zvm/web/evm', {publicClient}], ['../core/evm', {publicClient}],
    ['../core/endpoint', {endpoint}], ['../core/wallet', {wallet, wrongChain}],
    ['../core/market', {useMarket: () => market, exchangeAddress: () => wallet.info?.apps.exchange}],
    ['../core/orders', {exchange: () => ({address: operator})}],
    ['../core/nft', {collectionAbi: [], revokeCollectionCall: (...args) => {revokeCalls.push(args); return {to: args[0], data: '0x', value: 0n}}}],
    ['./StepRail.vue', {default: {}}], ['./StepList.vue', {default: {}}],
  ])
  const scripts = [...component.matchAll(/<script setup lang="ts">([\s\S]*?)<\/script>/g)]
  assert.equal(scripts.length, 1)
  const script = stripTypeScriptTypes(scripts[0][1], {mode: 'strip'}) + '\nexport {rows, refresh, revoke, identity, scope}\n'
  const program = new SourceTextModule(script, {context})
  await program.link(specifier => {
    assert.ok(modules.has(specifier), 'unexpected component import: ' + specifier)
    const values = modules.get(specifier)
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, {context})
  })
  await program.evaluate({timeout: 5000})
  mounted.forEach(fn => fn()); await settle()
  return {api: program.namespace, wallet, endpoint, wrongChain, props, market, watchers, timers, emitted, requests, runs, revokeCalls,
    get maximumReads() {return maximumReads}, get activeReads() {return activeReads},
    set factoryError(value) {factoryError = value}, document, docListeners, winListeners,
    visibility() {docListeners.get('visibilitychange')?.()}, focus() {winListeners.get('focus')?.()},
    tick() {for (const timer of timers) if (!timer.cleared) timer.fn()},
    unmount() {stopped = true; unmounted.forEach(fn => fn())},
    setAccount(value) {if (karum) wallet.address = value; else wallet.evm.address = value},
    setWalletChain(value) {if (karum) wallet.chainId = value; else wallet.evm.chainId = value},
    setEndpoint(value) {if (karum) endpoint.rpc = value; else endpoint.url = value},
  }
}
async function approved(f) {assert.equal(f.requests.length, 1); f.requests[0].resolve(true); await settle(); assert.equal(f.api.rows.value[0].approved, true)}

test('the actual component reads the original ABI method and exact owner/operator', async () => {
  const f = await fixture(); const r = f.requests[0]
  assert.equal(r.args.address, collection); assert.equal(r.args.functionName, 'isApprovedForAll')
  assert.deepEqual([...r.args.args], [owner, operator]); assert.equal(r.chainId, 7)
  r.resolve(true); await settle(); assert.equal(f.api.rows.value[0].approved, true)
  assert.equal(f.api.rows.value[0].loading, false); assert.equal(f.runs.length, 0); f.unmount()
})
test('requests during one read coalesce into one immediate follow-up without ticking time', async () => {
  const f = await fixture(); void f.api.refresh(); void f.api.refresh(); void f.api.refresh()
  assert.equal(f.requests.length, 1); f.requests[0].resolve(true); await settle()
  assert.equal(f.requests.length, 2); assert.equal(f.maximumReads, 1)
  f.requests[1].resolve(false); await settle(); assert.equal(f.requests.length, 2)
  assert.equal(f.api.rows.value[0].approved, false); f.unmount()
})
test('a changed owner queues the latest context until the old read joins', async () => {
  const f = await fixture(); f.setAccount(address(3)); f.props.owner = address(3)
  assert.equal(f.requests.length, 1); f.requests[0].resolve(true); await settle()
  assert.equal(f.requests.length, 2); assert.equal(f.api.rows.value[0].approved, null)
  assert.equal(f.requests[1].args.args[0], address(3)); f.requests[1].resolve(false); await settle()
  assert.equal(f.api.rows.value[0].approved, false); assert.equal(f.maximumReads, 1); f.unmount()
})
test('account A-to-B-to-A cannot restore an obsolete success', async () => {
  const f = await fixture(), old = f.api.rows.value[0]
  f.setAccount(address(3)); f.setAccount(owner); f.requests[0].resolve(true); await settle()
  assert.equal(f.requests.length, 2); assert.notStrictEqual(f.api.rows.value[0], old)
  assert.equal(f.api.rows.value[0].approved, null); f.requests[1].resolve(false); await settle()
  assert.equal(f.api.rows.value[0].approved, false); f.unmount()
})
test('endpoint A-to-B-to-A also discards obsolete failure and immediately retries current context', async () => {
  const f = await fixture(), before = karum ? f.endpoint.rpc : f.endpoint.url
  f.setEndpoint('https://other.example.invalid/rpc'); f.setEndpoint(before)
  f.requests[0].reject(new Error('old endpoint')); await settle()
  assert.equal(f.requests.length, 2); assert.equal(f.api.rows.value[0].error, '')
  f.requests[1].resolve(true); await settle(); assert.equal(f.api.rows.value[0].approved, true); f.unmount()
})
test('intermediate contexts are not read when a later context supersedes them', async () => {
  const f = await fixture()
  for (const n of [3, 4]) {f.setAccount(address(n)); f.props.owner = address(n)}
  f.requests[0].resolve(true); await settle(); assert.equal(f.requests.length, 2)
  assert.equal(f.requests[1].args.args[0], address(4)); f.requests[1].resolve(true); await settle(); f.unmount()
})
test('unhealthy endpoints clear the view and do not start another read', async () => {
  const f = await fixture(); f.endpoint.health = 'error'; f.requests[0].resolve(true); await settle()
  assert.equal(f.api.rows.value.length, 0); f.tick(); await settle(); assert.equal(f.requests.length, 1)
  f.endpoint.health = 'ok'; await settle(); assert.equal(f.requests.length, 2)
  f.requests[1].resolve(false); await settle(); f.unmount()
})
test('the actual wallet chain must match before permission reads resume', async () => {
  const f = await fixture(); f.setWalletChain(8); f.requests[0].resolve(true); await settle()
  assert.equal(f.api.identity.value, null); assert.equal(f.requests.length, 1)
  f.setWalletChain(7); await settle(); assert.equal(f.requests.length, 2)
  f.requests[1].resolve(true); await settle(); f.unmount()
})
test('a client-construction failure stays unknown and a later refresh can recover', async () => {
  const f = await fixture({factoryError: new Error('client unavailable')})
  assert.equal(f.requests.length, 0); assert.equal(f.api.rows.value[0].approved, null)
  assert.match(f.api.rows.value[0].error, /Could not read permission/)
  f.factoryError = null; void f.api.refresh(); await settle(); assert.equal(f.requests.length, 1)
  f.requests[0].resolve(true); await settle(); assert.equal(f.api.rows.value[0].approved, true); f.unmount()
})
for (const [name, value] of [['a non-boolean result', 1], ['a rejected RPC read', new Error('read unavailable')]]) {
  test(name + ' never grants permission', async () => {
    const f = await fixture(); value instanceof Error ? f.requests[0].reject(value) : f.requests[0].resolve(value)
    await settle(); assert.equal(f.api.rows.value[0].approved, null); assert.equal(f.api.rows.value[0].loading, false)
    assert.match(f.api.rows.value[0].error, /Could not read permission/); f.unmount()
  })
}
test('ten collections never exceed four active read calls', async () => {
  const f = await fixture({collections: Array.from({length: 10}, (_, i) => ({collection: address(100 + i)}))})
  assert.equal(f.requests.length, 4)
  f.requests.slice(0, 4).forEach(r => r.resolve(true)); await settle(); assert.equal(f.requests.length, 8)
  f.requests.slice(4, 8).forEach(r => r.resolve(false)); await settle(); assert.equal(f.requests.length, 10)
  f.requests.slice(8).forEach(r => r.resolve(true)); await settle()
  assert.equal(f.maximumReads, 4); assert.equal(f.activeReads, 0)
  assert.deepEqual(Array.from(f.api.rows.value, r => r.approved), [true, true, true, true, false, false, false, false, true, true]); f.unmount()
})
test('one row failure does not prevent the next bounded batch', async () => {
  const f = await fixture({collections: Array.from({length: 5}, (_, i) => ({collection: address(100 + i)}))})
  f.requests[0].reject(new Error('one row')); f.requests.slice(1, 4).forEach(r => r.resolve(true)); await settle()
  assert.equal(f.requests.length, 5); f.requests[4].resolve(true); await settle()
  assert.equal(f.api.rows.value[0].approved, null); assert.equal(f.api.rows.value[4].approved, true); f.unmount()
})
test('a market action invalidates pending reads and drains a fresh read as soon as busy clears', async () => {
  const f = await fixture(); f.market.busy.value = true; f.requests[0].resolve(true); await settle()
  assert.equal(f.requests.length, 1); assert.equal(f.api.rows.value[0].approved, null)
  f.market.busy.value = false; await settle(); assert.equal(f.requests.length, 2)
  f.requests[1].resolve(false); await settle(); assert.equal(f.api.rows.value[0].approved, false); f.unmount()
})
test('a refresh requested while busy is retained until the action joins', async () => {
  const f = await fixture({busy: true}); assert.equal(f.requests.length, 0)
  await f.api.refresh(); await f.api.refresh(); assert.equal(f.requests.length, 0)
  f.market.busy.value = false; await settle(); assert.equal(f.requests.length, 1)
  f.requests[0].resolve(false); await settle(); assert.equal(f.requests.length, 1); f.unmount()
})
test('hidden pages defer reads until visibility restoration without a timer tick', async () => {
  const f = await fixture({hidden: true}); assert.equal(f.requests.length, 0)
  f.tick(); await settle(); assert.equal(f.requests.length, 0)
  f.document.hidden = false; f.visibility(); await settle(); assert.equal(f.requests.length, 1)
  f.requests[0].resolve(true); await settle(); f.unmount()
})
test('focus requests current permission immediately', async () => {
  const f = await fixture(); await approved(f); f.focus(); await settle(); assert.equal(f.requests.length, 2)
  f.requests[1].resolve(false); await settle(); assert.equal(f.api.rows.value[0].approved, false); f.unmount()
})
test('the unchanged five-second fallback still observes external permission reversal', async () => {
  const f = await fixture(); await approved(f)
  assert.equal(f.timers.length, 1); assert.equal(f.timers[0].ms, 5000)
  f.tick(); await settle(); assert.equal(f.requests.length, 2)
  f.requests[1].resolve(false); await settle(); assert.equal(f.api.rows.value[0].approved, false)
  f.tick(); await settle(); f.requests[2].resolve(true); await settle(); assert.equal(f.api.rows.value[0].approved, true); f.unmount()
})
test('unmount joins no new work and ignores late success', async () => {
  const f = await fixture(), row = f.api.rows.value[0]
  void f.api.refresh(); f.unmount(); f.requests[0].resolve(true); await settle(); await f.api.refresh()
  assert.equal(f.requests.length, 1); assert.equal(row.approved, null); assert.equal(f.emitted.length, 0)
  assert.equal(f.timers[0].cleared, true); assert.equal(f.docListeners.size, 0); assert.equal(f.winListeners.size, 0)
})
test('a detached permission row cannot start a revoke action', async () => {
  const f = await fixture(); await approved(f); const row = f.api.rows.value[0]
  f.props.collections = [{collection: address(11)}]; await f.api.revoke(row)
  assert.equal(f.runs.length, 0); assert.equal(f.revokeCalls.length, 0); f.unmount()
})
test('account A-to-B-to-A refuses both delayed revoke preparation and its submitted-call guard', async () => {
  const f = await fixture(); await approved(f)
  const revoke = f.api.revoke(f.api.rows.value[0]); assert.equal(f.runs.length, 1)
  const calls = f.runs[0].build(); assert.equal(calls.length, 1); calls[0].guard()
  f.setAccount(address(3)); f.setAccount(owner)
  assert.throws(f.runs[0].build, /account or network changed/); assert.throws(calls[0].guard, /account or network changed/)
  await f.runs[0].finish(true); await revoke; await settle(); assert.equal(f.emitted.length, 0); f.unmount()
})
test('same-context permission polling does not invalidate a legitimate revoke guard', async () => {
  const f = await fixture(); await approved(f)
  const revoke = f.api.revoke(f.api.rows.value[0]); const calls = f.runs[0].build()
  f.tick(); await settle(); calls[0].guard(); assert.equal(f.revokeCalls.length, 1)
  await f.runs[0].finish(true); await revoke; await settle()
  assert.equal(f.emitted.length, 1); assert.equal(f.requests.length, 2)
  f.requests[1].resolve(false); await settle(); assert.equal(f.api.rows.value[0].approved, false); f.unmount()
})
test('a failed market action also refreshes current permission without emitting success', async () => {
  const f = await fixture(); await approved(f); const revoke = f.api.revoke(f.api.rows.value[0])
  await f.runs[0].finish(false); await revoke; await settle()
  assert.equal(f.emitted.length, 0); assert.equal(f.requests.length, 2)
  f.requests[1].resolve(true); await settle(); assert.equal(f.api.rows.value[0].approved, true); f.unmount()
})
test('unmount prevents a completed old action from emitting changed or reading again', async () => {
  const f = await fixture(); await approved(f); const revoke = f.api.revoke(f.api.rows.value[0])
  f.unmount(); await f.runs[0].finish(true); await revoke; await settle()
  assert.equal(f.emitted.length, 0); assert.equal(f.requests.length, 1)
})
test('permission context and busy invalidation use synchronous Vue watchers', async () => {
  const f = await fixture(); assert.equal(f.watchers.length, 2)
  for (const watcher of f.watchers) assert.equal(watcher.options.flush, 'sync')
  f.unmount()
})
