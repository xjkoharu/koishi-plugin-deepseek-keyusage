import { describe, expect, it } from 'vitest'
import { aggregate, aggregateByKey, hitRate, inputTokens, totalTokens } from '../src/aggregate'
import type { AmountSeries, ApiKeyInfo, CostSeries } from '../src/types'

const TZ = 8 * 3600
const key: ApiKeyInfo = {
  trackingId: 'tk_1',
  name: '示例A',
  sensitiveId: 'sk-abcde**1234',
  createdAt: null,
  lastUse: null,
}

const today = Math.floor(Date.UTC(2026, 9, 25, 2, 0, 0) / 1000) // 10:00 +08
const yesterday = today - 86400

const amounts: AmountSeries[] = [
  {
    apiKey: key,
    model: 'deepseek-flash',
    buckets: [
      { time: yesterday, usage: { cacheHit: 100, cacheMiss: 50, output: 20, requests: 2 } },
      { time: today, usage: { cacheHit: 10, cacheMiss: 5, output: 2, requests: 1 } },
    ],
  },
  {
    apiKey: key,
    model: 'deepseek-v4-pro',
    buckets: [{ time: today, usage: { cacheHit: 1, cacheMiss: 1, output: 1, requests: 1 } }],
  },
]

const costs: CostSeries[] = [
  {
    apiKey: key,
    model: 'deepseek-flash',
    currency: 'CNY',
    kind: 'model',
    buckets: [
      { time: yesterday, cost: 0.01 },
      { time: today, cost: 0.02 },
    ],
  },
  {
    apiKey: key,
    model: 'deepseek-flash',
    currency: 'USD',
    kind: 'model',
    buckets: [{ time: today, cost: 99 }],
  },
]

describe('aggregate', () => {
  it('sums everything for the whole range', () => {
    const stat = aggregate(amounts, costs, { tzOffset: TZ, currency: 'CNY' })
    expect(stat.cacheHit).toBe(111)
    expect(stat.cacheMiss).toBe(56)
    expect(stat.output).toBe(23)
    expect(stat.requests).toBe(4)
    expect(stat.cost).toBeCloseTo(0.03)
  })

  it('filters by local day', () => {
    const dayIndex = Math.floor((today + TZ) / 86400)
    const stat = aggregate(amounts, costs, { tzOffset: TZ, currency: 'CNY', dayIndex })
    expect(stat.cacheHit).toBe(11)
    expect(stat.cacheMiss).toBe(6)
    expect(stat.output).toBe(3)
    expect(stat.cost).toBeCloseTo(0.02)
  })

  it('ignores other currencies', () => {
    const stat = aggregate([], costs, { tzOffset: TZ, currency: 'USD' })
    expect(stat.cost).toBe(99)
  })

  it('computes token totals and hit rate', () => {
    const stat = aggregate(amounts, [], { tzOffset: TZ, currency: 'CNY' })
    expect(inputTokens(stat)).toBe(167)
    expect(totalTokens(stat)).toBe(190)
    expect(hitRate(stat)).toBeCloseTo(111 / 167)
    expect(hitRate({ cost: 0, cacheHit: 0, cacheMiss: 0, output: 0, requests: 0 })).toBe(0)
  })
})

describe('aggregateByKey', () => {
  it('groups total and today per key', () => {
    const todayIndex = Math.floor((today + TZ) / 86400)
    const map = aggregateByKey(amounts, costs, { tzOffset: TZ, currency: 'CNY', todayIndex })
    const entry = map.get('tk_1')!
    expect(entry.total.cost).toBeCloseTo(0.03)
    expect(entry.today.cost).toBeCloseTo(0.02)
    expect(entry.total.cacheHit).toBe(111)
    expect(entry.today.cacheHit).toBe(11)
  })
})
