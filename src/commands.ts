import { h } from 'koishi'
import type { Argv, Context, Session } from 'koishi'
import type { Config } from './config'
import { isPlatformError } from './api/errors'
import { AccountService, type StoredBinding, type UserReport } from './account-service'
import { BindError } from './service'
import { isAdminUser } from './permissions'
import {
  renderAllPage,
  renderBindingList,
  renderBindingListMarkdown,
  renderReports,
  type RenderOptions,
} from './render'
import { maskToken, scanBrowserTokens } from './token'
import { looksLikeApiKey, looksLikeKeySuffix, shortMask } from './utils/format'
import { stripQuotedQuery } from './utils/query'
import type { AccountOverview, Binding, Report } from './types'
import type { LoggerLike } from './store'

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
        return '这个账号的 Token 失效了，请发送 dsu.token 重新读取，或 dsu.add <Key尾号> <新Token> 重新绑定。'
      case 'config':
        return '还没有配置这个账号的 Token。'
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
  '你还没有绑定 API Key。',
  '先发「dsu.token」读取/设置账号 Token，再发「dsu.add 25f0」绑定 Key。',
  '也可以直接发「dsu.add 25f0 你的userToken」。',
  '建议私聊操作，群聊里发 Token 会留下记录。',
].join('\n')

function oldBinding(binding: StoredBinding): Binding {
  return {
    trackingId: binding.trackingId,
    name: binding.keyName,
    sensitiveId: binding.sensitiveId,
    boundAt: binding.boundAt,
    boundBy: binding.userId,
  }
}

export function applyCommands(
  ctx: Context,
  service: AccountService,
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

  const guard =
    (handler: (session: Session, argv: Argv) => Promise<any>) => async (argv: Argv) => {
      const session = argv.session
      if (!session?.userId) return
      try {
        return await handler(session, argv)
      } catch (error) {
        if (error instanceof BindError) logger.debug?.(error)
        else logger.warn?.(error)
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
    reports: Report[],
    startIndex = 0,
    overview?: AccountOverview,
  ) => {
    const options = renderOptions(session, config)
    const markdown = useMarkdown(session)
    const text = renderReports(reports, options, startIndex, markdown, overview)
    return markdown ? markdownReply(text) : text
  }

  const showList = (session: Session, bindings: StoredBinding[]) => {
    const options = renderOptions(session, config)
    const list = bindings.map(oldBinding)
    return useMarkdown(session)
      ? markdownReply(renderBindingListMarkdown(list, options))
      : renderBindingList(list, options)
  }

  const resolveToken = async (session: Session, explicit?: string) => {
    const token = explicit?.trim()
    if (token) return token
    const fallback = await service.defaultToken(userKey(session)!)
    return fallback?.trim() || undefined
  }

  const bindKey = async (
    session: Session,
    rawKey: string,
    explicitToken: string | undefined,
    usage: string,
    checkCooldown = true,
  ) => {
    if (!rawKey) return `用法：${usage} 25f0 [userToken]\n25f0 换成 Key 尾号，也可以发完整 sk-... Key。`
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
    const token = await resolveToken(session, explicitToken)
    if (!token) {
      return [
        '你还没有设置账号 Token。',
        '先发 dsu.token 读取本机登录态，或发 dsu.add 25f0 你的userToken。',
      ].join('\n')
    }

    const key = userKey(session)!
    const { binding, count } = await service.addBinding(key, token, rawKey)
    const lines = [`添加成功：${binding.keyName}（${shortMask(binding.sensitiveId)}）`]
    lines.push(
      count > 1
        ? `你现在绑定了 ${count} 个 Key，发送 dsu 查看全部详情。`
        : '以后直接发 dsu 就能查用量了。',
    )
    if (session.guildId) lines.push('建议撤回刚才那条包含 Token/Key 的消息。')
    return lines.join('\n')
  }

  const setToken = async (session: Session, rawToken?: string) => {
    if (session.guildId) return '为了安全，请私聊机器人设置 Token。'
    let token = rawToken?.trim()
    if (!token) {
      const scanned = await scanBrowserTokens({
        validate: async (candidate) => {
          await service.verifyToken(candidate)
          return true
        },
        logger,
      })
      if (!scanned) {
        return '没有从本机浏览器找到可用的平台 Token。请确认已登录 platform.deepseek.com，或直接把 userToken 发给我。'
      }
      token = scanned
    }
    if (!token) {
      return '没有从本机浏览器找到可用的平台 Token。'
    }
    await service.verifyToken(token)
    await service.setDefaultToken(userKey(session)!, token)
    return `账号已保存：${maskToken(token)}\n现在可以发 dsu.add 25f0 绑定这个账号下的 Key。`
  }

  const main = ctx
    .command('dsu [query:text]', '查询 DeepSeek API 用量')
    .usage(
      [
        '多账号版：每个 userToken 是一个账号，每个账号下可以绑定多个 Key。',
        '第一次使用：私聊发 dsu.token 设置账号 Token，然后 dsu.add 25f0 绑 Key。',
        '也可以直接发 dsu.add 25f0 你的userToken，一条命令绑定另一个账号。',
        '也支持空格写法：dsu add 25f0、dsu token。',
        'dsu 列出所有绑定；dsu 账号1 查某个账号；dsu <序号/名字> 查单个 Key。',
        '管理员：dsu.all [页码] 跨所有账号汇总，dsu.key <名字> 查任意 Key。',
      ].join('\n'),
    )
    .example('dsu')
    .example('dsu 账号1')
    .example('dsu.add 25f0')
    .example('dsu add 25f0')
    .example('dsu.token')
    .action(
      guard(async (session, argv) => {
        const left = cooldownLeft(session)
        if (left > 0) return `查询太频繁啦，${left} 秒后再试。`
        const key = userKey(session)!
        const query = stripQuotedQuery(
          (argv.args ?? []).map((value) => String(value)).join(' '),
          session.quote?.content,
        )

        const spaced = /^(add|bind|token)\b\s*(.*)$/i.exec(query)
        if (spaced) {
          const rest = spaced[2].trim()
          const verb = spaced[1].toLowerCase()
          if (verb === 'token') return setToken(session, rest)
          const [rawKey, token] = rest.split(/\s+/, 2)
          if (!rawKey) return `用法：dsu.${verb} 25f0 [userToken]`
          return bindKey(session, rawKey, token, `dsu.${verb}`, false)
        }

        const bindings = await service.bindings(key)
        if (!bindings.length) return UNBOUND_MESSAGE

        const labels = service.labels(bindings)
        if (!query) {
          const reports = await service.reportsForUser(key)
          return showReports(session, reports.map((item) => item.report))
        }

        const accountBinding = bindings.find((item) => labels.get(item.token) === query)
        if (accountBinding) {
          const reports = await service.accountReports(key, query)
          return showReports(session, reports.map((item) => item.report))
        }

        const matches = await service.matchBindings(key, query)
        if (!matches.length) {
          return `没有找到「${query}」对应的 Key。发送 dsu 查看你绑定的列表。`
        }
        if (matches.length > 1) {
          const names = matches.map((item) => item.keyName).join('、')
          return `「${query}」匹配到多个 Key：${names}，请写完整一点。`
        }
        const binding = matches[0]
        const label = labels.get(binding.token)
        const report = await service.report(binding, label)
        const index = bindings.findIndex((item) => item.id === binding.id)
        return showReports(session, [report], index)
      }),
    )

  for (const alias of config.aliases ?? []) {
    const name = alias?.trim()
    if (name && !name.includes(' ')) main.alias(name)
  }

  ctx
    .command('dsu.token [token:string]', '设置当前账号的 userToken')
    .usage('不填 token 时扫描 bot 所在电脑的 Edge/Chrome；也可以直接粘贴 userToken。')
    .example('dsu.token')
    .example('dsu.token 你的userToken')
    .action(
      guard(async (session, argv) => {
        return setToken(session, String(argv.args?.[0] ?? '').trim())
      }),
    )

  const addHandler = (usage: string) =>
    guard(async (session, argv) => {
      const rawKey = String(argv.args?.[0] ?? '').trim()
      const token = String(argv.args?.[1] ?? '').trim() || undefined
      return bindKey(session, rawKey, token, usage)
    })

  ctx
    .command('dsu.add <key:string> [token:string]', '添加一个 DeepSeek API Key')
    .usage('key 可以是完整 Key 或 Key 尾号；token 不填时用当前账号。')
    .example('dsu.add 25f0')
    .example('dsu.add 25f0 你的userToken')
    .action(addHandler('dsu.add'))

  ctx
    .command('dsu.bind <key:string> [token:string]', '添加一个 DeepSeek API Key（旧指令）')
    .usage('等同 dsu.add。')
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
        const binding = await service.removeBinding(userKey(session)!, query)
        return `已移除：${binding.keyName}（${shortMask(binding.sensitiveId)}）`
      }),
    )

  ctx
    .command('dsu.list', '查看自己绑定的所有 Key')
    .action(
      guard(async (session) => {
        const bindings = await service.bindings(userKey(session)!)
        if (!bindings.length) return UNBOUND_MESSAGE
        return showList(session, bindings)
      }),
    )

  ctx
    .command('dsu.unbind', '解绑全部 Key')
    .action(
      guard(async (session) => {
        const count = await service.clear(userKey(session)!)
        return count ? `已解绑全部 ${count} 个 Key。` : '你还没有绑定任何 Key。'
      }),
    )

  ctx
    .command('dsu.all [page:number]', '查看全部账号的 Key（管理员）')
    .usage('跨所有账号汇总，分页显示；页码从 1 开始。')
    .example('dsu.all')
    .example('dsu.all 2')
    .action(
      guard(async (session, argv) => {
        const denied = requireAdmin(session)
        if (denied) return denied
        const left = cooldownLeft(session)
        if (left > 0) return `查询太频繁啦，${left} 秒后再试。`
        const page = Number(argv.args?.[0] ?? 1) || 1
        const data = await service.allPage(page)
        const options = renderOptions(session, config)
        const markdown = useMarkdown(session)
        const text = renderAllPage(data, options, markdown)
        return markdown ? markdownReply(text) : text
      }),
    )

  ctx
    .command('dsu.key <query:string>', '查询指定 API Key 的用量（管理员）')
    .usage('跨所有账号按名字、Key ID 前缀或脱敏后缀查。')
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
        if (!keys.length) return `没有找到匹配「${query}」的 Key。`
        if (keys.length > 1) {
          const names = keys
            .slice(0, 10)
            .map((item) => `${item.key.name}（${shortMask(item.key.sensitiveId)}）`)
            .join('、')
          return `匹配到多个 Key：${names}\n请写完整一点的名字。`
        }
        const found = keys[0]
        const report = found.binding
          ? await service.report(found.binding, found.label)
          : await service.reportKey(found.token, found.key, found.label)
        return showReports(session, [report])
      }),
    )

  ctx
    .command('dsu.refresh', '清空查询缓存（管理员）')
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
        const bindings = await service.bindings(key)
        const accounts = new Set(bindings.map((item) => item.token)).size
        const admin = isAdmin(session, config)
        const token = await service.defaultToken(key)
        return [
          `平台：${session.platform}`,
          `用户 ID：${session.userId}`,
          `管理员：${admin ? '是' : '否'}`,
          `绑定：${bindings.length} 个 Key · ${accounts} 个账号`,
          `默认账号：${token ? maskToken(token) : '未设置'}`,
        ].join('\n')
      }),
    )
}
