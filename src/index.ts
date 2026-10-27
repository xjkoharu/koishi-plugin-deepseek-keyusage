import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Context } from 'koishi'
import { Config } from './config'
import { AccountService, ACCOUNT_TABLE, BINDING_TABLE, USER_TABLE } from './account-service'
import { OfficialClient } from './api/official'
import { applyCommands } from './commands'
import { BindingStore } from './store'
import { TokenManager, defaultTokenFile, isLoopback, readTokenFile, upsertEnvToken } from './token'
import { copyToClipboard } from './clipboard'

export const name = 'deepseek-keyusage'
export const inject = ['database']

export const usage = `
在 QQ 里查询 DeepSeek API Key 的余额、花费和 Token 用量。

**账号 / Key 两级**：一个 userToken 是一个账号，一个账号下可以绑定多个 Key。
只要绑定了账号，即使一个 Key 都没绑定，也能用 \`dsu\` 查账号总用量。

第一次使用：
1. \`dsu.login <备注名>\` 读取 bot 所在电脑浏览器的登录态，或 \`dsu.login <userToken> <备注名>\` 直接粘贴；
2. （可选）\`dsu.add <Key尾号> <备注名>\` 绑定 Key，看单个 Key 的明细；\`dsu add <Key尾号>\` 是同样的空格写法。
   \`<Key尾号>\` 是平台上 Key 的后四位，不需要发完整 Key。

解绑只影响 Key：\`dsu.unbind <序号/名字>\` 解绑一个，\`dsu.unbind\` 解绑全部，账号都保留；
要退出账号用 \`dsu.logout [账号备注]\`。\`dsu.token\` 是 \`dsu.login\` 的旧名字，仍然可用。

群聊里可以直接用；发送过 Token / 完整 Key 的消息会被自动撤回（可配置）。

管理员：\`dsu.all [页码]\` 跨所有账号分页查看，\`dsu.key <名字>\` 查任意 Key。
账号备注用 \`dsu.account list\` 查看，\`dsu.account rename 账号1 主号\` 修改。

注意：userToken 等同于账号登录态，不要外传。
`

export { Config }
export { registerRenderer } from './render'
export type {
  AccountOverview,
  ApiKeyInfo,
  BalanceInfo,
  Binding,
  KeyOverview,
  Report,
  Stat,
  UserSummary,
} from './types'

interface PluginEntry {
  key: string
  config: any
}

function findPluginEntry(node: any): PluginEntry | null {
  if (!node || typeof node !== 'object') return null
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('deepseek-keyusage')) return { key, config: value }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = findPluginEntry(value)
      if (found) return found
    }
  }
  return null
}

function refererPath(referer: string | undefined): string {
  if (!referer) return '/plugins/'
  try {
    const url = new URL(referer)
    if (!isLoopback(url.hostname)) return '/plugins/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/plugins/'
  }
}

function pluginPagePath(loader: any, referer?: string): string {
  const entry = findPluginEntry(loader?.config?.plugins)
  if (entry) {
    const index = entry.key.indexOf(':')
    const id = index >= 0 ? entry.key.slice(index + 1) : entry.key
    if (id) return `/plugins/${id}`
  }
  return refererPath(referer)
}

function defineModels(ctx: Context): void {
  ctx.model.extend(
    BINDING_TABLE,
    {
      id: 'string',
      userId: 'string',
      token: 'string',
      trackingId: 'string',
      keyName: 'string',
      sensitiveId: 'string',
      boundAt: 'unsigned',
    },
    { primary: 'id' },
  )
  ctx.model.extend(
    USER_TABLE,
    {
      userId: 'string',
      token: 'string',
      updatedAt: 'unsigned',
    },
    { primary: 'userId' },
  )
  ctx.model.extend(
    ACCOUNT_TABLE,
    {
      id: 'string',
      userId: 'string',
      token: 'string',
      name: 'string',
      createdAt: 'unsigned',
      updatedAt: 'unsigned',
    },
    { primary: 'id' },
  )
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('deepseek-keyusage')
  const tokenFile = defaultTokenFile(ctx.baseDir)
  defineModels(ctx)

  const tokens = new TokenManager({
    configToken: config.userToken,
    envToken: process.env.DEEPSEEK_PLATFORM_TOKEN,
    tokenFile,
    autoRead: config.autoReadToken,
    baseUrl: config.apiBaseUrl,
    timeout: config.requestTimeout,
    logger,
  })

  const debug = config.debug
    ? (message: string, detail?: unknown) => logger.info(message, detail ?? '')
    : undefined

  const verifier = new OfficialClient({
    baseUrl: config.officialBaseUrl,
    timeout: config.requestTimeout,
  })

  const service = new AccountService({
    ctx,
    config,
    verifier,
    logger,
    debug,
  })

  applyCommands(ctx, service, config, logger)
  void tokens.getToken().catch((error) => logger.warn(error))

  // 旧版是「全局 token + JSON 绑定」；升级后自动迁移成带 token 的绑定。
  ctx.on('ready', async () => {
    try {
      await service.ensureLegacyAccounts()
    } catch (error) {
      logger.warn?.(`补全旧账号备注失败：${(error as Error).message}`)
    }
  })

  ctx.on('ready', async () => {
    try {
      const existing = await ctx.database.get(BINDING_TABLE, {})
      if (existing.length) return

      const token =
        config.userToken?.trim() ||
        (await readTokenFile(tokenFile).catch(() => '')) ||
        process.env.DEEPSEEK_PLATFORM_TOKEN?.trim()
      if (!token) return

      const file = path.join(ctx.baseDir, 'data', 'deepseek-keyusage', 'bindings.json')
      const store = new BindingStore(file, logger)
      await store.ready()
      const entries = store.list()
      if (!entries.length) return

      for (const [userId, bindings] of entries) {
        for (const binding of bindings) {
          await ctx.database.create(BINDING_TABLE, {
            id: `${userId}:${binding.trackingId}`,
            userId,
            token,
            trackingId: binding.trackingId,
            keyName: binding.name,
            sensitiveId: binding.sensitiveId,
            boundAt: binding.boundAt || Date.now(),
          })
        }
        await service.setDefaultToken(userId, token, '账号1')
      }
      await fs.rename(file, `${file}.migrated`).catch(() => undefined)
      logger.info(`已迁移 ${entries.length} 个用户的旧绑定`)
    } catch (error) {
      logger.warn?.(`迁移旧绑定失败：${(error as Error).message}`)
    }
  })

  // 控制台配置页的「从本机一键读取Token」仍然保留：写回配置、.env 和剪贴板。
  ;(ctx as any).inject(['server'], (ctx: any) => {
    const server = ctx.server
    if (!server?.get) return
    server.get('/deepseek-keyusage/token', async (koa: any) => {
      if (!isLoopback(koa.request?.ip)) {
        koa.status = 403
        koa.body = 'Forbidden'
        return
      }
      const loader = (ctx as any).loader
      const back = pluginPagePath(loader, koa.headers?.referer)
      let token: string | null = null
      try {
        token = await tokens.scanNow()
      } catch (error) {
        logger.warn?.(error)
      }
      if (!token) {
        koa.status = 404
        koa.type = 'text/plain; charset=utf-8'
        koa.body = '没有找到可用的 Token。请确认已用 Edge 或 Chrome 登录 platform.deepseek.com，然后重试。'
        return
      }

      try {
        config.userToken = token
        const entry = findPluginEntry(loader?.config?.plugins)
        if (entry) {
          entry.config.userToken = token
          await loader.writeConfig?.(true)
        }
      } catch (error) {
        logger.warn?.(`写入插件配置失败：${(error as Error).message}`)
      }

      try {
        process.env.DEEPSEEK_PLATFORM_TOKEN = token
        await upsertEnvToken(path.join(ctx.baseDir, '.env'), token)
      } catch (error) {
        logger.warn?.(`写入 .env 失败：${(error as Error).message}`)
      }

      const copied = await copyToClipboard(token)
      if (!copied) logger.debug?.('复制到剪贴板失败，已跳过')

      koa.redirect(back)
    })
  })
}
