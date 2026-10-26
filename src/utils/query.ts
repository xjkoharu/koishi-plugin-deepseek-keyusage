function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 去掉命令参数里混入的引用内容。
 * QQ 引用消息时，适配器有可能把被引用的文本也塞进 args；
 * 例如引用「啊？」再发 `dsu`，query 会变成「啊？」。
 */
export function stripQuotedQuery(query: string, quoted?: string | null): string {
  const text = normalize(query)
  const quote = normalize(quoted)
  if (!text || !quote) return text
  if (text === quote) return ''
  if (text.startsWith(quote)) return text.slice(quote.length).trim()
  if (text.endsWith(quote)) return text.slice(0, -quote.length).trim()
  return text
}
