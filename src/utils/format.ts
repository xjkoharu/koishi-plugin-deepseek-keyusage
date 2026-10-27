const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥',
  USD: '$',
}

/** 金额：小于 1 元时保留更多小数，避免显示成一片 0.00。 */
export function formatMoney(value: number, currency = 'CNY'): string {
  const n = Number.isFinite(value) ? value : 0
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `
  const digits = n === 0 ? 2 : n >= 1 ? 2 : n >= 0.01 ? 3 : 4
  return symbol + n.toFixed(digits)
}

/** 千分位整数。 */
export function formatInt(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0
  return n.toLocaleString('en-US')
}

/** 比例 → 百分比文本。 */
export function formatPercent(ratio: number): string {
  const n = Number.isFinite(ratio) ? ratio * 100 : 0
  return `${n.toFixed(2)}%`
}

/** 大数字缩写，用于列表页。 */
export function formatCompact(value: number): string {
  const n = Number.isFinite(value) ? value : 0
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e4) return `${(n / 1e3).toFixed(0)}k`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(Math.round(n))
}

/** 把任意长度的星号掩码压缩成 sk-abcde**wxyz 这种短形式。 */
export function shortMask(masked: string): string {
  const text = masked.trim()
  const first = text.indexOf('*')
  if (first < 0) return text
  const last = text.lastIndexOf('*')
  const prefix = text.slice(0, first)
  const suffix = text.slice(last + 1)
  return `${prefix}**${suffix}`
}

/** 把完整 Key 脱敏成平台风格：sk-abcde**wxyz。 */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ''
  if (trimmed.includes('*')) return shortMask(trimmed)
  if (trimmed.length <= 12) return `${trimmed.slice(0, 3)}**${trimmed.slice(-2)}`
  return `${trimmed.slice(0, 8)}**${trimmed.slice(-4)}`
}

/**
 * 判断用户提交的完整 Key 是否匹配平台给出的脱敏 ID。
 * 平台返回的星号数量不固定（如 sk-klmno***********************9012），
 * 所以只比第一段星号之前的前缀和最后一段星号之后的后缀。
 */
export function matchesMaskedKey(fullKey: string, sensitiveId: string): boolean {
  const key = fullKey.trim()
  const masked = sensitiveId.trim()
  if (!key || !masked) return false
  const first = masked.indexOf('*')
  if (first < 0) return key === masked
  const last = masked.lastIndexOf('*')
  const prefix = masked.slice(0, first)
  const suffix = masked.slice(last + 1)
  if (!prefix) return false
  if (!key.startsWith(prefix)) return false
  return suffix ? key.endsWith(suffix) : true
}

/** 粗略校验 Key 格式。 */
export function looksLikeApiKey(key: string): boolean {
  return /^sk-[A-Za-z0-9]{16,}$/.test(key.trim())
}

/** 允许用户只提供 Key 尾号，避免在聊天里发完整 Key。 */
export function looksLikeKeySuffix(value: string): boolean {
  return /^[A-Za-z0-9]{4,32}$/.test(value.trim())
}

/** 一串字符像不像 userToken / 完整 Key：32 位以上的无空格串，且同时有字母和数字。 */
const SECRET_LIKE = /[A-Za-z0-9+/=_-]{32,}/g

function isSecretLike(value: string): boolean {
  return value.length >= 32 && /\d/.test(value) && /[A-Za-z]/.test(value)
}

/** 把混在文本里的 Token / 完整 Key 打码，避免在聊天里回显。 */
export function scrubSecrets(text: string): string {
  return String(text).replace(SECRET_LIKE, (match) =>
    isSecretLike(match) ? `${match.slice(0, 4)}***${match.slice(-4)}` : match,
  )
}

/** 直接去掉文本里的 Token / 完整 Key 片段，账号备注清洗用。 */
export function stripSecrets(text: string): string {
  return String(text)
    .replace(SECRET_LIKE, (match) => (isSecretLike(match) ? ' ' : match))
    .replace(/\s+/g, ' ')
    .trim()
}

