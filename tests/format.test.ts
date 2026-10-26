import { describe, expect, it } from 'vitest'
import {
  formatCompact,
  formatInt,
  formatMoney,
  formatPercent,
  looksLikeApiKey,
  looksLikeKeySuffix,
  maskKey,
  matchesMaskedKey,
} from '../src/utils/format'

describe('looksLikeKeySuffix', () => {
  it('accepts a short key suffix', () => {
    expect(looksLikeKeySuffix('25f0')).toBe(true)
    expect(looksLikeKeySuffix('abcd1234')).toBe(true)
  })

  it('rejects full keys and too-short values', () => {
    expect(looksLikeKeySuffix('sk-abcde0123456789abcdef1234')).toBe(false)
    expect(looksLikeKeySuffix('25f')).toBe(false)
  })
})

describe('maskKey', () => {
  it('masks a full key into platform style', () => {
    expect(maskKey('sk-abcde0123456789abcdef1234')).toBe('sk-abcde**1234')
  })

  it('keeps an already masked id untouched', () => {
    expect(maskKey('sk-abcde**1234')).toBe('sk-abcde**1234')
  })
})

describe('matchesMaskedKey', () => {
  const masked = 'sk-abcde**1234'

  it('matches prefix and suffix', () => {
    expect(matchesMaskedKey('sk-abcde0123456789abcdef1234', masked)).toBe(true)
  })

  it('matches platform masks with many asterisks', () => {
    const platformMask = 'sk-abcde***********************1234'
    expect(matchesMaskedKey('sk-abcde0123456789abcdef1234', platformMask)).toBe(true)
    expect(matchesMaskedKey('sk-abcde0123456789abcdef0000', platformMask)).toBe(false)
  })

  it('rejects different suffix', () => {
    expect(matchesMaskedKey('sk-abcde0123456789abcdef0000', masked)).toBe(false)
  })

  it('rejects different prefix', () => {
    expect(matchesMaskedKey('sk-111110123456789abcdef1234', masked)).toBe(false)
  })

  it('handles empty values', () => {
    expect(matchesMaskedKey('', masked)).toBe(false)
    expect(matchesMaskedKey('sk-abcde0123456789abcdef1234', '')).toBe(false)
  })
})

describe('looksLikeApiKey', () => {
  it('accepts deepseek keys', () => {
    expect(looksLikeApiKey('sk-abcde0123456789abcdef1234')).toBe(true)
  })

  it('rejects short or malformed strings', () => {
    expect(looksLikeApiKey('sk-123')).toBe(false)
    expect(looksLikeApiKey('hello world')).toBe(false)
  })
})

describe('format helpers', () => {
  it('formats money with more precision for small values', () => {
    expect(formatMoney(12.3456, 'CNY')).toBe('¥12.35')
    expect(formatMoney(0.1234, 'CNY')).toBe('¥0.123')
    expect(formatMoney(0.0012, 'CNY')).toBe('¥0.0012')
    expect(formatMoney(0, 'CNY')).toBe('¥0.00')
    expect(formatMoney(1.2, 'USD')).toBe('$1.20')
  })

  it('formats integers and percentages', () => {
    expect(formatInt(1234567)).toBe('1,234,567')
    expect(formatPercent(0.727312)).toBe('72.73%')
    expect(formatPercent(0)).toBe('0.00%')
  })

  it('formats compact numbers', () => {
    expect(formatCompact(999)).toBe('999')
    expect(formatCompact(1234)).toBe('1.2k')
    expect(formatCompact(1234567)).toBe('1.23M')
  })
})
