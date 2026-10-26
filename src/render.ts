import { hitRate, inputTokens, totalTokens } from './aggregate'
import type { AllPage } from './account-service'
import type { AccountOverview, Binding, Report, Stat } from './types'
import { formatCompact, formatInt, formatMoney, formatPercent, shortMask } from './utils/format'
import { formatDateTime } from './utils/datetime'
import { DAY_SECONDS, formatDayLabel, tzOffsetSeconds } from './utils/time'

export interface RenderOptions {
  platform: string
  isAdmin: boolean
  showBalance: boolean
  currency: string
  timeZone: string
  maxKeys: number
}

export interface RendererSet {
  report: (report: Report, options: RenderOptions) => string
  overview: (overview: AccountOverview, options: RenderOptions) => string
}

const registry = new Map<string, Partial<RendererSet>>()

/**
 * 注册某个平台专用的渲染器。
 * 适配新平台（Telegram、Discord……）时只需要在插件外部调用它，
 * 没有注册的平台会自动使用默认纯文本渲染。
 */
export function registerRenderer(platform: string, renderer: Partial<RendererSet>): void {
  registry.set(platform, { ...registry.get(platform), ...renderer })
}

export function resolveRenderer(platform: string): RendererSet {
  const custom = registry.get(platform)
  return {
    report: custom?.report ?? renderReportDefault,
    overview: custom?.overview ?? renderOverviewDefault,
  }
}

export function renderReport(report: Report, options: RenderOptions): string {
  return resolveRenderer(options.platform).report(report, options)
}

export function renderOverview(overview: AccountOverview, options: RenderOptions): string {
  return resolveRenderer(options.platform).overview(overview, options)
}

/** 一个用户绑定了多个 Key 时的列表。 */
export function renderBindingList(bindings: Binding[], options: RenderOptions): string {
  const lines = [`你绑定了 ${bindings.length} 个 Key：`]
  bindings.forEach((binding, index) => {
    lines.push(`${index + 1}. ${binding.name}（${shortMask(binding.sensitiveId)}）`)
  })
  lines.push('')
  lines.push('发送 dsu <序号或名字> 查看详情；dsu.add sk-... 可以继续添加。')
  return lines.join('\n')
}

function escapeMarkdown(text: string): string {
  return text.replace(/([*_`\\[\]()#+.!>|])/g, '\\$1')
}

const FIELD_INDENT = '  '
const DETAIL_INDENT = '    '

function reportBlock(report: Report, index: number, options: RenderOptions, markdown: boolean): string[] {
  const tzOffset = tzOffsetSeconds(new Date(report.updatedAt), options.timeZone)
  const startLabel = formatDayLabel(report.range.start, tzOffset)
  const masked = shortMask(report.key.sensitiveId) || report.key.trackingId
  const name = markdown ? escapeMarkdown(report.key.name) : report.key.name
  const lines: string[] = []
  const field = (text: string) => (markdown ? `  - ${text}` : `${FIELD_INDENT}${text}`)
  const detail = (text: string) => (markdown ? `    - ${text}` : `${DETAIL_INDENT}${text}`)

  if (markdown) {
    lines.push(`- **API-${index}**：\`${masked}\``)
  } else {
    lines.push(`API-${index}：${masked}`)
  }
  if (report.accountLabel) lines.push(field(`账号：${report.accountLabel}`))
  lines.push(field(`名称：${name}`))

  if (options.showBalance && report.balance) {
    const balance = report.balance
    lines.push(
      field(
        `余额 ${formatMoney(balance.total, balance.currency)}（赠金 ${formatMoney(balance.granted, balance.currency)} / 充值 ${formatMoney(balance.toppedUp, balance.currency)}）`,
      ),
    )
  }

  const block = (label: string, stat: Stat) => {
    lines.push(field(`${label}花费 ${formatMoney(stat.cost, options.currency)} · Token ${formatInt(totalTokens(stat))}`))
    lines.push(
      detail(`输入 ${formatInt(inputTokens(stat))}（命中 ${formatInt(stat.cacheHit)} / 未命中 ${formatInt(stat.cacheMiss)}）`),
    )
    lines.push(
      detail(`输出 ${formatInt(stat.output)} · 请求 ${formatInt(stat.requests)} 次 · 命中率 ${formatPercent(hitRate(stat))}`),
    )
  }

  block('累计', report.total)
  block('今日', report.today)
  lines.push(field(`统计起始日期：${startLabel}`))
  return lines
}

function accountSummaryLines(overview: AccountOverview, options: RenderOptions, markdown: boolean): string[] {
  let todayCost = 0
  let todayTokens = 0
  for (const item of overview.keys) {
    todayCost += item.today.cost
    todayTokens += totalTokens(item.today)
  }

  const first: string[] = []
  if (options.showBalance && overview.balance) {
    first.push(`余额 ${formatMoney(overview.balance.total, overview.balance.currency)}`)
  }
  first.push(`累计花费 ${formatMoney(overview.accountCost, options.currency)}`)
  first.push(`累计 Token ${formatInt(overview.accountTokens)}`)

  const second = [
    `今日花费 ${formatMoney(todayCost, options.currency)}`,
    `今日 Token ${formatInt(todayTokens)}`,
    `Key ${overview.keys.length} 个`,
  ]

  if (markdown) {
    return ['**账户总用量**', `- ${first.join(' · ')}`, `- ${second.join(' · ')}`]
  }
  return ['账户总用量：', `  ${first.join(' · ')}`, `  ${second.join(' · ')}`]
}

/**
 * 一个或多个 Key 的完整报告。
 * startIndex 是这批报告在用户绑定列表里的起始下标（用于 API-1 / API-2 编号）。
 * overview 传入时会在最上面额外显示账户总用量（管理员 dsu 使用）。
 */
export function renderReports(
  reports: Report[],
  options: RenderOptions,
  startIndex = 0,
  markdown = false,
  overview?: AccountOverview,
): string {
  const lines: string[] = []
  if (overview) {
    lines.push(...accountSummaryLines(overview, options, markdown))
    lines.push('')
  }
  lines.push(markdown ? '**DeepSeek API用量**' : 'DeepSeek API用量：')
  if (!reports.length) {
    lines.push('你还没有添加 API Key。')
  }
  reports.forEach((report, index) => {
    if (index > 0) lines.push('')
    lines.push(...reportBlock(report, startIndex + index + 1, options, markdown))
  })
  const updatedAt = reports[0]?.updatedAt ?? overview?.updatedAt ?? Date.now()
  lines.push('')
  lines.push(`更新于：${formatDateTime(updatedAt, options.timeZone)}`)
  return lines.join('\n')
}

/** QQ 官方机器人（adapter-qq-crack）支持的原生 Markdown 版本。 */
export function renderReportMarkdown(report: Report, options: RenderOptions): string {
  return renderReports([report], options, 0, true)
}

export function renderOverviewMarkdown(overview: AccountOverview, options: RenderOptions): string {
  const lines = ['# DeepSeek 账户总览']
  const parts: string[] = []
  if (options.showBalance && overview.balance) {
    parts.push(`**余额** ${formatMoney(overview.balance.total, overview.balance.currency)}`)
  }
  parts.push(`**累计花费** ${formatMoney(overview.accountCost, options.currency)}`)
  parts.push(`**累计 Token** ${formatInt(overview.accountTokens)}`)
  lines.push(parts.join(' · '))

  let todayCost = 0
  for (const item of overview.keys) todayCost += item.today.cost
  lines.push(`Key ${overview.keys.length} 个 · 今日花费 ${formatMoney(todayCost, options.currency)}`)
  lines.push('')

  const shown = overview.keys.slice(0, Math.max(1, options.maxKeys))
  shown.forEach((item, index) => {
    const name = escapeMarkdown(item.key.name || item.key.trackingId)
    lines.push(`${index + 1}. **${name}** \`${shortMask(item.key.sensitiveId) || item.key.trackingId}\``)
    lines.push(
      `   - 今日 ${formatMoney(item.today.cost, options.currency)} / ${formatCompact(totalTokens(item.today))} tok`,
    )
    lines.push(
      `   - 累计 ${formatMoney(item.total.cost, options.currency)} / ${formatCompact(totalTokens(item.total))} tok · 命中 ${formatPercent(hitRate(item.total))}`,
    )
    if (item.binding) lines.push('   - 已绑定')
  })
  if (overview.keys.length > shown.length) {
    lines.push(`……还有 ${overview.keys.length - shown.length} 个 Key 未展示`)
  }
  lines.push('')
  lines.push(`更新于 ${formatDateTime(overview.updatedAt, options.timeZone)}`)
  return lines.join('\n')
}

export function renderBindingListMarkdown(bindings: Binding[], options: RenderOptions): string {
  const lines = ['# 我绑定的 Key', `共 ${bindings.length} 个：`]
  bindings.forEach((binding, index) => {
    lines.push(`${index + 1}. **${escapeMarkdown(binding.name)}** \`${shortMask(binding.sensitiveId)}\``)
  })
  lines.push('')
  lines.push('发送 `dsu <序号或名字>` 查看详情，`dsu.add sk-...` 继续添加。')
  return lines.join('\n')
}

/** 默认纯文本渲染，所有适配器都能用。 */
export function renderReportDefault(report: Report, options: RenderOptions): string {
  return renderReports([report], options, 0, false)
}

/** 管理员总览：一眼看完所有 Key。 */
export function renderOverviewDefault(overview: AccountOverview, options: RenderOptions): string {
  const lines: string[] = ['DeepSeek 账户总览']
  const parts: string[] = []
  if (options.showBalance && overview.balance) {
    parts.push(`余额 ${formatMoney(overview.balance.total, overview.balance.currency)}`)
  }
  parts.push(`累计花费 ${formatMoney(overview.accountCost, options.currency)}`)
  parts.push(`累计 Token ${formatInt(overview.accountTokens)}`)
  lines.push(parts.join(' · '))

  let todayCost = 0
  for (const item of overview.keys) todayCost += item.today.cost
  lines.push(`Key ${overview.keys.length} 个 · 今日花费 ${formatMoney(todayCost, options.currency)}`)
  lines.push('')

  const shown = overview.keys.slice(0, Math.max(1, options.maxKeys))
  shown.forEach((item, index) => {
    const tags: string[] = []
    if (item.binding) tags.push('已绑定')
    const name = item.key.name || item.key.trackingId
    lines.push(
      `${index + 1}. ${name} ${shortMask(item.key.sensitiveId) || item.key.trackingId}` +
        `｜今日 ${formatMoney(item.today.cost, options.currency)} / ${formatCompact(totalTokens(item.today))} tok` +
        `｜累计 ${formatMoney(item.total.cost, options.currency)} / ${formatCompact(totalTokens(item.total))} tok` +
        `｜命中 ${formatPercent(hitRate(item.total))}` +
        (tags.length ? `（${tags.join('，')}）` : ''),
    )
  })
  if (overview.keys.length > shown.length) {
    lines.push(`……还有 ${overview.keys.length - shown.length} 个 Key 未展示`)
  }
  lines.push('')
  lines.push(`更新于 ${formatDateTime(overview.updatedAt, options.timeZone)}`)
  return lines.join('\n')
}

// 预留适配器扩展位：QQ 官方机器人与 OneBot 目前都用纯文本即可。
// 以后如果 QQ 开放了 markdown 模板，可以在这里覆盖 qq 的渲染。
registerRenderer('qq', {})
registerRenderer('qqguild', {})
registerRenderer('onebot', {})

/** 管理员 dsu.all 的跨账号分页视图。 */
export function renderAllPage(data: AllPage, options: RenderOptions, markdown = false): string {
  const lines: string[] = []
  lines.push(markdown ? '**DeepSeek 账户总览（全部）**' : 'DeepSeek 账户总览（全部）：')
  lines.push(
    `账号 ${data.accounts} 个 · Key ${data.keys} 个 · 第 ${data.page}/${data.pages} 页`,
  )
  lines.push(
    `余额合计 ${formatMoney(data.balance, options.currency)} · 累计花费 ${formatMoney(data.totalCost, options.currency)} · 累计 Token ${formatCompact(data.tokens)}`,
  )
  lines.push('')

  data.entries.forEach((entry, index) => {
    const name = markdown ? escapeMarkdown(entry.key.name) : entry.key.name
    const masked = shortMask(entry.key.sensitiveId) || entry.key.trackingId
    const prefix = `${(data.page - 1) * data.pageSize + index + 1}. ${entry.label} / ${name} ${masked}`
    lines.push(markdown ? `- ${prefix}${entry.binding ? '（已绑定）' : ''}` : prefix + (entry.binding ? '（已绑定）' : ''))
    lines.push(
      `   今日 ${formatMoney(entry.today.cost, options.currency)} / ${formatCompact(totalTokens(entry.today))} tok` +
        ` · 累计 ${formatMoney(entry.total.cost, options.currency)} / ${formatCompact(totalTokens(entry.total))} tok` +
        ` · 命中 ${formatPercent(hitRate(entry.total))}`,
    )
  })

  if (data.pages > 1) {
    lines.push('')
    const next = data.page < data.pages ? data.page + 1 : data.pages
    lines.push(`发送 dsu.all ${next} 查看${data.page < data.pages ? '下一页' : '最后一页'}。`)
  }
  lines.push('')
  lines.push(`更新于 ${formatDateTime(data.updatedAt, options.timeZone)}`)
  return lines.join('\n')
}
