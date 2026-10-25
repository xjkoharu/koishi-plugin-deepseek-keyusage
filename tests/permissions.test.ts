import { describe, expect, it } from 'vitest'
import { isAdminUser } from '../src/permissions'

const config = { adminUsers: ['qq:abc'], adminAuthority: 4 }

describe('isAdminUser', () => {
  it('accepts a whitelist match with platform prefix', () => {
    expect(isAdminUser('qq', 'abc', 0, config)).toBe(true)
  })

  it('accepts a whitelist match with a bare user id', () => {
    expect(isAdminUser('onebot', 'abc', 0, { adminUsers: ['abc'], adminAuthority: 4 })).toBe(true)
  })

  it('accepts authority above the threshold', () => {
    expect(isAdminUser('qq', 'someone', 4, config)).toBe(true)
    expect(isAdminUser('qq', 'someone', 5, config)).toBe(true)
  })

  it('takes the union of both mechanisms', () => {
    const noWhitelist = { adminUsers: [], adminAuthority: 4 }
    expect(isAdminUser('qq', 'someone', 5, noWhitelist)).toBe(true)
    const lowAuthority = { adminUsers: ['qq:abc'], adminAuthority: 4 }
    expect(isAdminUser('qq', 'abc', 1, lowAuthority)).toBe(true)
  })

  it('rejects users that match neither', () => {
    expect(isAdminUser('qq', 'someone', 3, config)).toBe(false)
    expect(isAdminUser('qq', undefined, 5, config)).toBe(false)
    expect(isAdminUser('qq', '', 5, config)).toBe(false)
  })
})
