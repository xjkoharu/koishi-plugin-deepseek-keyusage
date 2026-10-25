export const DAY_SECONDS = 86400

/**
 * 计算某时刻在指定时区相对 UTC 的偏移秒数（东八区为 28800）。
 * 用 Intl 解析而不是写死，方便配置其他时区。
 */
export function tzOffsetSeconds(date: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = formatter.formatToParts(date)
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value)
    let hour = pick('hour')
    if (hour === 24) hour = 0
    const asUTC = Date.UTC(pick('year'), pick('month') - 1, pick('day'), hour, pick('minute'), pick('second'))
    const aligned = date.getTime() - date.getMilliseconds()
    return Math.round((asUTC - aligned) / 1000)
  } catch {
    // 无效时区时退化为服务器本地时区
    return -date.getTimezoneOffset() * 60
  }
}

/** 把秒级时间戳换算为「本地日序号」，用于判断桶属于哪一天。 */
export function localDayIndex(timeSeconds: number, tzOffsetSec: number): number {
  return Math.floor((timeSeconds + tzOffsetSec) / DAY_SECONDS)
}

/** 本地当天 00:00 的秒级时间戳。 */
export function startOfLocalDay(nowSeconds: number, tzOffsetSec: number): number {
  return localDayIndex(nowSeconds, tzOffsetSec) * DAY_SECONDS - tzOffsetSec
}

/** 本地日期字符串 YYYY-MM-DD。 */
export function formatDayLabel(timeSeconds: number, tzOffsetSec: number): string {
  return new Date((timeSeconds + tzOffsetSec) * 1000).toISOString().slice(0, 10)
}
