import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BindError, UsageService, type UsageDataSource } from '../src/service'
import { BindingStore } from '../src/store'
import type { AmountSeries, ApiKeyInfo, CostSeries, Range, UserSummary } from '../src/types'

const TZ = 8 * 3600
const NOW = Date.UTC(2026, 9, 25, 13, 30, 0) // 2026-10-25 21:30 +08
const TODAY = Math.floor(Date.UTC(2026, 9, 24, 16, 0, 0) / 1000)
const YESTERDAY = TODAY - 86400

const KEY: ApiKeyInfo = {
  trackingId: 'tk_1',
  name: '示例A',
  sensitiveId: 'sk-abcde**1234',
  createdAt: NOW - 10 * 86400 * 1000,
  lastUse: NOW - 1000,
}

const FULL_KEY = 'sk-abcde0123456789abcdef1234'

const KEY2: ApiKeyInfo = {
  trackingId: 'tk_2',
  name: '示例B',
  sensitiveId: 'sk-fghij**5678',
  createdAt: NOW - 5 * 86400 * 1000,
  lastUse: null,
}

const FULL_KEY2 = 'sk-fghij0123456789abcdef5678'

function createSource() {
  const calls = {
    keys: 0,
    summary: 0,
    amount: 0,
    cost: 0,
    amountRanges: [] as Range[],
    costRanges: [] as Range[],
  }
  const amounts: AmountSeries[] = [
    {
      apiKey: KEY,
      model: 'deepseek-flash',
      buckets: [
        { time: YESTERDAY, usage: { cacheHit: 100, cacheMiss: 50, output: 20, requests: 2 } },
        { time: TODAY, usage: { cacheHit: 10, cacheMiss: 5, output: 2, requests: 1 } },
      ],
    },
  ]
  const costs: CostSeries[] = [
    {
      apiKey: KEY,
      model: 'deepseek-flash',
      currency: 'CNY',
      kind: 'model',
      buckets: [
        { time: YESTERDAY, cost: 0.01 },
        { time: TODAY, cost: 0.02 },
      ],
    },
  ]
  const summary: UserSummary = {
    totalCosts: [{ currency: 'CNY', amount: 0.5 }],
    normalWallets: [{ currency: 'CNY', balance: 10 }],
    bonusWallets: [{ currency: 'CNY', balance: 2.5 }],
  }
  const source: UsageDataSource = {
    async getApiKeys() {
      calls.keys++
      return [KEY, KEY2]
    },
    async getSummary() {
      calls.summary++
      return summary
    },
    async getAmount(range: Range, ids?: string[]) {
      calls.amount++
      calls.amountRanges.push(range)
      if (ids && !ids.includes(KEY.trackingId)) return []
      return amounts
    },
    async getCost(range: Range, ids?: string[]) {
      calls.cost++
      calls.costRanges.push(range)
      if (ids && !ids.includes(KEY.trackingId)) return []
      return costs
    },
  }
  return { source, calls }
}

const verifier = {
  async getBalance() {
    return { isAvailable: true, balances: [] }
  },
}

describe('UsageService', () => {
  let dir: string
  let store: BindingStore
  let service: UsageService
  let calls: ReturnType<typeof createSource>['calls']

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsu-test-'))
    store = new BindingStore(join(dir, 'bindings.json'))
    const created = createSource()
    calls = created.calls
    service = new UsageService({
      client: created.source,
      verifier,
      store,
      config: { currency: 'CNY', timeZone: 'Asia/Shanghai', cacheTtl: 60, maxKeys: 30, maxBindings: 5 },
      now: () => NOW,
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('binds a matching key and keeps only masked data', async () => {
    const { binding, count } = await service.addBinding(FULL_KEY, 'qq:user-1')
    expect(count).toBe(1)
    expect(binding).toMatchObject({
      trackingId: 'tk_1',
      name: '示例A',
      sensitiveId: 'sk-abcde**1234',
      boundBy: 'qq:user-1',
    })
    const stored = await service.getBindings('qq:user-1')
    expect(stored).toHaveLength(1)
    expect(stored[0].trackingId).toBe('tk_1')
    expect(JSON.stringify(stored)).not.toContain(FULL_KEY)
  })

  it('binds by key suffix without asking for the full key', async () => {
    const { binding } = await service.addBinding('1234', 'qq:user-1')
    expect(binding).toMatchObject({
      trackingId: 'tk_1',
      sensitiveId: 'sk-abcde**1234',
    })
    expect(JSON.stringify(await service.getBindings('qq:user-1'))).not.toContain(FULL_KEY)
  })

  it('rejects a key that does not belong to the account', async () => {
    await expect(service.addBinding('sk-00000aaaaaaaaaaaaaaaaaa0000', 'qq:user-1')).rejects.toBeInstanceOf(BindError)
  })

  it('supports binding multiple keys for one user', async () => {
    const first = await service.addBinding(FULL_KEY, 'qq:user-1')
    const second = await service.addBinding(FULL_KEY2, 'qq:user-1')
    expect(first.count).toBe(1)
    expect(second.count).toBe(2)

    const bindings = await service.getBindings('qq:user-1')
    expect(bindings.map((binding) => binding.name)).toEqual(['示例A', '示例B'])

    await expect(service.addBinding(FULL_KEY2, 'qq:user-1')).rejects.toThrow('已经绑定过')
    await expect(service.addBinding(FULL_KEY, 'qq:user-2')).rejects.toThrow('已经被添加')

    const matches = await service.matchBindings('qq:user-1', '2')
    expect(matches[0]?.name).toBe('示例B')
    const byName = await service.matchBindings('qq:user-1', '例A')
    expect(byName[0]?.trackingId).toBe('tk_1')

    const removed = await service.removeBinding('qq:user-1', '示例B')
    expect(removed.trackingId).toBe('tk_2')
    expect(await service.getBindings('qq:user-1')).toHaveLength(1)
  })

  it('queries day-aligned, exclusive-end ranges', async () => {
    const { binding } = await service.addBinding(FULL_KEY, 'qq:user-1')
    await service.report(binding)
    const range = calls.amountRanges[0]
    expect((range.start + TZ) % 86400).toBe(0)
    expect((range.end + TZ) % 86400).toBe(0)
    expect(range.start).toBe(TODAY - 10 * 86400)
    expect(range.end).toBe(TODAY + 86400)
    expect(calls.costRanges[0]).toEqual(range)
  })

  it('builds a report with total and today stats', async () => {
    const { binding } = await service.addBinding(FULL_KEY, 'qq:user-1')
    const report = await service.report(binding)
    expect(report.total.cost).toBeCloseTo(0.03)
    expect(report.today.cost).toBeCloseTo(0.02)
    expect(report.total.cacheHit).toBe(110)
    expect(report.today.cacheHit).toBe(10)
    expect(report.balance).toEqual({
      currency: 'CNY',
      total: 12.5,
      granted: 2.5,
      toppedUp: 10,
      available: true,
    })
  })

  it('caches platform responses', async () => {
    const { binding } = await service.addBinding(FULL_KEY, 'qq:user-1')
    await service.report(binding)
    const before = { ...calls }
    await service.report(binding)
    expect(calls.amount).toBe(before.amount)
    expect(calls.cost).toBe(before.cost)
    expect(calls.summary).toBe(before.summary)
  })

  it('builds an account overview', async () => {
    await service.addBinding(FULL_KEY, 'qq:user-1')
    const overview = await service.overview()
    expect(overview.keys).toHaveLength(2)
    expect(overview.accountCost).toBeCloseTo(0.5)
    expect(overview.total.cost).toBeCloseTo(0.03)
    const keyOne = overview.keys.find((item) => item.key.trackingId === 'tk_1')!
    expect(keyOne.today.cost).toBeCloseTo(0.02)
    expect(keyOne.binding?.boundBy).toBe('qq:user-1')
    expect(overview.accountTokens).toBe(187)
  })

  it('finds keys by name, id and masked suffix', async () => {
    expect(await service.findKeys('示例A')).toHaveLength(1)
    expect(await service.findKeys('tk_')).toHaveLength(2)
    expect(await service.findKeys('1234')).toHaveLength(1)
    expect(await service.findKeys('不存在')).toHaveLength(0)
  })

  it('builds reports for all bound keys', async () => {
    await service.addBinding(FULL_KEY, 'qq:user-1')
    await service.addBinding(FULL_KEY2, 'qq:user-1')
    const reports = await service.reportsForUser('qq:user-1')
    expect(reports).toHaveLength(2)
    expect(reports[0].key.name).toBe('示例A')
    expect(reports[0].total.cost).toBeCloseTo(0.03)
    expect(reports[0].today.cost).toBeCloseTo(0.02)
    expect(reports[0].balance?.total).toBe(12.5)
    expect(reports[1].key.name).toBe('示例B')
    expect(reports[1].total.cost).toBe(0)
  })

  it('clears all bindings', async () => {
    await service.addBinding(FULL_KEY, 'qq:user-1')
    await service.addBinding(FULL_KEY2, 'qq:user-1')
    expect(await service.clearBindings('qq:user-1')).toBe(2)
    expect(await service.getBindings('qq:user-1')).toHaveLength(0)
    expect(await service.clearBindings('qq:user-1')).toBe(0)
  })
})
