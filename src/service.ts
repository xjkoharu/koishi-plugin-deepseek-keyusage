import {
  aggregate,
  aggregateByKey,
  emptyStat,
  totalTokens,
  type AggregateOptions,
} from './aggregate'
import type { LoggerLike } from './store'
import { BindingStore } from './store'
import type {
  AccountOverview,
  AmountSeries,
  ApiKeyInfo,
  Binding,
  CostSeries,
  KeyOverview,
  Range,
  Report,
  Stat,
  UserSummary,
} from './types'
import { matchesMaskedKey, shortMask } from './utils/format'
import { DAY_SECONDS, localDayIndex, startOfLocalDay, tzOffsetSeconds } from './utils/time'

export interface UsageDataSource {
  getApiKeys(): Promise<ApiKeyInfo[]>
  getSummary(): Promise<UserSummary>
  getAmount(range: Range, trackingIds?: string[]): Promise<AmountSeries[]>
  getCost(range: Range, trackingIds?: string[]): Promise<CostSeries[]>
}

export interface KeyVerifier {
  getBalance(apiKey: string): Promise<unknown>
}

export interface ServiceConfig {
  currency: string
  timeZone: string
  cacheTtl: number
  maxKeys: number
  maxBindings: number
}

export interface UsageServiceOptions {
  client: UsageDataSource
  verifier: KeyVerifier
  store: BindingStore
  config: ServiceConfig
  logger?: LoggerLike
  now?: () => number
}

export class BindError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BindError'
  }
}

interface UsageBundle {
  amounts: AmountSeries[]
  costs: CostSeries[]
}

// 平台单次查询最多接受 31 天，超过会返回 INVALID_PARAM
const CHUNK_SECONDS = 31 * DAY_SECONDS

export class UsageService {
  private readonly client: UsageDataSource
  private readonly verifier: KeyVerifier
  private readonly store: BindingStore
  private readonly config: ServiceConfig
  private readonly logger?: LoggerLike
  private readonly now: () => number

  private readonly cache = new Map<string, { expires: number; value: unknown }>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(options: UsageServiceOptions) {
    this.client = options.client
    this.verifier = options.verifier
    this.store = options.store
    this.config = options.config
    this.logger = options.logger
    this.now = options.now ?? (() => Date.now())
  }

  private nowSeconds(): number {
    return Math.floor(this.now() / 1000)
  }

  private tzOffset(): number {
    return tzOffsetSeconds(new Date(this.now()), this.config.timeZone)
  }

  private ttlMs(): number {
    return Math.max(0, this.config.cacheTtl) * 1000
  }

  async keys(force = false): Promise<ApiKeyInfo[]> {
    return this.memo('keys', () => this.client.getApiKeys(), force)
  }

  async summary(force = false): Promise<UserSummary> {
    return this.memo('summary', () => this.client.getSummary(), force)
  }

  /** 用户提交完整 Key 或 Key 尾号完成绑定，只保存脱敏信息。 */
  async addBinding(rawKey: string, userId: string): Promise<{ binding: Binding; count: number }> {
    await this.store.ready()
    const current = this.store.get(userId)
    if (current.length >= this.config.maxBindings) {
      throw new BindError(`最多只能绑定 ${this.config.maxBindings} 个 Key，先用 dsu.remove 删掉一个。`)
    }

    const candidate = rawKey.trim()
    const suffixOnly = /^[A-Za-z0-9]{4,32}$/.test(candidate) && !candidate.startsWith('sk-')
    const matcher = (key: ApiKeyInfo) =>
      suffixOnly
        ? key.sensitiveId.toLowerCase().endsWith(candidate.toLowerCase())
        : matchesMaskedKey(candidate, key.sensitiveId)

    let matches = (await this.keys()).filter(matcher)
    if (matches.length === 0) {
      // 可能刚在平台上新建了 Key，缓存还没过期，强制刷新一次再试
      matches = (await this.keys(true)).filter(matcher)
    }
    if (matches.length === 0) {
      throw new BindError(
        suffixOnly
          ? `没有在这个账号里找到尾号「${candidate}」的 Key，确认一下尾号，或者这个 Key 是不是这个账号下的。`
          : '没有在平台账号里找到这个 Key，确认一下是不是复制完整了，或者它是不是这个账号下的 Key。',
      )
    }
    if (matches.length > 1) {
      const names = matches.map((key) => `${key.name || key.trackingId}（${shortMask(key.sensitiveId)}）`).join('、')
      throw new BindError(`「${candidate}」同时匹配到多个 Key：${names}，请多写几位尾号。`)
    }
    const key = matches[0]
    if (current.some((binding) => binding.trackingId === key.trackingId)) {
      throw new BindError('你已经绑定过这个 Key 了，直接发 dsu 就能查。')
    }
    const owner = this.store.findByTrackingId(key.trackingId)
    if (owner && owner.boundBy !== userId) {
      throw new BindError('这个 Key 已经被添加过了，不能重复绑定。')
    }
    // 尾号绑定不拿到完整 Key，无法调用官方接口校验；Key 列表本身来自平台账号
    if (!suffixOnly) {
      await this.verifier.getBalance(candidate)
    }
    const binding: Binding = {
      trackingId: key.trackingId,
      name: key.name,
      sensitiveId: key.sensitiveId,
      boundAt: this.now(),
      boundBy: userId,
    }
    const list = await this.store.add(userId, binding)
    this.logger?.info?.(`用户 ${userId} 绑定了 Key ${key.name}（${key.sensitiveId}）`)
    return { binding, count: list.length }
  }

  async removeBinding(userId: string, query: string): Promise<Binding> {
    const matches = await this.matchBindings(userId, query)
    if (matches.length === 0) throw new BindError(`没有找到「${query}」对应的 Key。`)
    if (matches.length > 1) {
      throw new BindError(`「${query}」匹配到多个 Key：${matches.map((item) => item.name).join('、')}，请写完整一点。`)
    }
    await this.store.remove(userId, matches[0].trackingId)
    return matches[0]
  }

  async clearBindings(userId: string): Promise<number> {
    return this.store.removeAll(userId)
  }

  async getBindings(userId: string): Promise<Binding[]> {
    await this.store.ready()
    return this.store.get(userId)
  }

  /** 按序号、名字、Key ID 前缀或脱敏后缀查找自己的 Key。 */
  async matchBindings(userId: string, query: string): Promise<Binding[]> {
    const bindings = await this.getBindings(userId)
    const q = query.trim()
    if (!q) return bindings
    if (/^\d+$/.test(q)) {
      const index = Number(q) - 1
      return bindings[index] ? [bindings[index]] : []
    }
    const lower = q.toLowerCase()
    const exact = bindings.filter((binding) => binding.name.toLowerCase() === lower)
    if (exact.length) return exact
    return bindings.filter(
      (binding) =>
        binding.name.toLowerCase().includes(lower) ||
        binding.trackingId.toLowerCase().startsWith(lower) ||
        binding.sensitiveId.toLowerCase().endsWith(lower),
    )
  }

  async report(binding: Binding, force = false): Promise<Report> {
    await this.store.ready()
    const now = this.nowSeconds()
    const tzOffset = this.tzOffset()
    const keys = await this.keys(force)
    const key = keys.find((item) => item.trackingId === binding.trackingId) ?? {
      trackingId: binding.trackingId,
      name: binding.name,
      sensitiveId: binding.sensitiveId,
      createdAt: null,
      lastUse: null,
    }
    const start = this.alignDay(key.createdAt ? Math.floor(key.createdAt / 1000) : now - 30 * DAY_SECONDS, tzOffset)
    const end = startOfLocalDay(now, tzOffset) + DAY_SECONDS
    const bundle = await this.fetchUsage({ start, end }, [binding.trackingId], force)
    // 平台即使忽略了筛选参数，也只统计绑定的这个 Key
    const amounts = bundle.amounts.filter((series) => series.apiKey.trackingId === binding.trackingId)
    const costs = bundle.costs.filter((series) => series.apiKey.trackingId === binding.trackingId)
    const base: AggregateOptions = { tzOffset, currency: this.config.currency }
    const total = aggregate(amounts, costs, base)
    const today = aggregate(amounts, costs, {
      ...base,
      dayIndex: localDayIndex(now, tzOffset),
    })
    const summary = await this.summary(force).catch((error) => {
      this.logger?.warn?.(`获取账户余额失败：${(error as Error).message}`)
      return null
    })
    return {
      key,
      total,
      today,
      balance: summary ? this.pickBalance(summary) : undefined,
      range: { start, end },
      updatedAt: this.now(),
    }
  }

  async reportForKey(key: ApiKeyInfo, force = false): Promise<Report> {
    return this.report(
      {
        trackingId: key.trackingId,
        name: key.name,
        sensitiveId: key.sensitiveId,
        boundAt: 0,
        boundBy: '',
      },
      force,
    )
  }

  /** 一次查询某个用户绑定的所有 Key，共用一次平台总览请求。 */
  async reportsForUser(userId: string, force = false): Promise<Report[]> {
    const bindings = await this.getBindings(userId)
    if (!bindings.length) return []
    const overview = await this.overview(force)
    const now = this.nowSeconds()
    const tzOffset = this.tzOffset()
    const end = startOfLocalDay(now, tzOffset) + DAY_SECONDS
    const byId = new Map(overview.keys.map((item) => [item.key.trackingId, item]))
    return bindings.map((binding) => {
      const item = byId.get(binding.trackingId)
      const key: ApiKeyInfo = item?.key ?? {
        trackingId: binding.trackingId,
        name: binding.name,
        sensitiveId: binding.sensitiveId,
        createdAt: null,
        lastUse: null,
      }
      const start = this.alignDay(
        key.createdAt ? Math.floor(key.createdAt / 1000) : now - 30 * DAY_SECONDS,
        tzOffset,
      )
      return {
        key,
        total: item?.total ?? emptyStat(),
        today: item?.today ?? emptyStat(),
        balance: overview.balance,
        range: { start, end },
        updatedAt: overview.updatedAt,
      }
    })
  }

  async overview(force = false): Promise<AccountOverview> {
    await this.store.ready()
    const now = this.nowSeconds()
    const tzOffset = this.tzOffset()
    const keys = await this.keys(force)
    const earliest = keys.reduce<number | null>((min, key) => {
      if (!key.createdAt) return min
      return min === null ? key.createdAt : Math.min(min, key.createdAt)
    }, null)
    const start = this.alignDay(earliest ? Math.floor(earliest / 1000) : now - 30 * DAY_SECONDS, tzOffset)
    const end = startOfLocalDay(now, tzOffset) + DAY_SECONDS
    const bundle = await this.fetchUsage({ start, end }, undefined, force)
    const perKey = aggregateByKey(bundle.amounts, bundle.costs, {
      tzOffset,
      currency: this.config.currency,
      todayIndex: localDayIndex(now, tzOffset),
    })
    const list: KeyOverview[] = keys.map((key) => {
      const stat = perKey.get(key.trackingId)
      return {
        key,
        total: stat?.total ?? emptyStat(),
        today: stat?.today ?? emptyStat(),
        binding: this.store.findByTrackingId(key.trackingId),
      }
    })
    list.sort((a, b) => b.today.cost - a.today.cost || b.total.cost - a.total.cost)

    const total = emptyStat()
    for (const item of list) {
      total.cost += item.total.cost
      total.cacheHit += item.total.cacheHit
      total.cacheMiss += item.total.cacheMiss
      total.output += item.total.output
      total.requests += item.total.requests
    }

    const summary = await this.summary(force).catch((error) => {
      this.logger?.warn?.(`获取账户汇总失败：${(error as Error).message}`)
      return null
    })
    const accountCost =
      summary?.totalCosts.find((item) => item.currency === this.config.currency)?.amount ?? total.cost
    return {
      keys: list,
      total,
      accountCost,
      accountTokens: totalTokens(total),
      balance: summary ? this.pickBalance(summary) : undefined,
      updatedAt: this.now(),
    }
  }

  /** 管理员按名字 / Key ID / 脱敏后缀查找 Key。 */
  async findKeys(query: string): Promise<ApiKeyInfo[]> {
    const keys = await this.keys()
    const q = query.trim().toLowerCase()
    if (!q) return []
    const exact = keys.filter((key) => key.name.toLowerCase() === q)
    if (exact.length) return exact
    const partial = keys.filter(
      (key) =>
        key.name.toLowerCase().includes(q) ||
        key.trackingId.toLowerCase().startsWith(q) ||
        key.sensitiveId.toLowerCase().endsWith(q),
    )
    return partial
  }

  clearCache(): void {
    this.cache.clear()
  }

  /** 平台要求 start / end 对齐到本地零点，且 end 为开区间。 */
  private alignDay(timeSeconds: number, tzOffset: number): number {
    return Math.floor((timeSeconds + tzOffset) / DAY_SECONDS) * DAY_SECONDS - tzOffset
  }

  private pickBalance(summary: UserSummary) {
    const currency = this.config.currency
    const normal = summary.normalWallets
      .filter((wallet) => wallet.currency === currency)
      .reduce((sum, wallet) => sum + wallet.balance, 0)
    const bonus = summary.bonusWallets
      .filter((wallet) => wallet.currency === currency)
      .reduce((sum, wallet) => sum + wallet.balance, 0)
    return {
      currency,
      total: normal + bonus,
      granted: bonus,
      toppedUp: normal,
      available: normal + bonus > 0,
    }
  }

  private async fetchUsage(range: Range, trackingIds: string[] | undefined, force: boolean): Promise<UsageBundle> {
    const ids = trackingIds?.slice().sort()
    const cacheKey = `usage:${ids?.join(',') ?? '*'}:${range.start}:${range.end}`
    return this.memo(
      cacheKey,
      async () => {
        const amounts: AmountSeries[] = []
        const costs: CostSeries[] = []
        if (range.end <= range.start) return { amounts, costs }
        for (let start = range.start; start < range.end; start += CHUNK_SECONDS) {
          const end = Math.min(start + CHUNK_SECONDS, range.end)
          const [chunkAmounts, chunkCosts] = await Promise.all([
            this.client.getAmount({ start, end }, ids),
            this.client.getCost({ start, end }, ids),
          ])
          amounts.push(...chunkAmounts)
          costs.push(...chunkCosts)
        }
        return { amounts, costs }
      },
      force,
    )
  }

  private memo<T>(key: string, loader: () => Promise<T>, force: boolean): Promise<T> {
    if (!force) {
      const hit = this.cache.get(key)
      if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value as T)
      const running = this.inflight.get(key)
      if (running) return running as Promise<T>
    }
    const promise = loader()
      .then((value) => {
        this.cache.set(key, { expires: Date.now() + this.ttlMs(), value })
        return value
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }
}
