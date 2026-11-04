<script setup lang="ts">
// Reads chain permission before offering removal. Signatures remain separate:
// granting access later can make an uncancelled listing usable again.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {isAddress, type Address} from 'viem'
import {publicClient} from '@zvm/web/evm'
import {endpoint} from '../core/endpoint'
import {wallet, wrongChain} from '../core/wallet'
import {useMarket} from '../core/market'
import {exchange} from '../core/orders'
import StepRail from './StepRail.vue'
import {collectionAbi, revokeCollectionCall} from '../core/nft'

const props = defineProps<{owner: string; collections: readonly {collection: string; collectionName?: string}[]}>()
const emit = defineEmits<{changed: []}>()
const market = useMarket()
type Row = {collection: Address; name: string; approved: boolean | null; loading: boolean; error: string}
const rows = ref<Row[]>([])
let generation = 0
let contextGeneration = 0
let disposed = false
let queued = false
let refreshing: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | undefined

const identity = computed(() => {
  const chainId = endpoint.chainId
  const operator = exchange()?.address
  const account = wallet.address
  if (endpoint.health !== 'ok' || wallet.chainId !== chainId || !chainId || !operator || !isAddress(operator) || !isAddress(props.owner) ||
    !account || account.toLowerCase() !== props.owner.toLowerCase() || wrongChain.value) return null
  return {chainId, operator: operator as Address, owner: props.owner as Address, endpoint: endpoint.rpc}
})
const collections = computed(() => {
  const unique = new Map<string, {collection: Address; name: string}>()
  for (const entry of props.collections) {
    if (!isAddress(entry.collection)) continue
    const key = entry.collection.toLowerCase()
    if (!unique.has(key)) unique.set(key, {collection: entry.collection as Address, name: entry.collectionName || entry.collection})
  }
  return [...unique.values()].sort((a, b) => a.collection.toLowerCase().localeCompare(b.collection.toLowerCase()))
})
const scope = computed(() => identity.value ? JSON.stringify([identity.value, collections.value.map(r => [r.collection.toLowerCase(), r.name])]) : '')

// One owned read batch at a time. Keep only one pending request for the
// latest context; a skipped busy refresh must not wait for the next timer.
function canRefresh() {
  return !disposed && !!identity.value && !market.busy.value && !document.hidden
}

function refresh(): Promise<void> {
  if (disposed || !identity.value) return Promise.resolve()
  queued = true
  if (refreshing || !canRefresh()) return refreshing ?? Promise.resolve()
  // Register ownership before a client or reactive callback can run.
  const run = Promise.resolve().then(async () => {
    while (queued && canRefresh()) {
      queued = false
      await readPermissions()
    }
  })
  let owned: Promise<void>
  owned = run.finally(() => {
    if (refreshing !== owned) return
    refreshing = null
    // A request can arrive between the final loop check and this continuation.
    if (queued && canRefresh()) void refresh()
  })
  refreshing = owned
  return owned
}

async function readPermissions() {
  const selected = identity.value
  if (!selected || !canRefresh()) return
  const key = scope.value
  const epoch = ++generation
  const current = () => !disposed && epoch === generation && key === scope.value
  try {
    const client = publicClient(selected.chainId)
    // Four reads at a time; the shared client's normal HTTP batching still applies.
    for (let offset = 0; offset < rows.value.length; offset += 4) {
      if (!current() || !canRefresh()) return
      const batch = rows.value.slice(offset, offset + 4)
      await Promise.all(batch.map(async row => {
        row.loading = true
        try {
          const value = await client.readContract({address: row.collection, abi: collectionAbi,
            functionName: 'isApprovedForAll', args: [selected.owner, selected.operator]})
          if (!current()) return
          if (typeof value !== 'boolean') throw new Error('Permission response was not a boolean.')
          row.approved = value
          row.error = ''
        } catch {
          if (!current()) return
          row.approved = null
          row.error = 'Could not read permission. Refresh before trying again.'
        } finally {
          if (current()) row.loading = false
        }
      }))
    }
  } catch {
    if (!current()) return
    // Client construction can fail before any row's asynchronous read starts.
    for (const row of rows.value) {
      row.approved = null
      row.loading = false
      row.error = 'Could not read permission. Refresh before trying again.'
    }
  }
}

watch(scope, () => {
  contextGeneration++
  generation++
  queued = false
  rows.value = identity.value ? collections.value.map(row => ({...row, approved: null, loading: false, error: ''})) : []
  void refresh()
}, {immediate: true, flush: 'sync'})

watch(() => market.busy.value, busy => {
  if (busy) {
    generation++
    queued = !!identity.value
    for (const row of rows.value) {
      row.approved = null
      row.loading = false
      row.error = ''
    }
  } else if (queued) void refresh()
}, {flush: 'sync'})

async function revoke(row: Row) {
  const selected = identity.value
  const key = scope.value
  const epoch = contextGeneration
  if (disposed || !selected || !rows.value.includes(row) || row.approved !== true || row.loading || market.busy.value) return
  const build = () => {
    if (disposed || epoch !== contextGeneration || scope.value !== key || !rows.value.includes(row)) throw new Error('The account or network changed. Check the permission again.')
    return [{...revokeCollectionCall(row.collection, selected.operator, row.name), guard: () => {
      if (disposed || epoch !== contextGeneration || scope.value !== key || !rows.value.includes(row)) throw new Error('The account or network changed. Check the permission again.')
    }}]
  }
  const after = async () => {
    // A real receipt is required by run before this callback can execute.
    if (disposed || epoch !== contextGeneration || scope.value !== key || !rows.value.includes(row)) return
    emit('changed')
  }
  await market.run(build, {after, success: 'Exchange access removed.'})
  // The busy watcher drains the queued read after success or failure.
}

const resume = () => {if (!document.hidden) void refresh()}
onMounted(() => {
  timer = setInterval(() => {if (!document.hidden) void refresh()}, 5000)
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('focus', resume)
})
onUnmounted(() => {
  disposed = true
  queued = false
  generation++
  contextGeneration++
  clearInterval(timer)
  document.removeEventListener('visibilitychange', resume)
  window.removeEventListener('focus', resume)
})
</script>

<template>
  <section v-if="identity && rows.length" class="panel p-4 grid gap-3" data-testid="collection-permissions">
    <h2 class="font-medium">Collection permissions</h2>
    <p class="text-[13px] text-dim">
      Exchange access applies to every token you hold in a collection. Removing it stops trading through this exchange,
      but does not cancel signed orders. Allowing access again can make uncancelled listings usable again.
    </p>
    <div v-for="row in rows" :key="row.collection" class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] items-center"
      data-testid="collection-permission" :data-collection="row.collection"
      :data-approval="row.approved === null ? 'unknown' : row.approved ? 'granted' : 'removed'">
      <div class="min-w-0">
        <p class="text-[13px] truncate">{{ row.name }}</p>
        <p class="text-[12px] mono break-all text-dim">{{ row.collection }}</p>
        <p v-if="row.error" role="status" class="text-[12px] text-[var(--danger)]">{{ row.error }}</p>
        <p v-else class="text-[12px] text-dim">{{ row.loading ? 'Checking permission...' : row.approved === null ? 'Permission unknown' : row.approved ? 'Exchange access allowed' : 'Exchange access removed' }}</p>
      </div>
      <button class="btn px-3 py-2 text-[12.5px]" data-testid="revoke-exchange"
        :disabled="market.busy.value || row.loading || row.approved !== true" @click="revoke(row)">
        {{ market.busy.value ? 'Waiting for execution...' : 'Revoke exchange access' }}
      </button>
    </div>
    <button class="btn justify-self-start text-[12px]" :disabled="market.busy.value" @click="refresh">Refresh permissions</button>
    <p v-if="market.error.value" role="status" class="text-[13px] text-[var(--danger)]">{{ market.error.value }}</p>
    <StepRail :steps="market.steps.value" />
  </section>
</template>
