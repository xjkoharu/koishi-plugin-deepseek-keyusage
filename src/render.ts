import { hitRate, inputTokens, totalTokens } from './aggregate'
import type { AccountView, AllPage } from './account-service'
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
  /** 内联指令前缀，默认 `/`；传空串则不加前缀 */
  commandPrefix?: string
}

export interface RendererSet {
  report: (report: Report, options: RenderOptions) => string
  overview: (overview: AccountOverview, options: RenderOptions) => string
}

export interface QuickButton {
  label: string
  command: string
}

/**
 * QQ 官方机器人（adapter-qq-crack）的按钮键盘：
 * 点「查看 1」等于把 `dsu 1` 填进输入框（enter=false）或直接发送（enter=true）。
 */
export function buildQQKeyboard(buttons: QuickButton[], enter = false): any {
  const rows: Array<{ buttons: any[] }> = []
  for (const item of buttons) {
    let row = rows[rows.length - 1]
    if (!row || row.buttons.length >= 5) {
      row = { buttons: [] }
      rows.push(row)
    }
    row.buttons.push({
      id: `b${rows.length}_${row.buttons.length + 1}`,
      render_data: { label: item.label, visited_label: item.label, style: 1 },
      action: {
        type: 2,
        permission: { type: 2 },
        data: item.command,
        enter,
        unsupport_tips: '请升级 QQ 后重试',
      },
    })
  }
  return { content: { rows } }
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
  lines.push('发送 dsu {序号或名字} 查看详情；dsu add {Key尾号} 可以继续添加。')
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

const MAX_ACCOUNTS = 10
const MAX_CATALOG_KEYS = 20

/** 账号级别的一行总用量：余额、累计、今日。 */
function accountBlockLines(overview: AccountOverview, options: RenderOptions, markdown: boolean): string[] {
  const bullet = (text: string) => (markdown ? `- ${text}` : `  ${text}`)
  let todayCost = 0
  let todayTokens = 0
  for (const item of overview.keys) {
    todayCost += item.today.cost
    todayTokens += totalTokens(item.today)
  }
  const summary: string[] = []
  if (options.showBalance && overview.balance) {
    const balance = overview.balance
    summary.push(
      `余额 ${formatMoney(balance.total, balance.currency)}（赠金 ${formatMoney(balance.granted, balance.currency)} / 充值 ${formatMoney(balance.toppedUp, balance.currency)}）`,
    )
  }
  summary.push(`累计花费 ${formatMoney(overview.accountCost, options.currency)}`)
  summary.push(`累计 Token ${formatInt(overview.accountTokens)}`)

  const second = [
    `今日花费 ${formatMoney(todayCost, options.currency)}`,
    `今日 Token ${formatInt(todayTokens)}`,
    `Key ${overview.keys.length} 个`,
  ]
  return [bullet(summary.join(' · ')), bullet(second.join(' · '))]
}

/**
 * QQ 官方机器人的 markdown 内联指令：点一下把 text 填进输入框（不自动发送）。
 * 默认带 `/` 前缀，走 QQ 的标准指令格式；只有 markdown 消息里能用。
 */
export function cmdInput(command: string, label: string, prefix = '/'): string {
  const text = `${prefix}${command}`
  return `<qqbot-cmd-input text="${text}" show="${label}" reference="false"/>`
}

/** 用户视角总览：每个账号先给账号总用量，再每个已绑定 Key 一行摘要。 */
export function renderUserView(views: AccountView[], options: RenderOptions, markdown = false): string {
  const link = (command: string, label: string) => cmdInput(command, label, options.commandPrefix ?? '/')
  const lines: string[] = [markdown ? '**DeepSeek API用量**' : 'DeepSeek API用量']
  if (!views.length) {
    lines.push(markdown ? `你还没有绑定账号，${link('dsu login', '快捷登录')}` : '你还没有绑定账号，发送 dsu login {备注名} 添加一个。')
    return lines.join('\n')
  }

  const shown = views.slice(0, MAX_ACCOUNTS)
  let hasBound = false
  lines.push('')
  shown.forEach((view, position) => {
    if (position > 0) lines.push('')
    lines.push(markdown ? `**账号：${escapeMarkdown(view.label)}**` : `账号：${view.label}`)
    lines.push(...accountBlockLines(view.overview, options, markdown))

    if (!view.reports.length) {
      lines.push(
        markdown
          ? `还没有绑定 Key，${link('dsu add', '快捷绑定')}`
          : '  还没有绑定 Key，发送 dsu add {Key尾号} 绑定一个。',
      )
      return
    }

    hasBound = true
    if (!markdown) lines.push('')
    for (const report of view.reports) {
      const number = report.number ?? 0
      const name = markdown ? escapeMarkdown(report.key.name) : report.key.name
      const masked = shortMask(report.key.sensitiveId) || report.key.trackingId
      const tail = `今日 ${formatMoney(report.today.cost, options.currency)} · 累计 ${formatMoney(report.total.cost, options.currency)}`
      if (markdown) {
        lines.push(`- ${number}. **${name}** \`${masked}\` · ${tail} · ${link(`dsu ${number}`, '详情')}`)
      } else {
        lines.push(`  ${number}. ${name} · ${masked} · ${tail}`)
      }
    }
    const unbound = view.overview.keys.length - view.reports.length
    if (unbound > 0) {
      lines.push(`  （账号里还有 ${unbound} 个 Key 没绑定）`)
    }
  })

  if (views.length > shown.length) {
    lines.push('')
    lines.push(`……还有 ${views.length - shown.length} 个账号未展示，发送 dsu {账号备注} 单独查看。`)
  }

  if (hasBound) {
    lines.push('')
    lines.push(
      markdown
        ? `${link('dsu keys', '全部 Key')} · ${link('dsu add', '快捷绑定')} · ${link('dsu', '刷新')}`
        : '发送 dsu {序号} 看单个 Key 的完整明细。',
    )
  }

  const updatedAt = shown.reduce((max, view) => Math.max(max, view.overview.updatedAt), 0)
  lines.push('')
  lines.push(`更新于：${formatDateTime(updatedAt || Date.now(), options.timeZone)}`)
  return lines.join('\n')
}

/** 一个账号下全部 Key（含没绑定的），用来在聊天里代替平台网页。 */
export function renderKeyCatalog(views: AccountView[], options: RenderOptions, markdown = false): string {
  const link = (command: string, label: string) => cmdInput(command, label, options.commandPrefix ?? '/')
  const lines: string[] = [markdown ? '**账号下的全部 Key**' : '账号下的全部 Key']
  if (!views.length) {
    lines.push(markdown ? `你还没有绑定账号，${link('dsu login', '快捷登录')}` : '你还没有绑定账号，发送 dsu login {备注名} 添加一个。')
    return lines.join('\n')
  }

  const shown = views.slice(0, MAX_ACCOUNTS)
  let hasUnbound = false
  let updatedAt = 0
  lines.push('')
  shown.forEach((view, position) => {
    if (position > 0) lines.push('')
    const total = view.overview.keys.length
    const bound = view.overview.keys.filter((item) => item.binding).length
    updatedAt = Math.max(updatedAt, view.overview.updatedAt)

    const head = `账号：${view.label} · ${total} 个 Key`
    if (markdown) {
      lines.push(`**${escapeMarkdown(head)}**`)
    } else {
      lines.push(total ? head : `${head}（平台没返回任何 Key）`)
    }

    const keys = view.overview.keys.slice(0, MAX_CATALOG_KEYS)
    keys.forEach((item, index) => {
      const name = markdown ? escapeMarkdown(item.key.name || item.key.trackingId) : item.key.name || item.key.trackingId
      const masked = shortMask(item.key.sensitiveId) || item.key.trackingId
      const tail = `今日 ${formatMoney(item.today.cost, options.currency)} · 累计 ${formatMoney(item.total.cost, options.currency)}`
      if (item.binding) {
        lines.push(markdown ? `- ${index + 1}. **${name}** \`${masked}\` · ${tail} · 已绑定` : `  ${index + 1}. ${name} · ${masked} · ${tail} · 已绑定`)
        return
      }
      hasUnbound = true
      if (markdown) {
        // 没有脱敏 Key 的平台 Key（例如 harness 创建的）用 tracking_id 前缀也能绑
        const suffix = masked.includes('**') ? (masked.split('**').pop() ?? '') : (item.key.trackingId || '').slice(0, 8)
        lines.push(
          `- ${index + 1}. **${name}** \`${masked}\` · ${tail} · ${link(`dsu add ${suffix}`, '绑定')}`,
        )
      } else {
        lines.push(`  ${index + 1}. ${name} · ${masked} · ${tail}`)
      }
    })
    if (total > keys.length) {
      lines.push(`  ……还有 ${total - keys.length} 个 Key 未展示`)
    }
  })

  if (views.length > shown.length) {
    lines.push('')
    lines.push(`……还有 ${views.length - shown.length} 个账号未展示，发送 dsu keys {账号备注} 单独查看。`)
  }

  if (hasUnbound) {
    lines.push('')
    lines.push(
      markdown
        ? `没绑定的 Key 点「绑定」就行，或者 ${link('dsu add', '快捷绑定')}。`
        : '没绑定的 Key 用 dsu add {Key尾号} 绑定，之后就能在 dsu 里看明细。',
    )
  }

  lines.push('')
  lines.push(`更新于：${formatDateTime(updatedAt || Date.now(), options.timeZone)}`)
  return lines.join('\n')
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
  lines.push('发送 `dsu {序号或名字}` 查看详情，`dsu.add sk-...` 继续添加。')
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
