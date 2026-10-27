import { describe, expect, it } from 'vitest'
import { matchesKeyQuery } from '../src/account-service'
import type { ApiKeyInfo } from '../src/types'

const key = (over: Partial<ApiKeyInfo>): ApiKeyInfo => ({
  trackingId: 'tk_1',
  name: '示例A',
  sensitiveId: 'sk-abcde**1234',
  createdAt: null,
  lastUse: null,
  ...over,
})

/** DeepSeek Harness 建的 Key 没有 sensitive_id，只能靠名字或 ID 绑。 */
const harnessKey = key({
  trackingId: '532b6cac-97d0-4f8d-b827-19525400e812',
  name: 'DeepSeek Harness 532b6cac-97d0-4f8d-b827-19525400e812',
  sensitiveId: '',
})

describe('matchesKeyQuery', () => {
  it('matches by masked suffix', () => {
    expect(matchesKeyQuery(key({}), '1234')).toBe(true)
    expect(matchesKeyQuery(key({}), '9999')).toBe(false)
  })

  it('matches by full key', () => {
    expect(matchesKeyQuery(key({}), 'sk-abcde0123456789abcdef1234')).toBe(true)
    expect(matchesKeyQuery(key({}), 'sk-zzzzz0123456789abcdef1234')).toBe(false)
  })

  it('matches by name or tracking id when there is no masked key', () => {
    expect(matchesKeyQuery(harnessKey, 'DeepSeek Harness 532b6cac-97d0-4f8d-b827-19525400e812')).toBe(true)
    expect(matchesKeyQuery(harnessKey, 'harness')).toBe(true)
    expect(matchesKeyQuery(harnessKey, '532b6cac')).toBe(true)
    expect(matchesKeyQuery(harnessKey, 'e812')).toBe(true)
    expect(matchesKeyQuery(harnessKey, '不存在')).toBe(false)
  })

  it('ignores empty queries', () => {
    expect(matchesKeyQuery(key({}), '   ')).toBe(false)
  })
})
