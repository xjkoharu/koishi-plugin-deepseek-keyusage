import type {
  AmountSeries,
  ApiKeyInfo,
  CostSeries,
  Range,
  TokenUsage,
  UserSummary,
} from '../types'
import { tzOffsetSeconds } from '../utils/time'
import { PlatformError } from './errors'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface PlatformClientOptions {
  baseUrl: string
  token: string
  /** 运行时解析 Token（支持自动读取浏览器） */
  tokenProvider?: () => Promise<string> | string
  timeZone: string
  timeout?: number
  fetchImpl?: FetchLike
  debug?: (message: string, detail?: unknown) => void
}

type QueryValue = string | number | Array<string | number> | undefined

interface Envelope<T> {
  code?: number
  msg?: string
  data?: {
    biz_code?: number
    biz_msg?: string
    biz_data?: T
  } | null
}

interface RawApiKey {
  tracking_id?: string
  name?: string
  sensitive_id?: string
  key_type?: string
  created_at?: number | string
  last_use?: number | string | null
}

interface RawUsage {
  PROMPT_CACHE_HIT_TOKEN?: number | string
  PROMPT_CACHE_MISS_TOKEN?: number | string
  RESPONSE_TOKEN?: number | string
  REQUEST?: number | string
  promptCacheHitToken?: number | string
  promptCacheMissToken?: number | string
  responseToken?: number | string
  request?: number | string
}

interface RawSeries {
  api_key?: RawApiKey
  model?: string
  buckets?: Array<{ time?: number | string; usage?: RawUsage }>
}

interface RawAmountBiz {
  bucket?: string
  series?: RawSeries[]
  function_series?: RawSeries[]
}

interface RawCostSeries {
  api_key?: RawApiKey
  model?: string
  buckets?: Array<{ time?: number | string; cost?: number | string }>
}

interface RawCostGroup {
  currency?: string
  series?: RawCostSeries[]
  function_series?: RawCostSeries[]
}

interface RawCostBiz {
  data?: RawCostGroup[]
}

interface RawSummary {
  total_costs?: Array<{ currency?: string; amount?: number | string }>
  normal_wallets?: Array<{ currency?: string; balance?: number | string; token_estimation?: number | string }>
  bonus_wallets?: Array<{ currency?: string; balance?: number | string; token_estimation?: number | string }>
  current_token?: string
  total_usage?: number | string
  monthly_usage?: number | string
}

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** DeepSeek 开放平台网页端使用的内部接口。 */
export class PlatformClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly tokenProvider?: () => Promise<string> | string
  private readonly timeZone: string
  private readonly timeout: number
  private readonly fetchImpl: FetchLike
  private readonly debug?: (message: string, detail?: unknown) => void

  constructor(options: PlatformClientOptions) {
    this.baseUrl = options.baseUrl
    this.token = options.token
    this.tokenProvider = options.tokenProvider
    this.timeZone = options.timeZone
    this.timeout = options.timeout ?? 10000
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.debug = options.debug
  }

  async getApiKeys(): Promise<ApiKeyInfo[]> {
    const data = await this.request<{ api_keys?: RawApiKey[] }>('/api/v0/users/get_api_keys')
    return (data.api_keys ?? [])
      .map((key) => this.mapKey(key))
      .filter((key): key is ApiKeyInfo => !!key)
  }

  async getSummary(): Promise<UserSummary> {
    const data = await this.request<RawSummary>('/api/v0/users/get_user_summary')
    return {
      totalCosts: (data.total_costs ?? []).map((item) => ({
        currency: item.currency ?? 'CNY',
        amount: num(item.amount),
      })),
      normalWallets: (data.normal_wallets ?? []).map((item) => ({
        currency: item.currency ?? 'CNY',
        balance: num(item.balance),
        tokenEstimation: item.token_estimation === undefined ? undefined : num(item.token_estimation),
      })),
      bonusWallets: (data.bonus_wallets ?? []).map((item) => ({
        currency: item.currency ?? 'CNY',
        balance: num(item.balance),
        tokenEstimation: item.token_estimation === undefined ? undefined : num(item.token_estimation),
      })),
      currentToken: data.current_token,
      totalUsage: data.total_usage === undefined ? undefined : num(data.total_usage),
      monthlyUsage: data.monthly_usage === undefined ? undefined : num(data.monthly_usage),
    }
  }

  async getAmount(range: Range, trackingIds?: string[]): Promise<AmountSeries[]> {
    const data = await this.request<RawAmountBiz>('/api/v0/usage/by_api_key/amount', {
      start: range.start,
      end: range.end,
      tz: this.tzFor(range),
      api_key_tracking_id: trackingIds,
    })
    return this.flattenSeries(data.series)
  }

  async getCost(range: Range, trackingIds?: string[]): Promise<CostSeries[]> {
    const data = await this.request<RawCostBiz>('/api/v0/usage/by_api_key/cost', {
      start: range.start,
      end: range.end,
      tz: this.tzFor(range),
      api_key_tracking_id: trackingIds,
    })
    const result: CostSeries[] = []
    for (const group of data.data ?? []) {
      const currency = group.currency ?? 'CNY'
      for (const series of group.series ?? []) {
        const mapped = this.mapCostSeries(series, currency, 'model')
        if (mapped) result.push(mapped)
      }
      for (const series of group.function_series ?? []) {
        const mapped = this.mapCostSeries(series, currency, 'function')
        if (mapped) result.push(mapped)
      }
    }
    return result
  }

  private tzFor(range: Range): number {
    return tzOffsetSeconds(new Date(range.start * 1000), this.timeZone)
  }

  private mapKey(key: RawApiKey): ApiKeyInfo | null {
    const trackingId = String(key.tracking_id ?? '').trim()
    if (!trackingId) return null
    return {
      trackingId,
      name: String(key.name ?? trackingId),
      sensitiveId: String(key.sensitive_id ?? ''),
      keyType: key.key_type,
      createdAt: key.created_at ? num(key.created_at) * 1000 : null,
      lastUse: key.last_use ? num(key.last_use) * 1000 : null,
    }
  }

  private flattenSeries(series: RawSeries[] | undefined): AmountSeries[] {
    const result: AmountSeries[] = []
    for (const item of series ?? []) {
      const apiKey = this.mapKey(item.api_key ?? {})
      if (!apiKey) continue
      const buckets = (item.buckets ?? []).map((bucket) => ({
        time: num(bucket.time),
        usage: this.mapUsage(bucket.usage),
      }))
      result.push({ apiKey, model: item.model ?? 'unknown', buckets })
    }
    return result
  }

  private mapUsage(usage: RawUsage | undefined): TokenUsage {
    if (!usage) return { cacheHit: 0, cacheMiss: 0, output: 0, requests: 0 }
    return {
      cacheHit: num(usage.PROMPT_CACHE_HIT_TOKEN ?? usage.promptCacheHitToken),
      cacheMiss: num(usage.PROMPT_CACHE_MISS_TOKEN ?? usage.promptCacheMissToken),
      output: num(usage.RESPONSE_TOKEN ?? usage.responseToken),
      requests: num(usage.REQUEST ?? usage.request),
    }
  }

  private mapCostSeries(series: RawCostSeries, currency: string, kind: 'model' | 'function'): CostSeries | null {
    const apiKey = this.mapKey(series.api_key ?? {})
    if (!apiKey) return null
    return {
      apiKey,
      model: series.model ?? (kind === 'function' ? 'function' : 'unknown'),
      currency,
      kind,
      buckets: (series.buckets ?? []).map((bucket) => ({
        time: num(bucket.time),
        cost: num(bucket.cost),
      })),
    }
  }

  private async request<T>(path: string, query: Record<string, QueryValue> = {}): Promise<T> {
    const token = this.tokenProvider ? await this.tokenProvider() : this.token
    if (!token) {
      throw new PlatformError('尚未配置 DeepSeek 平台 Token', 'config')
    }
    const url = new URL(path, this.baseUrl)
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item))
      } else {
        url.searchParams.set(key, String(value))
      }
    }
    this.debug?.(`GET ${url.pathname}`, Object.fromEntries(url.searchParams))

    const attempts = 3
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': 'koishi-plugin-deepseek-keyusage/0.1',
          },
          signal: AbortSignal.timeout(this.timeout),
        })
        if (response.status === 401 || response.status === 403) {
          throw new PlatformError('平台 Token 无效或已过期，请在插件配置中更新 userToken', 'auth', undefined, response.status)
        }
        if (response.status === 429) {
          throw new PlatformError('平台限流，请稍后再试', 'rate-limit', undefined, 429)
        }
        if (!response.ok) {
          if (response.status >= 500 && attempt < attempts - 1) {
            await sleep(500 * (attempt + 1))
            continue
          }
          throw new PlatformError(`平台接口返回 HTTP ${response.status}`, 'network', undefined, response.status)
        }
        const body = (await response.json()) as Envelope<T>
        if (typeof body?.code === 'number' && body.code !== 0) {
          if (body.code === 40002 || body.code === 40003) {
            throw new PlatformError('平台 Token 无效或已过期，请在插件配置中更新 userToken', 'auth', body.code)
          }
          throw new PlatformError(body.msg || `平台接口返回错误码 ${body.code}`, 'api', body.code)
        }
        const payload = body?.data
        if (payload && typeof payload.biz_code === 'number' && payload.biz_code !== 0) {
          throw new PlatformError(payload.biz_msg || `平台业务错误 ${payload.biz_code}`, 'api', payload.biz_code)
        }
        return (payload?.biz_data ?? ({} as T)) as T
      } catch (error) {
        lastError = error
        if (error instanceof PlatformError) throw error
        if (attempt < attempts - 1) {
          await sleep(500 * (attempt + 1))
          continue
        }
      }
    }
    throw new PlatformError(`无法连接 DeepSeek 平台：${(lastError as Error)?.message ?? '未知错误'}`, 'network')
  }
}
