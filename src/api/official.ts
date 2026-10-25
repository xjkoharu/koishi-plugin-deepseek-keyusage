import { PlatformError } from './errors'
import type { FetchLike } from './client'

export interface OfficialClientOptions {
  baseUrl: string
  timeout?: number
  fetchImpl?: FetchLike
}

export interface OfficialBalanceInfo {
  currency: string
  totalBalance: number
  grantedBalance: number
  toppedUpBalance: number
}

export interface OfficialBalance {
  isAvailable: boolean
  balances: OfficialBalanceInfo[]
}

interface RawOfficialBalance {
  is_available?: boolean
  balance_infos?: Array<{
    currency?: string
    total_balance?: string | number
    granted_balance?: string | number
    topped_up_balance?: string | number
  }>
}

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 官方 API 客户端，只用来确认用户提交的 Key 是否有效、以及作为余额兜底。
 * 官方余额是账号维度的，不区分 Key。
 */
export class OfficialClient {
  private readonly baseUrl: string
  private readonly timeout: number
  private readonly fetchImpl: FetchLike

  constructor(options: OfficialClientOptions) {
    this.baseUrl = options.baseUrl
    this.timeout = options.timeout ?? 10000
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  async getBalance(apiKey: string): Promise<OfficialBalance> {
    const url = new URL('/user/balance', this.baseUrl)
    let response: Response
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeout),
      })
    } catch (error) {
      throw new PlatformError(`无法连接 DeepSeek 官方接口：${(error as Error).message}`, 'network')
    }
    if (response.status === 401 || response.status === 403) {
      throw new PlatformError('这个 Key 无效或已被禁用', 'invalid-key', undefined, response.status)
    }
    if (!response.ok) {
      throw new PlatformError(`校验 Key 失败（HTTP ${response.status}）`, 'api', undefined, response.status)
    }
    const body = (await response.json()) as RawOfficialBalance
    return {
      isAvailable: body.is_available !== false,
      balances: (body.balance_infos ?? []).map((item) => ({
        currency: item.currency ?? 'CNY',
        totalBalance: num(item.total_balance),
        grantedBalance: num(item.granted_balance),
        toppedUpBalance: num(item.topped_up_balance),
      })),
    }
  }
}
