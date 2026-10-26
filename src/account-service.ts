import { randomUUID } from 'node:crypto'
import type { Context } from 'koishi'
import { aggregate, aggregateByKey, emptyStat, totalTokens } from './aggregate'
import { PlatformClient } from './api/client'
import type { OfficialClient } from './api/official'
import { BindError } from './service'
import type { Config } from './config'
import type { LoggerLike } from './store'
import type {
  AccountOverview,
  AmountSeries,
  ApiKeyInfo,
  BalanceInfo,
  CostSeries,
  KeyOverview,
  Range,
  Report,
  Stat,
  UserSummary,
} from './types'
import { matchesMaskedKey, shortMask } from './utils/format'
import { DAY_SECONDS, localDayIndex, startOfLocalDay, tzOffsetSeconds } from './utils/time'

export const BINDING_TABLE = 'deepseek_keyusage_binding'
export const USER_TABLE = 'deepseek_keyusage_user'

const CHUNK_SECONDS = 31 * DAY_SECONDS

export interface StoredBinding {
  id: string
  userId: string
  token: string
  trackingId: string
  keyName: string
  sensitiveId: string
  boundAt: number
}

export interface StoredUser {
  userId: string
  token: string
  updatedAt: number
}

declare module 'koishi' {
  interface Tables {
    deepseek_keyusage_binding: StoredBinding
    deepseek_keyusage_user: StoredUser
  }
}

export interface UserReport {
  binding: StoredBinding
  report: Report
  label: string
}

export interface AllKeyEntry {
  label: string
  key: ApiKeyInfo
  total: Stat
  today: Stat
  binding?: StoredBinding
}

export interface AllPage {
  accounts: number
  keys: number
  balance: number
  totalCost: number
  tokens: number
  page: number
  pages: number
  pageSize: number
  entries: AllKeyEntry[]
  updatedAt: number
}

interface UsageBundle {
  amounts: AmountSeries[]
  costs: CostSeries[]
}

export interface AccountServiceOptions {
  ctx: Context
  config: Config
  verifier: OfficialClient
  fallbackToken: () => Promise<string | undefined>
  logger?: LoggerLike
  debug?: (message: string, detail?: unknown) => void
}

/**
 * 多账号模型：每条绑定直接保存 userToken + Key。
 * 同一个人可以绑定多个账号下的多个 Key，别人也可以用自己的方式绑同一个账号。
 */
export class AccountService {
  private readonly db: any
  private readonly clients = new Map<string, PlatformClient>()
  private readonly cache = new Map<string, { expires: number; value: Promise<any> }>()
  private readonly config: Config

  constructor(private readonly options: AccountServiceOptions) {
    this.db = (options.ctx as any).database
    this.config = options.config
  }

  private get logger() {
    return this.options.logger
  }

  private client(token: string): PlatformClient {
    let client = this.clients.get(token)
    if (!client) {
      client = new PlatformClient({
        baseUrl: this.config.apiBaseUrl,
        token,
        timeZone: this.config.timeZone,
        timeout: this.config.requestTimeout,
        debug: this.options.debug,
      })
      this.clients.set(token, client)
    }
    return client
  }

  private memo<T>(key: string, factory: () => Promise<T>, force = false): Promise<T> {
    const ttl = this.config.cacheTtl * 1000
    if (!force && ttl > 0) {
      const cached = this.cache.get(key)
      if (cached && cached.expires > Date.now()) return cached.value
    }
    const value = factory()
    if (ttl > 0) this.cache.set(key, { expires: Date.now() + ttl, value })
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key)
    })
    return value
  }

  async verifyToken(token: string): Promise<ApiKeyInfo[]> {
    const text = token.trim()
    if (!text) throw new BindError('Token 不能为空。')
    try {
      return await this.keys(text, true)
    } catch (error) {
      throw new BindError(`Token 无效或已过期：${(error as Error).message}`)
    }
  }

  async keys(token: string, force = false): Promise<ApiKeyInfo[]> {
    return this.memo(`keys:${token}`, () => this.client(token).getApiKeys(), force)
  }

  async summary(token: string, force = false): Promise<UserSummary> {
    return this.memo(`summary:${token}`, () => this.client(token).getSummary(), force)
  }

  /** 当前用户保存的默认 token；没有就回退到配置/环境变量里的全局 token。 */
  async defaultToken(userId: string): Promise<string | undefined> {
    const rows: any[] = await this.db.get(USER_TABLE, { userId })
    return rows[0]?.token || (await this.options.fallbackToken())
  }

  async setDefaultToken(userId: string, token: string): Promise<void> {
    const rows: any[] = await this.db.get(USER_TABLE, { userId })
    const now = Date.now()
    if (rows.length) {
      await this.db.set(USER_TABLE, { userId }, { token, updatedAt: now })
    } else {
      await this.db.create(USER_TABLE, { userId, token, updatedAt: now })
    }
  }

  async bindings(userId: string): Promise<StoredBinding[]> {
    const rows: any[] = await this.db.get(BINDING_TABLE, { userId })
    return rows.sort((a, b) => a.boundAt - b.boundAt) as StoredBinding[]
  }

  async addBinding(
    userId: string,
    token: string,
    rawKey: string,
  ): Promise<{ binding: StoredBinding; count: number }> {
    const accountToken = token.trim()
    const current = await this.bindings(userId)
    if (current.length >= this.config.maxBindings) {
      throw new BindError(`最多只能绑定 ${this.config.maxBindings} 个 Key，先用 dsu.remove 删掉一个。`)
    }

    let keys = await this.keys(accountToken)
    const candidate = rawKey.trim()
    const suffixOnly = /^[A-Za-z0-9]{4,32}$/.test(candidate) && !candidate.startsWith('sk-')
    const matcher = (key: ApiKeyInfo) =>
      suffixOnly
        ? key.sensitiveId.toLowerCase().endsWith(candidate.toLowerCase())
        : matchesMaskedKey(candidate, key.sensitiveId)

    let matches = keys.filter(matcher)
    if (!matches.length) {
      keys = await this.keys(accountToken, true)
      matches = keys.filter(matcher)
    }
    if (!matches.length) {
      throw new BindError(
        suffixOnly
          ? `没有在这个账号里找到尾号「${candidate}」的 Key，确认一下尾号，或者这个 Key 是不是这个账号下的。`
          : '没有在这个账号里找到这个 Key，确认一下是不是复制完整了，或者它是不是这个账号下的 Key。',
      )
    }
    if (matches.length > 1) {
      const names = matches
        .map((key) => `${key.name || key.trackingId}（${shortMask(key.sensitiveId)}）`)
        .join('、')
      throw new BindError(`「${candidate}」同时匹配到多个 Key：${names}，请多写几位尾号。`)
    }

    const key = matches[0]
    if (current.some((item) => item.token === accountToken && item.trackingId === key.trackingId)) {
      throw new BindError('你已经绑定过这个 Key 了，直接发 dsu 就能查。')
    }
    if (!suffixOnly) await this.options.verifier.getBalance(candidate)

    const binding: StoredBinding = {
      id: randomUUID(),
      userId,
      token: accountToken,
      trackingId: key.trackingId,
      keyName: key.name,
      sensitiveId: key.sensitiveId,
      boundAt: Date.now(),
    }
    await this.db.create(BINDING_TABLE, binding)
    await this.setDefaultToken(userId, accountToken)
    this.logger?.info?.(`用户 ${userId} 绑定了 Key ${key.name}（${key.sensitiveId}）`)
    return { binding, count: current.length + 1 }
  }

  async matchBindings(userId: string, query: string): Promise<StoredBinding[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const rows = await this.bindings(userId)
    if (/^\d+$/.test(q)) {
      const index = Number(q)
      if (index >= 1 && index <= rows.length) return [rows[index - 1]]
    }
    const exact = rows.filter((item) => item.keyName.toLowerCase() === q)
    if (exact.length) return exact
    return rows.filter(
      (item) =>
        item.keyName.toLowerCase().includes(q) ||
        item.trackingId.toLowerCase().startsWith(q) ||
        item.sensitiveId.toLowerCase().endsWith(q),
    )
  }

  async removeBinding(userId: string, query: string): Promise<StoredBinding> {
    const matches = await this.matchBindings(userId, query)
    if (!matches.length) throw new BindError(`没有找到「${query}」对应的 Key。`)
    if (matches.length > 1) throw new BindError(`「${query}」匹配到多个 Key，请写完整一点。`)
    await this.db.remove(BINDING_TABLE, { id: matches[0].id })
    return matches[0]
  }

  async clear(userId: string): Promise<number> {
    const rows = await this.bindings(userId)
    if (rows.length) await this.db.remove(BINDING_TABLE, { userId })
    await this.db.remove(USER_TABLE, { userId })
    return rows.length
  }

  /** 按 token 顺序生成「账号1、账号2」，同一个 token 的 Key 共用一个编号。 */
  labels(bindings: StoredBinding[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const binding of bindings) {
      if (!map.has(binding.token)) map.set(binding.token, `账号${map.size + 1}`)
    }
    return map
  }

  async reportKey(token: string, key: ApiKeyInfo, label?: string): Promise<Report> {
    const binding: StoredBinding = {
      id: `key:${key.trackingId}`,
      userId: '',
      token,
      trackingId: key.trackingId,
      keyName: key.name,
      sensitiveId: key.sensitiveId,
      boundAt: 0,
    }
    return this.report(binding, label)
  }

  async report(binding: StoredBinding, label?: string): Promise<Report> {
    const now = Math.floor(Date.now() / 1000)
    const tzOffset = tzOffsetSeconds(new Date(), this.config.timeZone)
    const keys = await this.keys(binding.token)
    const key = keys.find((item) => item.trackingId === binding.trackingId) ?? {
      trackingId: binding.trackingId,
      name: binding.keyName,
      sensitiveId: binding.sensitiveId,
      createdAt: null,
      lastUse: null,
    }
    const start = this.alignDay(
      key.createdAt ? Math.floor(key.createdAt / 1000) : now - 30 * DAY_SECONDS,
      tzOffset,
    )
    const end = startOfLocalDay(now, tzOffset) + DAY_SECONDS
    const bundle = await this.fetchUsage(binding.token, { start, end }, [binding.trackingId])
    const amounts = bundle.amounts.filter((series) => series.apiKey.trackingId === binding.trackingId)
    const costs = bundle.costs.filter((series) => series.apiKey.trackingId === binding.trackingId)
    const base = { tzOffset, currency: this.config.currency }
    const total = aggregate(amounts, costs, base)
    const today = aggregate(amounts, costs, {
      ...base,
      dayIndex: localDayIndex(now, tzOffset),
    })
    const summary = await this.summary(binding.token).catch((error) => {
      this.logger?.warn?.(`获取账户余额失败：${(error as Error).message}`)
      return null
    })
    return {
      key,
      total,
      today,
      balance: summary ? this.pickBalance(summary) : undefined,
      range: { start, end },
      updatedAt: Date.now(),
      accountLabel: label,
    }
  }

  async reportsForUser(userId: string): Promise<UserReport[]> {
    const bindings = await this.bindings(userId)
    const labels = this.labels(bindings)
    return Promise.all(
      bindings.map(async (binding) => ({
        binding,
        label: labels.get(binding.token)!,
        report: await this.report(binding, labels.get(binding.token)),
      })),
    )
  }

  async accountReports(userId: string, label: string): Promise<UserReport[]> {
    const reports = await this.reportsForUser(userId)
    return reports.filter((item) => item.label === label)
  }

  /** 一个账号下所有 Key 的汇总，管理员总览和账号查询用。 */
  async overview(token: string): Promise<AccountOverview> {
    const now = Math.floor(Date.now() / 1000)
    const tzOffset = tzOffsetSeconds(new Date(), this.config.timeZone)
    const keys = await this.keys(token)
    const earliest = keys.reduce<number | null>((min, key) => {
      if (!key.createdAt) return min
      return min === null ? key.createdAt : Math.min(min, key.createdAt)
    }, null)
    const start = this.alignDay(earliest ? Math.floor(earliest / 1000) : now - 30 * DAY_SECONDS, tzOffset)
    const end = startOfLocalDay(now, tzOffset) + DAY_SECONDS
    const bundle = await this.fetchUsage(token, { start, end }, undefined)
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
    const summary = await this.summary(token).catch((error) => {
      this.logger?.warn?.(`获取账户余额失败：${(error as Error).message}`)
      return null
    })
    const accountCost = summary
      ? summary.totalCosts
          .filter((item) => item.currency === this.config.currency)
          .reduce((sum, item) => sum + item.amount, 0)
      : total.cost
    return {
      keys: list,
      total,
      accountCost,
      accountTokens: totalTokens(total),
      balance: summary ? this.pickBalance(summary) : undefined,
      updatedAt: Date.now(),
    }
  }

  /** 管理员：跨所有已绑定过的账号，分页列出全部 Key。 */
  async allPage(page = 1): Promise<AllPage> {
    const bindings = (await this.db.get(BINDING_TABLE, {})) as StoredBinding[]
    bindings.sort((a, b) => a.boundAt - b.boundAt)
    const labels = this.labels(bindings)
    const tokens = [...labels.keys()]

    const accounts = await Promise.all(
      tokens.map(async (token) => ({
        token,
        label: labels.get(token)!,
        overview: await this.overview(token),
      })),
    )

    const entries: AllKeyEntry[] = []
    for (const account of accounts) {
      for (const item of account.overview.keys) {
        entries.push({
          label: account.label,
          key: item.key,
          total: item.total,
          today: item.today,
          binding: bindings.find(
            (binding) => binding.token === account.token && binding.trackingId === item.key.trackingId,
          ),
        })
      }
    }
    entries.sort((a, b) => b.today.cost - a.today.cost || b.total.cost - a.total.cost)

    const pageSize = Math.max(1, this.config.allPageSize)
    const pages = Math.max(1, Math.ceil(entries.length / pageSize))
    const current = Math.min(Math.max(1, Math.floor(page) || 1), pages)
    const balance = accounts.reduce((sum, account) => sum + (account.overview.balance?.total ?? 0), 0)
    const totalCost = accounts.reduce((sum, account) => sum + account.overview.accountCost, 0)
    const tokenCount = entries.reduce((sum, entry) => sum + totalTokens(entry.total), 0)

    return {
      accounts: accounts.length,
      keys: entries.length,
      balance,
      totalCost,
      tokens: tokenCount,
      page: current,
      pages,
      pageSize,
      entries: entries.slice((current - 1) * pageSize, current * pageSize),
      updatedAt: Date.now(),
    }
  }

  async findKeys(query: string): Promise<Array<{ key: ApiKeyInfo; token: string; label: string; binding?: StoredBinding }>> {
    const bindings = (await this.db.get(BINDING_TABLE, {})) as StoredBinding[]
    bindings.sort((a, b) => a.boundAt - b.boundAt)
    const labels = this.labels(bindings)
    const q = query.trim().toLowerCase()
    if (!q) return []
    const result: Array<{ key: ApiKeyInfo; token: string; label: string; binding?: StoredBinding }> = []
    for (const [token, label] of labels) {
      const keys = await this.keys(token)
      for (const key of keys) {
        if (
          key.name.toLowerCase() === q ||
          key.name.toLowerCase().includes(q) ||
          key.trackingId.toLowerCase().startsWith(q) ||
          key.sensitiveId.toLowerCase().endsWith(q)
        ) {
          result.push({
            key,
            token,
            label,
            binding: bindings.find(
              (binding) => binding.token === token && binding.trackingId === key.trackingId,
            ),
          })
        }
      }
    }
    return result
  }

  clearCache(): void {
    this.cache.clear()
  }

  private alignDay(timeSeconds: number, tzOffset: number): number {
    return Math.floor((timeSeconds + tzOffset) / DAY_SECONDS) * DAY_SECONDS - tzOffset
  }

  private pickBalance(summary: UserSummary): BalanceInfo {
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

  private async fetchUsage(
    token: string,
    range: Range,
    trackingIds: string[] | undefined,
    force = false,
  ): Promise<UsageBundle> {
    const ids = trackingIds?.slice().sort()
    const cacheKey = `usage:${token}:${ids?.join(',') ?? '*'}:${range.start}:${range.end}`
    return this.memo(
      cacheKey,
      async () => {
        const amounts: AmountSeries[] = []
        const costs: CostSeries[] = []
        if (range.end <= range.start) return { amounts, costs }
        for (let start = range.start; start < range.end; start += CHUNK_SECONDS) {
          const end = Math.min(start + CHUNK_SECONDS, range.end)
          const [chunkAmounts, chunkCosts] = await Promise.all([
            this.client(token).getAmount({ start, end }, ids),
            this.client(token).getCost({ start, end }, ids),
          ])
          amounts.push(...chunkAmounts)
          costs.push(...chunkCosts)
        }
        return { amounts, costs }
      },
      force,
    )
  }
}
