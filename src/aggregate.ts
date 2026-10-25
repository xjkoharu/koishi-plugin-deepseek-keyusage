import type { AmountSeries, CostSeries, Stat } from './types'
import { localDayIndex } from './utils/time'

export function emptyStat(): Stat {
  return { cost: 0, cacheHit: 0, cacheMiss: 0, output: 0, requests: 0 }
}

export function addStat(target: Stat, source: Stat): Stat {
  target.cost += source.cost
  target.cacheHit += source.cacheHit
  target.cacheMiss += source.cacheMiss
  target.output += source.output
  target.requests += source.requests
  return target
}

export function inputTokens(stat: Stat): number {
  return stat.cacheHit + stat.cacheMiss
}

export function totalTokens(stat: Stat): number {
  return stat.cacheHit + stat.cacheMiss + stat.output
}

export function hitRate(stat: Stat): number {
  const input = inputTokens(stat)
  return input > 0 ? stat.cacheHit / input : 0
}

export interface AggregateOptions {
  /** 时区偏移（秒） */
  tzOffset: number
  /** 只统计某个币种 */
  currency: string
  /** 只统计「本地日序号」等于该值的数据；不传表示全部 */
  dayIndex?: number
}

/** 把 amount / cost 序列聚合成一个 Stat。 */
export function aggregate(
  amounts: AmountSeries[],
  costs: CostSeries[],
  options: AggregateOptions,
): Stat {
  const stat = emptyStat()
  for (const series of amounts) {
    for (const bucket of series.buckets) {
      if (options.dayIndex !== undefined && localDayIndex(bucket.time, options.tzOffset) !== options.dayIndex) {
        continue
      }
      stat.cacheHit += bucket.usage.cacheHit
      stat.cacheMiss += bucket.usage.cacheMiss
      stat.output += bucket.usage.output
      stat.requests += bucket.usage.requests
    }
  }
  for (const series of costs) {
    if (series.currency !== options.currency) continue
    for (const bucket of series.buckets) {
      if (options.dayIndex !== undefined && localDayIndex(bucket.time, options.tzOffset) !== options.dayIndex) {
        continue
      }
      stat.cost += bucket.cost
    }
  }
  return stat
}

/** 按 Key 分别聚合「累计」和「今日」。 */
export function aggregateByKey(
  amounts: AmountSeries[],
  costs: CostSeries[],
  options: { tzOffset: number; currency: string; todayIndex: number },
): Map<string, { total: Stat; today: Stat }> {
  const result = new Map<string, { total: Stat; today: Stat }>()
  const ensure = (trackingId: string) => {
    let entry = result.get(trackingId)
    if (!entry) {
      entry = { total: emptyStat(), today: emptyStat() }
      result.set(trackingId, entry)
    }
    return entry
  }

  for (const series of amounts) {
    const entry = ensure(series.apiKey.trackingId)
    for (const bucket of series.buckets) {
      entry.total.cacheHit += bucket.usage.cacheHit
      entry.total.cacheMiss += bucket.usage.cacheMiss
      entry.total.output += bucket.usage.output
      entry.total.requests += bucket.usage.requests
      if (localDayIndex(bucket.time, options.tzOffset) === options.todayIndex) {
        entry.today.cacheHit += bucket.usage.cacheHit
        entry.today.cacheMiss += bucket.usage.cacheMiss
        entry.today.output += bucket.usage.output
        entry.today.requests += bucket.usage.requests
      }
    }
  }

  for (const series of costs) {
    if (series.currency !== options.currency) continue
    const entry = ensure(series.apiKey.trackingId)
    for (const bucket of series.buckets) {
      entry.total.cost += bucket.cost
      if (localDayIndex(bucket.time, options.tzOffset) === options.todayIndex) {
        entry.today.cost += bucket.cost
      }
    }
  }

  return result
}
