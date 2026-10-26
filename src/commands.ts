import { h } from 'koishi'
import type { Argv, Context, Session } from 'koishi'
import type { Config } from './config'
import { isPlatformError } from './api/errors'
import { stripQuotedQuery } from './utils/query'
import type { LoggerLike } from './store'
import { BindError, UsageService } from './service'
import {
  renderBindingList,
  renderBindingListMarkdown,
  renderOverview,
  renderOverviewMarkdown,
  renderReports,
  type RenderOptions,
} from './render'
import type { AccountOverview } from './types'
import { isAdminUser } from './permissions'
import { looksLikeApiKey, looksLikeKeySuffix, shortMask } from './utils/format'

const MAX_COOLDOWN_ENTRIES = 5000

function userKey(session: Session): string | null {
  if (!session.userId) return null
  return `${session.platform}:${session.userId}`
}

function isAdmin(session: Session, config: Config): boolean {
  const authority = (session.user as { authority?: number } | undefined)?.authority ?? 0
  return isAdminUser(session.platform, session.userId, authority, config)
}

function renderOptions(session: Session, config: Config): RenderOptions {
  return {
    platform: session.platform,
    isAdmin: isAdmin(session, config),
    showBalance: config.showBalance,
    currency: config.currency,
    timeZone: config.timeZone,
    maxKeys: config.maxKeys,
  }
}

function describeError(error: unknown): string {
  if (isPlatformError(error)) {
    switch (error.kind) {
      case 'auth':
        return '平台 Token 失效了，请管理员到插件配置里重新读取 userToken。'
      case 'config':
        return '管理员还没有配置 DeepSeek 平台 Token，暂时查不了用量。'
      case 'rate-limit':
        return '平台限流了，稍等一会儿再查。'
      case 'invalid-key':
        return '这个 API Key 无效或已被禁用。'
      case 'network':
        return `连接 DeepSeek 失败：${error.message}`
      default:
        return `查询失败：${error.message}`
    }
  }
  if (error instanceof BindError) return error.message
  const message = error instanceof Error ? error.message : String(error)
  return `查询失败：${message}`
}

const UNBOUND_MESSAGE = [
  '你还没有添加 API Key。',
  '发送「dsu.add sk-你的Key」添加（建议私聊发送，群聊里添加会留下记录）。',
].join('\n')

export function applyCommands(
  ctx: Context,
  service: UsageService,
  config: Config,
  logger: LoggerLike,
): void {
  const lastQuery = new Map<string, number>()

  const cooldownLeft = (session: Session): number => {
    if (config.cooldown <= 0 || !session.userId) return 0
    const key = userKey(session)!
    const now = Date.now()
    const last = lastQuery.get(key) ?? 0
    const left = Math.ceil((last + config.cooldown * 1000 - now) / 1000)
    if (left > 0) return left
    if (lastQuery.size > MAX_COOLDOWN_ENTRIES) lastQuery.clear()
    lastQuery.set(key, now)
    return 0
  }

  const guard = (
    handler: (session: Session, argv: Argv) => Promise<any>,
  ) => async (argv: Argv) => {
    const session = argv.session
    if (!session?.userId) return
    try {
      return await handler(session, argv)
    } catch (error) {
      if (error instanceof BindError) {
        logger.debug?.(error)
      } else {
        logger.warn?.(error)
      }
      return describeError(error)
    }
  }

  const requireAdmin = (session: Session): string | null => {
    return isAdmin(session, config) ? null : '这个指令只有管理员能用。'
  }

  const useMarkdown = (session: Session) => session.platform === 'qq' && config.qqMarkdown

  const markdownReply = (text: string) => h('qq:rawmarkdown-without-keyboard', {}, text)

  const showReports = (
    session: Session,
    reports: Parameters<typeof renderReports>[0],
    startIndex = 0,
    overview?: AccountOverview,
  ) => {
    const options = renderOptions(session, config)
    const markdown = useMarkdown(session)
    const text = renderReports(reports, options, startIndex, markdown, overview)
    return markdown ? markdownReply(text) : text
  }

  const showList = (session: Session, bindings: Parameters<typeof renderBindingList>[0]) => {
    const options = renderOptions(session, config)
    return useMarkdown(session)
      ? markdownReply(renderBindingListMarkdown(bindings, options))
      : renderBindingList(bindings, options)
  }

  const bindKey = async (session: Session, rawKey: string, usage: string, checkCooldown = true) => {
    if (!rawKey) return `用法：${usage} 25f0\n也可以发完整的 sk-... Key。`
    if (session.guildId && !config.allowGroupBind) {
      return '为了安全，请私聊机器人添加 Key。'
    }
    if (!looksLikeApiKey(rawKey) && !looksLikeKeySuffix(rawKey)) {
      return '请发 Key 尾号（至少 4 位，如 25f0）或完整的 sk-... Key。'
    }
    if (checkCooldown) {
      const left = cooldownLeft(session)
      if (left > 0) return `操作太频繁啦，${left} 秒后再试。`
    }
    const key = userKey(session)!
    const { binding, count } = await service.addBinding(rawKey, key)
    const lines = [`添加成功：${binding.name}（${shortMask(binding.sensitiveId)}）`]
    lines.push(
      count > 1
        ? `你现在绑定了 ${count} 个 Key，发送 dsu 查看全部详情。`
        : '以后直接发 dsu 就能查用量了。',
    )
    if (session.guildId) lines.push('建议撤回刚才那条包含 Key 的消息。')
    return lines.join('\n')
  }

  const main = ctx
    .command('dsu [query:text]', '查询 DeepSeek API 用量')
    .usage(
      [
        '查询自己添加的 API Key 的余额、花费和 Token 用量。',
        '第一次使用先添加：dsu.add 25f0（Key 尾号）或 dsu.add sk-你的Key，可以添加多个。',
        '也支持空格写法：dsu add 25f0，等同 dsu.add 25f0。',
        'dsu 一次列出所有已绑定 Key 的详情，dsu <序号或名字> 只看某一个。',
        '管理员发 dsu 时会额外显示账户总用量。',
        '管理员：dsu.all 看全部 Key，dsu.key <名字> 查指定 Key。',
      ].join('\n'),
    )
    .example('dsu')
    .example('dsu 示例A')
    .example('dsu.add 25f0')
    .example('dsu add 25f0')
    .example('dsu.add sk-xxxxxxxxxxxxxxxx')
    .action(
      guard(async (session, argv) => {
        const left = cooldownLeft(session)
        if (left > 0) return `查询太频繁啦，${left} 秒后再试。`
        const key = userKey(session)!
        const admin = isAdmin(session, config)
        const query = stripQuotedQuery(
          (argv.args ?? []).map((value) => String(value)).join(' '),
          session.quote?.content,
        )

        // 支持 `dsu add 25f0` 这种空格写法，等效于 dsu.add 25f0
        const spaced = /^(add|bind)\b\s*(.*)$/i.exec(query)
        if (spaced) {
          const rest = spaced[2].trim()
          if (!rest) return '用法：dsu.add 25f0（或完整 sk-... Key）'
          return bindKey(session, rest, `dsu.${spaced[1].toLowerCase()}`, false)
        }

        const bindings = await service.getBindings(key)
        if (!bindings.length) {
          if (admin) return showReports(session, [], 0, await service.overview())
          return UNBOUND_MESSAGE
        }

        if (!query) {
          const reports = await service.reportsForUser(key)
          const overview = admin ? await service.overview() : undefined
          return showReports(session, reports, 0, overview)
        }

        const matches = await service.matchBindings(key, query)
        if (!matches.length) {
          return `没有找到「${query}」对应的 Key。发送 dsu 查看你绑定的列表。`
        }
        if (matches.length > 1) {
          const names = matches.map((binding) => binding.name).join('、')
          return `「${query}」匹配到多个 Key：${names}，请写完整一点。`
        }
        const index = bindings.findIndex((binding) => binding.trackingId === matches[0].trackingId)
        const report = await service.report(matches[0])
        return showReports(session, [report], index)
      }),
    )

  for (const alias of config.aliases ?? []) {
    const name = alias?.trim()
    if (name && !name.includes(' ')) main.alias(name)
  }

  const addHandler = (usage: string) =>
    guard(async (session, argv) => {
      const rawKey = String(argv.args?.[0] ?? '').trim()
      return bindKey(session, rawKey, usage)
    })

  ctx
    .command('dsu.add <key:string>', '添加一个 DeepSeek API Key')
    .usage('可以发完整 Key，也可以只发 Key 尾号（如 25f0）；只保存脱敏信息。')
    .example('dsu.add 25f0')
    .example('dsu.add sk-xxxxxxxxxxxxxxxx')
    .action(addHandler('dsu.add'))

  // 兼容旧指令
  ctx
    .command('dsu.bind <key:string>', '添加一个 DeepSeek API Key（旧指令）')
    .usage('等同 dsu.add，也支持只发 Key 尾号。')
    .example('dsu.bind 25f0')
    .action(addHandler('dsu.add'))

  ctx
    .command('dsu.remove <query:string>', '移除自己绑定的某个 Key')
    .usage('query 可以是序号、名字、Key ID 前缀或脱敏后缀。')
    .example('dsu.remove 示例A')
    .action(
      guard(async (session, argv) => {
        const query = String(argv.args?.[0] ?? '').trim()
        if (!query) return '用法：dsu.remove <序号或名字>'
        const left = cooldownLeft(session)
        if (left > 0) return `操作太频繁啦，${left} 秒后再试。`
        const key = userKey(session)!
        const binding = await service.removeBinding(key, query)
        return `已移除：${binding.name}（${shortMask(binding.sensitiveId)}）`
      }),
    )

  ctx
    .command('dsu.list', '查看自己绑定的所有 Key')
    .action(
      guard(async (session) => {
        const key = userKey(session)!
        const bindings = await service.getBindings(key)
        if (!bindings.length) return UNBOUND_MESSAGE
        return showList(session, bindings)
      }),
    )

  ctx
    .command('dsu.unbind', '解绑自己的全部 API Key')
    .action(
      guard(async (session) => {
        const key = userKey(session)!
        const count = await service.clearBindings(key)
        return count ? `已解绑全部 ${count} 个 Key。` : '你还没有绑定 API Key。'
      }),
    )

  ctx
    .command('dsu.all', '查看所有 API Key 的用量（管理员）')
    .action(
      guard(async (session) => {
        const denied = requireAdmin(session)
        if (denied) return denied
        const left = cooldownLeft(session)
        if (left > 0) return `查询太频繁啦，${left} 秒后再试。`
        const overview = await service.overview()
        const options = renderOptions(session, config)
        return useMarkdown(session) ? markdownReply(renderOverviewMarkdown(overview, options)) : renderOverview(overview, options)
      }),
    )

  ctx
    .command('dsu.key <query:string>', '查询指定 API Key 的用量（管理员）')
    .usage('query 可以是 Key 的名字、Key ID 前缀，或者脱敏 Key 的后四位。')
    .example('dsu.key 示例A')
    .action(
      guard(async (session, argv) => {
        const denied = requireAdmin(session)
        if (denied) return denied
        const query = String(argv.args?.[0] ?? '').trim()
        if (!query) return '用法：dsu.key <名字或 Key ID>'
        const left = cooldownLeft(session)
        if (left > 0) return `查询太频繁啦，${left} 秒后再试。`
        const keys = await service.findKeys(query)
        if (keys.length === 0) return `没有找到匹配「${query}」的 Key。`
        if (keys.length > 1) {
          const names = keys.slice(0, 10).map((key) => `${key.name}（${shortMask(key.sensitiveId)}）`).join('、')
          return `匹配到多个 Key：${names}\n请写完整一点的名字。`
        }
        const report = await service.reportForKey(keys[0])
        return showReports(session, [report], 0)
      }),
    )

  ctx
    .command('dsu.refresh', '清空用量缓存（管理员）')
    .action(
      guard(async (session) => {
        const denied = requireAdmin(session)
        if (denied) return denied
        service.clearCache()
        return '缓存已清空，下次查询会重新拉取平台数据。'
      }),
    )

  ctx
    .command('dsu.whoami', '查看自己的平台 ID 和绑定状态')
    .action(
      guard(async (session) => {
        const key = userKey(session)!
        const bindings = await service.getBindings(key)
        const admin = isAdmin(session, config)
        const names = bindings.map((binding) => binding.name).join('、')
        return [
          `平台：${session.platform}`,
          `用户 ID：${session.userId}`,
          `权限等级：${(session.user as { authority?: number } | undefined)?.authority ?? 0}`,
          `管理员：${admin ? '是' : '否'}`,
          `绑定：${bindings.length ? `${bindings.length} 个（${names}）` : '未绑定'}`,
        ].join('\n')
      }),
    )
}
