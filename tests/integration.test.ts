import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startOfLocalDay, tzOffsetSeconds } from '../src/utils/time'

// 用 require 加载 CJS 版本的 koishi：vitest 的 ESM 转换会破坏 loader 的类继承。
const require = createRequire(import.meta.url)
const { App } = require('koishi') as typeof import('koishi')
const mock = require('@koishijs/plugin-mock').default as any
const memory = require('@koishijs/plugin-database-memory').default as any
const plugin = require('../lib/index.js') as typeof import('../src/index')
const { BINDING_TABLE } = require('../lib/account-service.js') as typeof import('../src/account-service')

const TZ = 8 * 3600
const FULL_KEY = 'sk-abcde0123456789abcdef1234'
const ADMIN_ID = 'admin-1'
const USER_ID = 'user-1'

const nowSeconds = Math.floor(Date.now() / 1000)
const todayStart = startOfLocalDay(nowSeconds, tzOffsetSeconds(new Date(), 'Asia/Shanghai'))
const yesterday = todayStart - 86400

const API_KEY = {
  tracking_id: 'tk_1',
  name: '示例A',
  sensitive_id: 'sk-abcde**1234',
  created_at: nowSeconds - 10 * 86400,
  last_use: nowSeconds,
}

const API_KEY2 = {
  tracking_id: 'tk_2',
  name: '示例B',
  sensitive_id: 'sk-fghij**5678',
  created_at: nowSeconds - 5 * 86400,
  last_use: null,
}

const API_KEY3 = {
  tracking_id: 'tk_3',
  name: '示例C',
  sensitive_id: 'sk-klmno**9012',
  created_at: nowSeconds - 2 * 86400,
  last_use: null,
}

const FULL_KEY2 = 'sk-fghij0123456789abcdef5678'

const envelope = (biz: unknown) => JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: biz } })

function createServer() {
  const requests: Array<{ pathname: string; authorization?: string; query: URLSearchParams }> = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    requests.push({
      pathname: url.pathname,
      authorization: req.headers.authorization,
      query: url.searchParams,
    })
    const send = (body: string) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
    }
    if (url.pathname === '/api/v0/users/get_api_keys') {
      return send(envelope({ api_keys: [API_KEY, API_KEY2, API_KEY3] }))
    }
    if (url.pathname === '/api/v0/users/get_user_summary') {
      return send(
        envelope({
          total_costs: [{ currency: 'CNY', amount: 3.21 }],
          normal_wallets: [{ currency: 'CNY', balance: 10 }],
          bonus_wallets: [{ currency: 'CNY', balance: 2.34 }],
        }),
      )
    }
    if (url.pathname === '/api/v0/usage/by_api_key/amount') {
      return send(
        envelope({
          series: [
            {
              api_key: API_KEY,
              model: 'deepseek-flash',
              buckets: [
                {
                  time: yesterday,
                  usage: { PROMPT_CACHE_HIT_TOKEN: 1000, PROMPT_CACHE_MISS_TOKEN: 500, RESPONSE_TOKEN: 200, REQUEST: 2 },
                },
                {
                  time: todayStart,
                  usage: { PROMPT_CACHE_HIT_TOKEN: 100, PROMPT_CACHE_MISS_TOKEN: 50, RESPONSE_TOKEN: 20, REQUEST: 1 },
                },
              ],
            },
          ],
        }),
      )
    }
    if (url.pathname === '/api/v0/usage/by_api_key/cost') {
      return send(
        envelope({
          data: [
            {
              currency: 'CNY',
              series: [
                {
                  api_key: API_KEY,
                  model: 'deepseek-flash',
                  buckets: [
                    { time: yesterday, cost: '0.01' },
                    { time: todayStart, cost: '0.02' },
                  ],
                },
              ],
              function_series: [],
            },
          ],
        }),
      )
    }
    if (url.pathname === '/user/balance') {
      return send(
        JSON.stringify({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '2.34', topped_up_balance: '10' }],
        }),
      )
    }
    res.writeHead(404)
    res.end('{}')
  })
  return { server, requests }
}

describe('plugin integration', () => {
  let server: http.Server
  let app: App
  let baseDir: string
  let requests: ReturnType<typeof createServer>['requests']
  let client: { receive(content: string): Promise<string[]> }
  let admin: { receive(content: string): Promise<string[]> }

  beforeAll(async () => {
    const created = createServer()
    server = created.server
    requests = created.requests
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('failed to listen')
    const base = `http://127.0.0.1:${address.port}`

    baseDir = await mkdtemp(join(tmpdir(), 'koishi-dsu-'))
    app = new App({ baseDir })
    app.baseDir = baseDir
    app.plugin(mock, {})
    app.plugin(memory, {})
    app.plugin(plugin as any, {
      userToken: 'test-token',
      apiBaseUrl: base,
      officialBaseUrl: base,
      cacheTtl: 0,
      cooldown: 0,
      timeZone: 'Asia/Shanghai',
      adminUsers: [`mock:${ADMIN_ID}`],
      aliases: [],
      allPageSize: 2,
    })
    await app.start()
    const mockContext = (app as any).mock
    client = mockContext.client(USER_ID, 'channel-1')
    admin = mockContext.client(ADMIN_ID, 'channel-2')
  }, 30000)

  afterAll(async () => {
    // 不调用 app.stop()：plugin-mock 的 MockBot.dispose 已知会抛错，进程结束时自然回收
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    if (baseDir) await rm(baseDir, { recursive: true, force: true })
  })

  it('asks an unbound user to add a key first', async () => {
    const replies = await client.receive('dsu')
    expect(replies.join('\n')).toContain('你还没有绑定 API Key')
  })

  it('denies admin commands to normal users', async () => {
    const replies = await client.receive('dsu.all')
    expect(replies.join('\n')).toContain('只有管理员能用')
  })

  it('rejects a key that is not in the account', async () => {
    const replies = await client.receive('dsu.add sk-00000aaaaaaaaaaaaaaaaaa0000')
    expect(replies.join('\n')).toContain('没有在这个账号里找到')
  })

  it('adds a key and never stores the full key', async () => {
    const replies = await client.receive(`dsu.add ${FULL_KEY}`)
    expect(replies.join('\n')).toContain('添加成功：示例A')
    const stored = JSON.stringify(await (app as any).database.get(BINDING_TABLE, {}))
    expect(stored).not.toContain(FULL_KEY)
    expect(stored).toContain('sk-abcde**1234')
  })

  it('adds a second key for the same user', async () => {
    const replies = await client.receive(`dsu.add ${FULL_KEY2}`)
    const text = replies.join('\n')
    expect(text).toContain('添加成功：示例B')
    expect(text).toContain('2 个 Key')
  })

  it('shows every bound key when there are several', async () => {
    const text = (await client.receive('dsu')).join('\n')
    expect(text).toContain('DeepSeek API用量：')
    expect(text).toContain('API-1：sk-abcde**1234')
    expect(text).toContain('API-2：sk-fghij**5678')
    expect(text).toContain('  名称：示例A')
    expect(text).toContain('  名称：示例B')
    expect(text).toContain('更新于：')
  })

  it('queries one key by index', async () => {
    const text = (await client.receive('dsu 1')).join('\n')
    expect(text).toContain('DeepSeek API用量：')
    expect(text).toContain('API-1：sk-abcde**1234')
    expect(text).toContain('  名称：示例A')
    expect(text).toContain('  余额 ¥12.34（赠金 ¥2.34 / 充值 ¥10.00）')
    expect(text).toContain('  累计花费 ¥0.030 · Token 1,870')
    expect(text).toContain('  今日花费 ¥0.020 · Token 170')
    expect(text).toContain('  统计起始日期：')
  })

  it('queries one key by name', async () => {
    const text = (await client.receive('dsu 示例B')).join('\n')
    expect(text).toContain('API-2：sk-fghij**5678')
    expect(text).toContain('  名称：示例B')
    expect(text).toContain('  累计花费 ¥0.00 · Token 0')
  })

  it('sends the platform token to the usage endpoints', async () => {
    const usageRequests = requests.filter((item) => item.pathname === '/api/v0/usage/by_api_key/amount')
    const forKeyOne = usageRequests.find((item) => item.query.getAll('api_key_tracking_id').includes('tk_1'))
    expect(forKeyOne?.authorization).toBe('Bearer test-token')
    expect(forKeyOne?.query.get('tz')).toBe(String(TZ))
  })

  it('lets admins see all keys', async () => {
    const text = (await admin.receive('dsu.all')).join('\n')
    expect(text).toContain('DeepSeek 账户总览')
    expect(text).toContain('累计花费 ¥3.21')
    expect(text).toContain('Key 3 个')
    expect(text).toContain('示例A sk-abcde**1234')
    expect(text).toContain('第 1/2 页')
    const page2 = (await admin.receive('dsu.all 2')).join('\n')
    expect(page2).toContain('第 2/2 页')
  })

  it('lets admins query one key by name', async () => {
    const text = (await admin.receive('dsu.key 示例A')).join('\n')
    expect(text).toContain('  累计花费 ¥0.030')
  })

  it('reports identity and binding state', async () => {
    const text = (await client.receive('dsu.whoami')).join('\n')
    expect(text).toContain('平台：mock')
    expect(text).toContain(`用户 ID：${USER_ID}`)
    expect(text).toContain('管理员：否')
    expect(text).toContain('绑定：2 个 Key · 1 个账号')
  })

  it('binds a second account for the same user', async () => {
    const text = (await client.receive('dsu.add 1234 test-token-2')).join('\n')
    expect(text).toContain('添加成功：示例A')
    expect(text).toContain('3 个 Key')
    const all = (await client.receive('dsu')).join('\n')
    expect(all).toContain('账号：账号1')
    expect(all).toContain('账号：账号2')
    const second = (await client.receive('dsu 账号2')).join('\n')
    expect(second).toContain('账号：账号2')
    expect(second).toContain('API-1：sk-abcde**1234')
  })

  it('removes one key and then all remaining keys', async () => {
    expect((await client.receive('dsu.remove 示例B')).join('\n')).toContain('已移除：示例B')
    const text = (await client.receive('dsu')).join('\n')
    expect(text).toContain('API-1：sk-abcde**1234')
    expect(text).not.toContain('名称：示例B')
    expect(text).toContain('账号：账号2')
    expect((await client.receive('dsu.unbind')).join('\n')).toContain('已解绑全部 2 个 Key')
    expect((await client.receive('dsu')).join('\n')).toContain('你还没有绑定 API Key')
  })

  it('binds by key suffix using the spaced dsu add syntax', async () => {
    const second = (app as any).mock.client('user-2', 'channel-3')
    const text = (await second.receive('dsu add 9012')).join('\n')
    expect(text).toContain('添加成功：示例C')
    expect(text).toContain('sk-klmno**9012')
  })
})
