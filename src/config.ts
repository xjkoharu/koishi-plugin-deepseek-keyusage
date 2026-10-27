import { Schema } from 'koishi'

export interface Config {
  /** DeepSeek 开放平台登录态 token（localStorage.userToken） */
  userToken: string
  /** 没有手动 Token 时，自动从本机浏览器读取 */
  autoReadToken: boolean
  /** 平台接口地址 */
  apiBaseUrl: string
  /** 官方 API 地址，仅用于校验 Key 是否有效 */
  officialBaseUrl: string
  /** 时区，决定「今日」的边界 */
  timeZone: string
  /** 展示与统计使用的币种 */
  currency: 'CNY' | 'USD'
  /** 查询结果缓存时间（秒） */
  cacheTtl: number
  /** 同一用户两次查询的最小间隔（秒） */
  cooldown: number
  /** 达到该权限等级的用户视为管理员 */
  adminAuthority: number
  /** 管理员白名单，支持 `qq:openid`、`onebot:QQ号` 或直接写用户 ID */
  adminUsers: string[]
  /** 是否允许在群聊中绑定 Key */
  allowGroupBind: boolean
  /** 群聊里发过 Token / 完整 Key 后自动撤回那条消息 */
  autoRecallInGroup: boolean
  /** 是否向普通用户展示账户余额 */
  showBalance: boolean
  /** QQ 平台使用 Markdown 消息 */
  qqMarkdown: boolean
  /** 主指令的额外别名 */
  aliases: string[]
  /** 管理员总览最多展示多少个 Key */
  maxKeys: number
  /** 每个用户最多绑定多少个 Key */
  maxBindings: number
  /** 管理员 dsu.all 每页展示多少个 Key */
  allPageSize: number
  /** 单次请求超时（毫秒） */
  requestTimeout: number
  /** 输出调试日志 */
  debug: boolean
}

export const Config: Schema<Config> = Schema.object({
  userToken: Schema.string()
    .role('secret')
    .default('')
    .description(
      [
        'DeepSeek 开放平台登录态。可以点下面的链接从本机 Edge / Chrome 一键读取，也可以手动粘贴：',
        '',
        '[从本机一键读取Token](/deepseek-keyusage/token)',
        '',
        '点击后会自动填入配置、写入 .env，并复制到剪贴板。',
        '',
        '手动获取：登录 platform.deepseek.com → F12 → Application → Local Storage → `https://platform.deepseek.com` → 复制 `userToken` 的值。',
        '留空时插件会自动尝试读取本机浏览器，也会读取环境变量 `DEEPSEEK_PLATFORM_TOKEN`。',
        '',
        '这是插件默认使用的平台账号；`dsu.add` 只发 Key 尾号时，会在这个账号的 Key 列表里匹配。',
      ].join('\n'),
    ),
  autoReadToken: Schema.boolean()
    .default(true)
    .description(
      '没有手动填写 Token 时，自动读取本机 Edge / Chrome 的 Local Storage（只会查找并验证 platform.deepseek.com 的登录态，不会上传任何浏览器数据）。',
    ),
  apiBaseUrl: Schema.string().default('https://platform.deepseek.com').description('平台接口地址。'),
  officialBaseUrl: Schema.string().default('https://api.deepseek.com').description('官方 API 地址，用于校验完整 Key；只发 Key 尾号时不需要。'),
  timeZone: Schema.string().default('Asia/Shanghai').description('时区，决定「今日」的起止时间。'),
  currency: Schema.union(['CNY', 'USD'] as const).default('CNY').description('展示与统计使用的币种。'),
  cacheTtl: Schema.natural().min(0).max(3600).default(60).description('查询结果缓存时间（秒），避免频繁请求平台。'),
  cooldown: Schema.natural().min(0).max(600).default(10).description('同一用户两次查询的最小间隔（秒）。'),
  adminAuthority: Schema.natural()
    .min(0)
    .max(5)
    .default(4)
    .description('达到该 Koishi 权限等级的用户视为管理员。与 adminUsers 白名单取并集，满足任意一条即可。'),
  adminUsers: Schema.array(Schema.string())
    .default([])
    .role('table')
    .description('管理员白名单，可填 `qq:openid`、`onebot:QQ号` 或纯用户 ID。与权限等级取并集，任意一条命中即为管理员。'),
  allowGroupBind: Schema.boolean()
    .default(true)
    .description('是否允许在群聊里绑定。默认开启；关掉后只能在私聊里绑定（只发 Key 尾号也不会暴露完整 Key，一般不用关）。'),
  autoRecallInGroup: Schema.boolean()
    .default(true)
    .description('群聊里发送账号 Token 或完整 Key 后，自动撤回那条消息（需要机器人有撤回权限；失败时只提示手动撤回）。'),
  showBalance: Schema.boolean().default(true).description('是否向普通用户展示账户总余额。'),
  qqMarkdown: Schema.boolean()
    .default(true)
    .description('QQ 消息使用 Markdown 渲染（如果不支持 Markdown 就关掉）。'),
  aliases: Schema.array(Schema.string())
    .default(['额度'])
    .role('table')
    .description('主指令（dsu）的额外别名。如果和其他插件冲突，可以在这里删掉。'),
  maxKeys: Schema.natural().min(1).max(200).default(30).description('管理员总览最多展示多少个 Key。'),
  maxBindings: Schema.natural().min(1).max(50).default(5).description('每个用户最多可以绑定多少个 Key。'),
  allPageSize: Schema.natural().min(1).max(50).default(10).description('管理员 dsu.all 每页展示多少个 Key。'),
  requestTimeout: Schema.natural().min(1000).max(60000).default(10000).description('单次请求超时（毫秒）。'),
  debug: Schema.boolean().default(false).description('输出调试日志。'),
})

export const DEFAULT_CONFIG: Config = {
  userToken: '',
  autoReadToken: true,
  apiBaseUrl: 'https://platform.deepseek.com',
  officialBaseUrl: 'https://api.deepseek.com',
  timeZone: 'Asia/Shanghai',
  currency: 'CNY',
  cacheTtl: 60,
  cooldown: 10,
  adminAuthority: 4,
  adminUsers: [],
  allowGroupBind: true,
  autoRecallInGroup: true,
  showBalance: true,
  qqMarkdown: true,
  aliases: ['额度'],
  maxKeys: 30,
  maxBindings: 5,
  allPageSize: 10,
  requestTimeout: 10000,
  debug: false,
}
