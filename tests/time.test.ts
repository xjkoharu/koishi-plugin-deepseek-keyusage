import { describe, expect, it } from 'vitest'
import { formatDayLabel, localDayIndex, startOfLocalDay, tzOffsetSeconds } from '../src/utils/time'

const SHANGHAI = 8 * 3600

describe('tzOffsetSeconds', () => {
  it('returns +8h for Asia/Shanghai', () => {
    expect(tzOffsetSeconds(new Date('2026-10-25T12:00:00Z'), 'Asia/Shanghai')).toBe(SHANGHAI)
  })

  it('returns +9h for Asia/Tokyo', () => {
    expect(tzOffsetSeconds(new Date('2026-10-25T12:00:00Z'), 'Asia/Tokyo')).toBe(9 * 3600)
  })
})

describe('localDayIndex', () => {
  it('treats 00:00 local as a new day', () => {
    const before = Math.floor(Date.UTC(2026, 9, 24, 15, 59, 59) / 1000) // 23:59:59 +08
    const after = Math.floor(Date.UTC(2026, 9, 24, 16, 0, 0) / 1000) // 00:00 +08
    expect(localDayIndex(after, SHANGHAI)).toBe(localDayIndex(before, SHANGHAI) + 1)
  })

  it('keeps a UTC-midnight bucket on the same local day', () => {
    const utcMidnight = Math.floor(Date.UTC(2026, 9, 25, 0, 0, 0) / 1000)
    expect(localDayIndex(utcMidnight, SHANGHAI)).toBe(localDayIndex(utcMidnight + 8 * 3600, SHANGHAI))
  })
})

describe('startOfLocalDay', () => {
  it('returns local midnight', () => {
    const now = Math.floor(Date.UTC(2026, 9, 25, 13, 30, 0) / 1000) // 21:30 +08
    const start = startOfLocalDay(now, SHANGHAI)
    expect(start).toBe(Math.floor(Date.UTC(2026, 9, 24, 16, 0, 0) / 1000))
    expect(formatDayLabel(start, SHANGHAI)).toBe('2026-10-25')
  })
})
