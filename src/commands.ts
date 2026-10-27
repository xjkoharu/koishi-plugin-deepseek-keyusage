import { h } from 'koishi'
import type { Argv, Context, Session } from 'koishi'
import type { Config } from './config'
import { isPlatformError } from './api/errors'
import { AccountService, type AccountView, type StoredBinding } from './account-service'
import { BindError } from './service'
import { isAdminUser } from './permissions'
import {
  buildQQKeyboard,
  flattenText,
  renderAllPage,
  renderBindingList,
  renderBindingListMarkdown,
  renderKeyCatalog,
  renderReports,
  renderUserView,
  type RenderOptions,
} from './render'
import { maskToken, scanBrowserTokens } from './token'
import { looksLikeApiKey, looksLikeKeySuffix, scrubSecrets, shortMask } from './utils/format'
import { stripQuotedQuery } from './utils/query'
import type { AccountOverview, Binding, Report } from './types'
import type { LoggerLike } from './store'

const MAX_COOLDOWN_ENTRIES = 5000

function userKey(session: Session): string | null {
  if (!session.userId) return null
  return `${session.platform}:${session.userId}`
}

/** userToken 是登录态串，长度远大于备注名，用它区分「第二个参数是 Token 还是备注」。 */
function looksLikeUserToken(value: string): boolean {
  return /^[A-Za-z0-9+/=_-]{32,}$/.test(value.trim())
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
    commandPrefix: config.commandPrefix ?? '/',
  }
}

function describeError(error: unknown): string {
  if (isPlatformError(error)) {
    switch (error.kind) {
      case 'auth':
        return '这个账号的 Token 失效了，发 dsu login {备注名} 重新绑定。'
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

const NO_ACCOUNT_MESSAGE = [
  '你还没有绑定账号。',
  'dsu login {备注名} · 读 bot 本机浏览器',
  'dsu login {userToken} {备注名} · 或直接粘贴 userToken',
].join('\n')

const HELP_TEXT = [
  'DeepSeek 用量查询',
  '',
  'dsu · 账号总览 + 已绑定 Key 列表',
  'dsu {序号/名字} · 单个 Key 的完整明细（例：dsu 1）',
  'dsu {账号备注} · 只看一个账号',
  '',
  'dsu login {备注名} · 读 bot 本机浏览器，绑定 / 切换账号',
  'dsu login {userToken} {备注名} · 直接粘贴 userToken',
  'dsu logout {账号备注} · 退出账号，不带参数就退当前账号',
  'dsu add {Key尾号} {备注名} · 绑定 Key；也可以发 Key 名字或 ID，{备注名} 只在新建账号时需要',
  'dsu unbind {序号/名字} · 解绑一个 Key，不带参数解绑全部（账号保留）',
  'dsu keys {账号备注} · 列出账号下的全部 Key（含没绑定的）',
  'dsu account list · 账号备注列表',
  'dsu account rename {旧} {新} · 改账号备注',
  '',
  '只发 dsu add / dsu login 时，机器人会接着问你要 Key 或 userToken。',
  '管理员：dsu all {页码}、dsu key {名字}、dsu refresh',
  '诊断：dsu whoami',
].join('\n')

function bindUsage(command: string): string {
  return [
    `用法：${command} {Key尾号} {备注名}`,
    `　　　${command} {Key尾号} {userToken} {备注名}`,
    `{Key尾号} 可以换成完整 Key、Key 名字或它的 ID 前缀；{备注名} 只在新建账号时需要，已有账号可以省略。`,
  ].join('\n')
}

const LOGIN_USAGE = [
  '用法：dsu login {备注名}',
  '　　　dsu login {userToken} {备注名}',
  '只发备注名时，从 bot 所在电脑的 Edge / Chrome 读取 platform.deepseek.com 的登录态；{备注名} 只在新建账号时需要。',
].join('\n')

interface BindArgs {
  rawKey: string
  token?: string
  name?: string
}

/**
 * 参数里任何位置出现「像 userToken 的长串」都当 Token，剩下的拼成备注名。
 * 所以 dsu login 主号 <token> 和 dsu login <token> 主号 都成立，
 * 也不会再把 token 当成备注名存进数据库、然后被原样打印到群里。
 */
function pickToken(parts: string[]): { token?: string; rest: string[] } {
  const index = parts.findIndex((part) => looksLikeUserToken(part))
  if (index < 0) return { rest: parts }
  return { token: parts[index], rest: parts.filter((_, i) => i !== index) }
}

/** dsu add 的 Key 尾号 / 备注名 / userToken，三个参数顺序随意。 */
function splitBindArgs(values: Array<string | undefined>): BindArgs {
  const parts = values.map((value) => String(value ?? '').trim()).filter(Boolean)
  const [rawKey = '', ...rest] = parts
  const picked = pickToken(rest)
  const name = picked.rest.join(' ').trim()
  return { rawKey, token: picked.token, name: name || undefined }
}

/** dsu login 的备注名 / userToken，两个参数顺序随意。 */
function splitTokenArgs(values: Array<string | undefined>): { token?: string; name?: string } {
  const parts = values.map((value) => String(value ?? '').trim()).filter(Boolean)
  const picked = pickToken(parts)
  const name = picked.rest.join(' ').trim()
  return { token: picked.token, name: name || undefined }
}

function oldBinding(binding: StoredBinding): Binding {  return {
    trackingId: binding.trackingId,
    name: binding.keyName,
    sensitiveId: binding.sensitiveId,
    boundAt: binding.boundAt,
    boundBy: binding.userId,
  }
}

/** 按空格拆参数，支持 `"带空格的名字"` 这种写法。 */
function splitArgs(text: string): string[] {
  const parts: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return parts.filter(Boolean)
}

export function applyCommands(
  ctx: Context,
  service: AccountService,
  config: Config,
  logger: LoggerLike,
): void {
  const lastQuery = new Map<string, number>()

  /** 只发 `dsu add` / `dsu login` 时，记住用户接下来要补参数。 */
  const pending = new Map<string, { kind: 'add' | 'login'; at: number }>()
  const PENDING_TTL = 2 * 60 * 1000

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

  /** 只有真正去平台查数据的指令才吃冷却，login / add / unbind / list 这些不受影响。 */
  const queryBlocked = (session: Session): string | null => {
    const left = cooldownLeft(session)
    return left > 0 ? `查询太频繁啦，${left} 秒后再试。` : null
  }

  const requireAdmin = (session: Session): string | null => {
    return isAdmin(session, config) ? null : '这个指令只有管理员能用。'
  }

  const useMarkdown = (session: Session) => session.platform === 'qq' && config.qqMarkdown
  const markdownReply = (text: string) => h('qq:rawmarkdown-without-keyboard', {}, text)

  const isElement = (value: unknown): value is h =>
    !!value && typeof value === 'object' && typeof (value as any).type === 'string'

  /**
   * 群聊回复统一处理：引用原消息 + @ 调用者。
   * QQ 的 markdown 消息里 @ 要用 `<qqbot-at-user>`，纯文本用 at 元素。
   */
  const finalize = (session: Session, content: any) => {
    if (content === undefined || content === null || content === '') return content
    if (!session.guildId) return content

    const parts: any[] = []
    if (config.replyQuote && session.messageId) parts.push(h('quote', { id: session.messageId }))

    let body: any = content
    if (config.replyAt && session.userId) {
      if (isElement(body) && body.type.startsWith('qq:rawmarkdown')) {
        const attrs = (body.attrs ?? {}) as Record<string, any>
        const text = typeof attrs.content === 'string' ? attrs.content : flattenText(body)
        body = h(body.type, { ...attrs, content: `<qqbot-at-user id="${session.userId}"/> ${text}` })
      } else if (typeof body === 'string') {
        body = [h.at(session.userId), ' ', body]
      } else {
        body = [h.at(session.userId), ' ', ...(Array.isArray(body) ? body : [body])]
      }
    }

    return parts.length ? [...parts, ...(Array.isArray(body) ? body : [body])] : body
  }

  const guard =
    (handler: (session: Session, argv: Argv) => Promise<any>) => async (argv: Argv) => {
      const session = argv.session
      if (!session?.userId) return
      try {
        return finalize(session, await handler(session, argv))
      } catch (error) {
        if (error instanceof BindError) logger.debug?.(error)
        else logger.warn?.(error)
        return finalize(session, describeError(error))
      }
    }

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

  const showUserView = (session: Session, views: AccountView[]) => {
    const options = renderOptions(session, config)
    const markdown = useMarkdown(session)
    const text = renderUserView(views, options, markdown)
    if (!markdown) return text

    const keyboard = userKeyboard(views)
    if (!keyboard) return markdownReply(text)
    return h('qq:rawmarkdown', { content: text, keyboard })
  }

  /** 「查看 1 / 查看 2」按钮：点一下把 dsu 1 填进输入框。 */
  const userKeyboard = (views: AccountView[]) => {
    if (!config.qqKeyboard) return null
    const entries = views
      .flatMap((view) => view.reports)
      .filter((report) => typeof report.number === 'number' && report.number > 0)
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    if (!entries.length || entries.length > 20) return null
    const buttons = entries.map((report) => ({
      label: `查看 ${report.number}`,
      command: `dsu ${report.number}`,
    }))
    buttons.push({ label: '全部 Key', command: 'dsu keys' }, { label: '刷新', command: 'dsu' })
    return buildQQKeyboard(buttons, config.qqButtonEnter)
  }

  const showKeyCatalog = (session: Session, views: AccountView[]) => {
    const options = renderOptions(session, config)
    const markdown = useMarkdown(session)
    const text = renderKeyCatalog(views, options, markdown)
    return markdown ? markdownReply(text) : text
  }

  /** 列出账号下的全部 Key（包括没绑定的），代替去平台网页翻。 */
  const keysCommand = async (session: Session, query?: string) => {
    const key = userKey(session)!
    const accounts = await service.userAccountList(key)
    if (!accounts.length) return NO_ACCOUNT_MESSAGE

    const label = query?.trim().toLowerCase()
    const target = label
      ? accounts.filter((item) => item.label.toLowerCase() === label)
      : accounts
    if (!target.length) {
      return `没有找到账号「${scrubSecrets(query!)}」。发送 dsu account list 查看账号备注。`
    }

    const blocked = queryBlocked(session)
    if (blocked) return blocked
    const views = await Promise.all(
      target.map((account) => service.accountView(key, account.token, account.label)),
    )
    return showKeyCatalog(session, views)
  }

  /** 给已绑定的 Key 打上全局序号，和 dsu {序号} 对得上。 */
  const numberReports = async (key: string, views: AccountView[]) => {
    const bindings = await service.bindings(key)
    const order = new Map(bindings.map((item, index) => [item.trackingId, index + 1]))
    for (const view of views) {
      for (const report of view.reports) report.number = order.get(report.key.trackingId)
    }
    return views
  }

  const showList = (session: Session, bindings: StoredBinding[]) => {
    const options = renderOptions(session, config)
    const list = bindings.map(oldBinding)
    return useMarkdown(session)
      ? markdownReply(renderBindingListMarkdown(list, options))
      : renderBindingList(list, options)
  }

  /** 群聊里发过 Token / 完整 Key 时，尽量把那条消息撤掉。 */
  const recallSecret = async (session: Session): Promise<string | null> => {
    if (!config.autoRecallInGroup || !session.guildId) return null
    try {
      const bot = session.bot as unknown as {
        deleteMessage?: (channelId: string, messageId: string) => Promise<unknown>
      }
      if (typeof bot?.deleteMessage !== 'function') return null
      await bot.deleteMessage(session.channelId!, session.messageId!)
      return '已撤回刚才那条包含 Token / Key 的消息。'
    } catch (error) {
      logger.debug?.(`撤回消息失败：${(error as Error).message}`)
      return '建议手动撤回刚才那条包含 Token / Key 的消息。'
    }
  }

  const resolveToken = async (session: Session, args: BindArgs) => {
    if (args.token?.trim()) return args.token.trim()
    const named = await service.accountTokenByName(userKey(session)!, args.name)
    if (named) return named
    const fallback = await service.defaultToken(userKey(session)!)
    return fallback?.trim() || undefined
  }

  const bindKey = async (session: Session, args: BindArgs, command: string) => {
    const rawKey = args.rawKey
    if (!rawKey) {
      pending.set(userKey(session)!, { kind: 'add', at: Date.now() })
      return [
        '要绑哪个 Key？发 Key 后四位、完整 Key、Key 名字，或者它在平台上的 ID 都行。',
        bindUsage(command),
      ].join('\n')
    }
    if (session.guildId && !config.allowGroupBind) {
      return '管理员关闭了群聊绑定，请私聊机器人添加 Key。'
    }
    if (rawKey.length < 2) {
      return '说具体一点：Key 后四位、完整 Key、Key 名字或它的 ID 前缀。\n' + bindUsage(command)
    }
    const token = await resolveToken(session, args)
    if (!token) {
      return [
        '你还没有设置账号 Token。',
        '先发 dsu login {备注名} 读取本机登录态，或者 dsu login {userToken} {备注名} 直接粘贴。',
      ].join('\n')
    }

    const key = userKey(session)!
    const { binding, count } = await service.addBinding(key, token, rawKey, args.name)
    const lines = [`添加成功：${binding.keyName}（${shortMask(binding.sensitiveId)}）`]
    if (count > 1) lines.push(`已绑定 ${count} 个 Key。`)
    const recalled = await recallSecret(session)
    if (recalled) lines.push(recalled)
    else if (session.guildId) lines.push('建议撤回刚才那条包含 Token / Key 的消息。')
    return lines.join('\n')
  }

  const setToken = async (session: Session, args: { token?: string; name?: string }) => {
    const token = args.token?.trim()
    const name = args.name?.trim()
    if (!token) {
      let scanned: string | null = null
      try {
        scanned = await scanBrowserTokens({
          validate: async (candidate) => {
            await service.verifyToken(candidate)
            return true
          },
          logger,
        })
      } catch (error) {
        // 浏览器扫到了 Token，但校验时连不上平台：别让用户以为 Token 过期了
        pending.set(userKey(session)!, { kind: 'login', at: Date.now() })
        return [
          `读取本机 Token 失败：${(error as Error).message}`,
          '可以直接把 userToken 发过来，我接着绑定（后面可以再跟一个备注名）。',
        ].join('\n')
      }
      if (!scanned) {
        pending.set(userKey(session)!, { kind: 'login', at: Date.now() })
        return [
          '没有从本机浏览器找到可用的平台 Token。',
          '把 userToken 直接发过来，我接着绑定（后面可以再跟一个备注名）。',
        ].join('\n')
      }
      await service.verifyToken(scanned)
      await service.setDefaultToken(userKey(session)!, scanned, name)
      const recalled = await recallSecret(session)
      const label = name ? `（${scrubSecrets(name)}）` : ''
      return [
        `账号已保存：${maskToken(scanned)}${label}`,
        '发 dsu 看账号总用量，dsu add 绑 Key。',
        recalled,
      ]
        .filter(Boolean)
        .join('\n')
    }

    await service.verifyToken(token)
    await service.setDefaultToken(userKey(session)!, token, name)
    const recalled = await recallSecret(session)
    const label = name ? `（${scrubSecrets(name)}）` : ''
    return [
      `账号已保存：${maskToken(token)}${label}`,
      '发 dsu 看账号总用量，dsu add 绑 Key。',
      recalled,
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** 只解绑 Key：账号保留，还能继续看账号总用量。 */
  const unbindAll = async (session: Session) => {
    const count = await service.clearBindings(userKey(session)!)
    return count ? `已解绑全部 ${count} 个 Key（账号还在）。` : '你还没有绑定任何 Key。'
  }

  const removeKey = async (session: Session, query: string, viaUnbind = false) => {
    const binding = await service.removeBinding(userKey(session)!, query)
    const lines = [`已移除：${binding.keyName}（${shortMask(binding.sensitiveId)}）`]
    if (viaUnbind) lines.push('退出账号用 dsu logout。')
    return lines.join('\n')
  }

  const logoutCommand = async (session: Session, query?: string) => {
    const { account, keys, next } = await service.logoutAccount(userKey(session)!, query)
    const lines = [`已退出账号：${account.name}（${maskToken(account.token)}）`]
    lines.push(keys ? `同时移除了这个账号下你绑定的 ${keys} 个 Key。` : '这个账号下没有绑定 Key。')
    if (next) lines.push(`默认账号已切换到：${next.name}`)
    return lines.join('\n')
  }

  const listKeys = async (session: Session) => {
    const bindings = await service.bindings(userKey(session)!)
    if (!bindings.length) return '你还没有绑定 Key。发送 dsu add {Key尾号} {备注名} 绑定一个。'
    return showList(session, bindings)
  }

  const accountCommand = async (session: Session, args: string[]) => {
    const action = String(args[0] ?? '').trim().toLowerCase()
    const key = userKey(session)!
    if (action === 'list') {
      const accounts = await service.accounts(key)
      if (!accounts.length) return '你还没有添加账号。先发 dsu login {备注名}。'
      const bindings = await service.bindings(key)
      const lines = ['账号列表：']
      for (const account of accounts) {
        const count = bindings.filter((item) => item.token === account.token).length
        lines.push(`- ${account.name}：${maskToken(account.token)} · ${count} 个 Key`)
      }
      return lines.join('\n')
    }
    if (action === 'rename') {
      const query = String(args[1] ?? '').trim()
      const name = String(args[2] ?? '').trim()
      if (!query || !name) return '用法：dsu account rename {账号/备注} {新备注}'
      const account = await service.renameAccount(key, query, name)
      return `账号备注已改为：${account.name}`
    }
    return '用法：dsu account list 或 dsu account rename {账号/备注} {新备注}'
  }

  const allCommand = async (session: Session, pageArg?: string) => {
    const denied = requireAdmin(session)
    if (denied) return denied
    const left = cooldownLeft(session)
    if (left > 0) return `查询太频繁啦，${left} 秒后再试。`
    const page = Number(pageArg ?? 1) || 1
    const data = await service.allPage(page)
    const options = renderOptions(session, config)
    const markdown = useMarkdown(session)
    const text = renderAllPage(data, options, markdown)
    return markdown ? markdownReply(text) : text
  }

  const keyCommand = async (session: Session, query: string) => {
    const denied = requireAdmin(session)
    if (denied) return denied
    if (!query) return '用法：dsu.key {名字或 Key ID}'
    const left = cooldownLeft(session)
    if (left > 0) return `查询太频繁啦，${left} 秒后再试。`
    const keys = await service.findKeys(query)
    if (!keys.length) return `没有找到匹配「${scrubSecrets(query)}」的 Key。`
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
  }

  const refreshCache = async (session: Session) => {
    const denied = requireAdmin(session)
    if (denied) return denied
    service.clearCache()
    return '缓存已清空，下次查询会重新拉取平台数据。'
  }

  const whoamiCommand = async (session: Session) => {
    const key = userKey(session)!
    const bindings = await service.bindings(key)
    const accounts = new Set(bindings.map((item) => item.token)).size
    const token = await service.defaultToken(key)
    return [
      `平台：${session.platform}`,
      `用户 ID：${session.userId}`,
      `管理员：${isAdmin(session, config) ? '是' : '否'}`,
      `绑定：${bindings.length} 个 Key · ${accounts} 个账号`,
      `默认账号：${token ? maskToken(token) : '未设置'}`,
    ].join('\n')
  }

  const main = ctx
    .command('dsu [query:text]', '查询 DeepSeek API 用量')
    .usage(
      [
        'dsu 看账号总览和已绑定 Key 的列表；dsu {序号/名字} 看单个 Key 的完整明细。',
        '账号：dsu login {备注名} / dsu logout {账号备注}。',
        'Key：dsu add {Key尾号} {备注名} / dsu unbind {序号/名字}。',
        'dsu help 看全部用法；只有登录了账号，不绑 Key 也能查账号总用量。',
      ].join('\n'),
    )
    .example('dsu')
    .example('dsu 1')
    .example('dsu login {备注名}')
    .example('dsu add {Key尾号} {备注名}')
    .example('dsu help')
    .action(
      guard(async (session, argv) => {
        const key = userKey(session)!
        const query = stripQuotedQuery(
          (argv.args ?? []).map((value) => String(value)).join(' '),
          session.quote?.content,
        )

        // 空格写法：dsu add / dsu login / dsu unbind …… 走和 dsu.xxx 同一套处理
        if (query.trim() === '?') return HELP_TEXT
        const spaced =
          /^(add|bind|login|logout|unbind|list|keys|api|remove|rm|del|account|all|key|refresh|whoami|help)\b\s*(.*)$/i.exec(
            query,
          )
        if (spaced) {
          const verb = spaced[1].toLowerCase()
          const rest = splitArgs(spaced[2])
          switch (verb) {
            case 'help':
              return HELP_TEXT
            case 'login':
              return setToken(session, splitTokenArgs(rest))
            case 'logout':
              return logoutCommand(session, rest.join(' '))
            case 'keys':
            case 'api':
              return keysCommand(session, rest.join(' '))
            case 'add':
            case 'bind':
              return bindKey(session, splitBindArgs(rest), `dsu ${verb}`)
            case 'unbind':
              return rest.length ? removeKey(session, rest[0], true) : unbindAll(session)
            case 'remove':
            case 'rm':
            case 'del':
              return rest.length ? removeKey(session, rest[0]) : '用法：dsu remove {序号或名字}'
            case 'list':
              return listKeys(session)
            case 'account':
              return accountCommand(session, rest)
            case 'all':
              return allCommand(session, rest[0])
            case 'key':
              return keyCommand(session, rest.join(' '))
            case 'refresh':
              return refreshCache(session)
            case 'whoami':
              return whoamiCommand(session)
          }
        }

        const accounts = await service.userAccountList(key)
        if (!accounts.length) return NO_ACCOUNT_MESSAGE

        if (!query) {
          const blocked = queryBlocked(session)
          if (blocked) return blocked
          const views = await Promise.all(
            accounts.map((account) => service.accountView(key, account.token, account.label)),
          )
          return showUserView(session, await numberReports(key, views))
        }

        const account = accounts.find((item) => item.label.toLowerCase() === query.toLowerCase())
        if (account) {
          const blocked = queryBlocked(session)
          if (blocked) return blocked
          const view = await service.accountView(key, account.token, account.label)
          return showUserView(session, await numberReports(key, [view]))
        }

        const matches = await service.matchBindings(key, query)
        if (!matches.length) {
          const names = (await service.bindings(key))
            .slice(0, 5)
            .map((item, index) => `${index + 1}.${item.keyName}`)
            .join('、')
          return [
            `没有找到「${scrubSecrets(query)}」对应的账号或 Key。`,
            names ? `你绑定的 Key：${names}　发送 dsu 看总览。` : '你还没有绑定 Key，发送 dsu 看账号总用量。',
          ].join('\n')
        }
        if (matches.length > 1) {
          const names = matches.map((item) => item.keyName).join('、')
          return `「${scrubSecrets(query)}」匹配到多个 Key：${names}，请写完整一点。`
        }
        const binding = matches[0]
        const blocked = queryBlocked(session)
        if (blocked) return blocked
        const label = accounts.find((item) => item.token === binding.token)?.label
        const report = await service.report(binding, label)
        const bindings = await service.bindings(key)
        const index = bindings.findIndex((item) => item.id === binding.id)
        return showReports(session, [report], index)
      }),
    )

  for (const alias of config.aliases ?? []) {
    const name = alias?.trim()
    if (name && !name.includes(' ')) main.alias(name)
  }

  ctx.command('dsu.help', '查看用法').action(guard(async () => HELP_TEXT))

  const loginHandler = guard(async (session, argv) => {
    return setToken(session, splitTokenArgs((argv.args ?? []) as Array<string | undefined>))
  })

  ctx
    .command('dsu.login [token:string] [name:string]', '绑定 / 切换账号（userToken）')
    .usage(LOGIN_USAGE)
    .example('dsu login {备注名}')
    .example('dsu login {userToken} {备注名}')
    .action(loginHandler)

  ctx
    .command('dsu.logout [query:string]', '退出账号（连带这个账号下的 Key）')
    .usage(
      [
        'dsu logout 退出当前默认账号；dsu logout {账号备注} 退出指定账号。',
        '退出会把账号备注和它下面你绑定的 Key 一起删掉，默认账号自动切到剩下的账号。',
        '只想删 Key、保留账号，用 dsu unbind。',
      ].join('\n'),
    )
    .example('dsu logout')
    .example('dsu logout {账号备注}')
    .action(
      guard(async (session, argv) => logoutCommand(session, String(argv.args?.[0] ?? '').trim())),
    )

  const addHandler = (usage: string) =>
    guard(async (session, argv) => {
      return bindKey(
        session,
        splitBindArgs((argv.args ?? []) as Array<string | undefined>),
        usage,
      )
    })

  ctx
    .command('dsu.add <key:string> [token:string] [name:string]', '添加一个 DeepSeek API Key')
    .usage(bindUsage('dsu add'))
    .example('dsu add {Key尾号} {备注名}')
    .action(addHandler('dsu add'))

  ctx
    .command('dsu.bind <key:string> [token:string] [name:string]', '添加一个 DeepSeek API Key（旧指令）')
    .usage('等同 dsu add。')
    .example('dsu.bind {Key尾号} {备注名}')
    .action(addHandler('dsu bind'))

  ctx
    .command('dsu.keys [query:string]', '列出账号下的全部 Key')
    .usage(
      [
        'dsu keys 列出所有账号的全部 Key；dsu keys {账号备注} 只看一个账号。',
        '会带上每个 Key 的今日 / 累计花费，并标出哪些已经绑定；不用再打开平台网页翻。',
      ].join('\n'),
    )
    .example('dsu keys')
    .example('dsu keys {账号备注}')
    .action(guard(async (session, argv) => keysCommand(session, String(argv.args?.[0] ?? '').trim())))

  ctx
    .command('dsu.account <action:string> [query:string] [name:string]', '管理账号备注')
    .usage('dsu account list；dsu account rename {账号/备注} {新备注}。')
    .example('dsu account list')
    .example('dsu account rename 账号1 主号')
    .action(
      guard(async (session, argv) => {
        return accountCommand(session, (argv.args ?? []).map((value) => String(value ?? '')))
      }),
    )

  ctx
    .command('dsu.remove <query:string>', '移除自己绑定的某个 Key')
    .usage('query 可以是序号、名字、Key ID 前缀或脱敏后缀。')
    .example('dsu remove 示例A')
    .action(
      guard(async (session, argv) => {
        const query = String(argv.args?.[0] ?? '').trim()
        if (!query) return '用法：dsu remove {序号或名字}'
        return removeKey(session, query)
      }),
    )

  ctx
    .command('dsu.list', '查看自己绑定的所有 Key')
    .action(guard(async (session) => listKeys(session)))

  ctx
    .command('dsu.unbind [query:string]', '解绑 Key（账号保留）')
    .usage(
      [
        'dsu unbind {序号/名字} 解绑那一个 Key；dsu unbind 不带参数解绑全部 Key。',
        '账号不会被删，发 dsu 还能查账号总用量；要退出账号用 dsu logout。',
      ].join('\n'),
    )
    .example('dsu unbind {序号/名字}')
    .example('dsu unbind')
    .action(
      guard(async (session, argv) => {
        const query = String(argv.args?.[0] ?? '').trim()
        return query ? removeKey(session, query, true) : unbindAll(session)
      }),
    )

  ctx
    .command('dsu.all [page:number]', '查看全部账号的 Key（管理员）')
    .usage('跨所有账号汇总，分页显示；页码从 1 开始。')
    .example('dsu.all')
    .example('dsu.all 2')
    .action(
      guard(async (session, argv) => {
        return allCommand(session, argv.args?.[0] ? String(argv.args[0]) : undefined)
      }),
    )

  ctx
    .command('dsu.key <query:string>', '查询指定 API Key 的用量（管理员）')
    .usage('跨所有账号按名字、Key ID 前缀或脱敏后缀查。')
    .example('dsu.key 示例A')
    .action(
      guard(async (session, argv) => {
        return keyCommand(session, String(argv.args?.[0] ?? '').trim())
      }),
    )

  ctx
    .command('dsu.refresh', '清空查询缓存（管理员）')
    .action(guard(async (session) => refreshCache(session)))

  ctx
    .command('dsu.whoami', '查看自己的平台 ID 和绑定状态')
    .action(guard(async (session) => whoamiCommand(session)))

  // 只发了 `dsu add` / `dsu login` 时，下一条消息直接当参数用：
  // `1234` → 绑 Key，`userToken 主号` → 登录账号。
  ctx.middleware(async (session, next) => {
    const key = userKey(session)
    if (!key) return next()
    const state = pending.get(key)
    if (!state) return next()
    if (Date.now() - state.at > PENDING_TTL) {
      pending.delete(key)
      return next()
    }

    const content = String((session as any).stripped?.content ?? session.content ?? '').trim()
    if (!content) return next()
    const parts = splitArgs(content)

    if (state.kind === 'add') {
      const first = parts[0] ?? ''
      const usable = looksLikeApiKey(first) || looksLikeKeySuffix(first) || parts.length > 1
      if (!usable) return next()
      pending.delete(key)
      return finalize(session, await bindKey(session, splitBindArgs(parts), 'dsu add'))
    }

    if (!parts.some((part) => looksLikeUserToken(part))) return next()
    pending.delete(key)
    return finalize(session, await setToken(session, splitTokenArgs(parts)))
  })
}
