/** 一条 API Key 的元信息，对应平台 `get_api_keys` 返回值。 */
export interface ApiKeyInfo {
  /** 平台内部 ID，查询用量时使用 */
  trackingId: string
  /** 用户在平台上给 Key 起的名字 */
  name: string
  /** 脱敏后的 Key，例如 `sk-klmno**9012` */
  sensitiveId: string
  /** `DSH` 或普通 Key */
  keyType?: string
  /** 创建时间（毫秒时间戳） */
  createdAt: number | null
  /** 最后一次使用时间（毫秒时间戳） */
  lastUse: number | null
}

/** 一段时间内的 token 用量。 */
export interface TokenUsage {
  cacheHit: number
  cacheMiss: number
  output: number
  requests: number
}

export interface UsageBucket {
  /** 桶起始时间（秒级时间戳） */
  time: number
  usage: TokenUsage
}

export interface AmountSeries {
  apiKey: ApiKeyInfo
  model: string
  buckets: UsageBucket[]
}

export interface CostBucket {
  time: number
  cost: number
}

export interface CostSeries {
  apiKey: ApiKeyInfo
  model: string
  currency: string
  buckets: CostBucket[]
  kind: 'model' | 'function'
}

export interface Wallet {
  currency: string
  balance: number
  tokenEstimation?: number
}

export interface UserSummary {
  /** 账户累计花费（按币种） */
  totalCosts: { currency: string; amount: number }[]
  /** 充值余额 */
  normalWallets: Wallet[]
  /** 赠送余额 */
  bonusWallets: Wallet[]
  currentToken?: string
  totalUsage?: number
  monthlyUsage?: number
}

/** 用户与 Key 的绑定关系，只保存脱敏信息。 */
export interface Binding {
  trackingId: string
  name: string
  sensitiveId: string
  /** 绑定时间（毫秒时间戳） */
  boundAt: number
  /** 绑定发起者，格式 `${platform}:${userId}` */
  boundBy: string
}

/** 一组可累加的用量数据。 */
export interface Stat {
  cost: number
  cacheHit: number
  cacheMiss: number
  output: number
  requests: number
}

export interface BalanceInfo {
  currency: string
  total: number
  granted: number
  toppedUp: number
  available: boolean
}

export interface Report {
  key: ApiKeyInfo
  total: Stat
  today: Stat
  balance?: BalanceInfo
  range: { start: number; end: number }
  updatedAt: number
  /** 多账号展示用：账号1、账号2 */
  accountLabel?: string
}

export interface KeyOverview {
  key: ApiKeyInfo
  total: Stat
  today: Stat
  /** 这个 Key 的统计区间（从 Key 创建当天到明天零点） */
  range?: Range
  /** 是否已被某个用户绑定 */
  binding?: Binding
}

export interface AccountOverview {
  keys: KeyOverview[]
  total: Stat
  accountCost: number
  accountTokens: number
  balance?: BalanceInfo
  updatedAt: number
}

export interface Range {
  start: number
  end: number
}
