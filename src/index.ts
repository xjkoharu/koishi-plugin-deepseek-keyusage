import { Context } from 'koishi'
import path from 'node:path'
import { Config } from './config'
import { PlatformClient } from './api/client'
import { OfficialClient } from './api/official'
import { BindingStore } from './store'
import { UsageService } from './service'
import { applyCommands } from './commands'
import { TokenManager, defaultTokenFile, isLoopback, upsertEnvToken } from './token'
import { copyToClipboard } from './clipboard'

export const name = 'deepseek-keyusage'

export const usage = `
在 QQ 里查询 DeepSeek API Key 的余额、花费和 Token 用量。

**平台 Token**：点配置项里的「从本机一键读取Token」，会自动读取本机 Edge/Chrome 的登录态，填入配置、写入环境变量并复制到剪贴板。也可以手动粘贴。

私聊机器人发送 \`dsu.add sk-...\` 添加自己的 Key（可以多个），之后发 \`dsu\` 就能查。

注意：平台 Token 等同于账号登录态，不要外传。
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

/** 直接按插件实例 ID 拼出配置页地址，避免 Referer 被 Markdown 链接的 no-referrer 丢掉。 */
function pluginPagePath(loader: any, referer?: string): string {
  const entry = findPluginEntry(loader?.config?.plugins)
  if (entry) {
    const index = entry.key.indexOf(':')
    const id = index >= 0 ? entry.key.slice(index + 1) : entry.key
    if (id) return `/plugins/${id}`
  }
  return refererPath(referer)
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('deepseek-keyusage')
  const tokenFile = defaultTokenFile(ctx.baseDir)
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

  const client = new PlatformClient({
    baseUrl: config.apiBaseUrl,
    token: '',
    tokenProvider: () => tokens.getToken(),
    timeZone: config.timeZone,
    timeout: config.requestTimeout,
    debug,
  })
  const verifier = new OfficialClient({
    baseUrl: config.officialBaseUrl,
    timeout: config.requestTimeout,
  })
  const store = new BindingStore(path.join(ctx.baseDir, 'data', 'deepseek-keyusage', 'bindings.json'), logger)
  const service = new UsageService({
    client,
    verifier,
    store,
    config: {
      currency: config.currency,
      timeZone: config.timeZone,
      cacheTtl: config.cacheTtl,
      maxKeys: config.maxKeys,
      maxBindings: config.maxBindings,
    },
    logger,
  })

  void store.ready().catch((error) => logger.warn(error))
  // 提前解析 Token：手动配置会立即返回，留空时会在后台尝试扫描浏览器
  void tokens.getToken().catch((error) => logger.warn(error))

  applyCommands(ctx, service, config, logger)

  // 控制台配置页里的「从本机一键读取 Token」动作：
  // 读取 → 写回 koishi.yml → 写 .env → 复制到剪贴板 → 跳回配置页，不渲染任何页面。
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

      // 1) 写回运行中的配置和 koishi.yml
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

      // 2) 写入 .env 并更新当前进程环境变量
      try {
        process.env.DEEPSEEK_PLATFORM_TOKEN = token
        await upsertEnvToken(path.join(ctx.baseDir, '.env'), token)
      } catch (error) {
        logger.warn?.(`写入 .env 失败：${(error as Error).message}`)
      }

      // 3) 复制到系统剪贴板（bot 和浏览器在同一台电脑时可用）
      const copied = await copyToClipboard(token)
      if (!copied) logger.debug?.('复制到剪贴板失败，已跳过')

      koa.redirect(back)
    })
  })
}
