import { describe, expect, it } from 'vitest'
import { stripQuotedQuery } from '../src/utils/query'

describe('stripQuotedQuery', () => {
  it('去掉完全等于引用内容的 query', () => {
    expect(stripQuotedQuery('啊？', '啊？')).toBe('')
  })

  it('去掉引用内容作为前缀的情况', () => {
    expect(stripQuotedQuery('啊？ 示例A', '啊？')).toBe('示例A')
  })

  it('去掉引用内容作为后缀的情况', () => {
    expect(stripQuotedQuery('示例A 啊？', '啊？')).toBe('示例A')
  })

  it('用户自己输入的 query 不碰', () => {
    expect(stripQuotedQuery('示例A', '啊？')).toBe('示例A')
  })

  it('处理换行和多余空格', () => {
    expect(stripQuotedQuery('啊？\n  示例A', ' 啊？ ')).toBe('示例A')
  })

  it('没有引用时保持原样', () => {
    expect(stripQuotedQuery(' 示例A ', undefined)).toBe('示例A')
  })
})
