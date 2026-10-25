/** 本地日期时间文本，用于「数据更新于」。 */
export function formatDateTime(ms: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(ms))
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    let hour = pick('hour')
    if (hour === '24') hour = '00'
    return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}`
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
  }
}
