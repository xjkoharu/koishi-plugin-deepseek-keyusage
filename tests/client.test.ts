import { describe, expect, it } from 'vitest'
import { PlatformClient } from '../src/api/client'

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const createClient = (handler: (url: URL) => Response) => {
  const calls: URL[] = []
  const client = new PlatformClient({
    baseUrl: 'https://platform.deepseek.com',
    token: 'test-token',
    timeZone: 'Asia/Shanghai',
    fetchImpl: async (input) => {
      const url = new URL(input)
      calls.push(url)
      return handler(url)
    },
  })
  return { client, calls }
}

describe('PlatformClient', () => {
  it('maps api keys and converts timestamps to milliseconds', async () => {
    const { client } = createClient(() =>
      response({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: {
            api_keys: [
              {
                tracking_id: 'tk_1',
                name: '示例A',
                sensitive_id: 'sk-abcde**1234',
                created_at: 1700000000,
                last_use: 1700000100,
              },
              { tracking_id: '', name: 'broken' },
            ],
          },
        },
      }),
    )
    const keys = await client.getApiKeys()
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({
      trackingId: 'tk_1',
      name: '示例A',
      sensitiveId: 'sk-abcde**1234',
      createdAt: 1700000000000,
      lastUse: 1700000100000,
    })
  })

  it('sends range, timezone and repeated key ids', async () => {
    const { client, calls } = createClient(() =>
      response({ code: 0, data: { biz_code: 0, biz_data: { series: [] } } }),
    )
    await client.getAmount({ start: 1000, end: 2000 }, ['a', 'b'])
    const url = calls[0]
    expect(url.pathname).toBe('/api/v0/usage/by_api_key/amount')
    expect(url.searchParams.get('start')).toBe('1000')
    expect(url.searchParams.get('end')).toBe('2000')
    expect(url.searchParams.get('tz')).toBe('28800')
    expect(url.searchParams.getAll('api_key_tracking_id')).toEqual(['a', 'b'])
  })

  it('parses usage buckets and string numbers', async () => {
    const { client } = createClient(() =>
      response({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: {
            series: [
              {
                api_key: { tracking_id: 'tk_1', name: '示例A', sensitive_id: 'sk-abcde**1234' },
                model: 'deepseek-flash',
                buckets: [
                  {
                    time: 1700000000,
                    usage: {
                      PROMPT_CACHE_HIT_TOKEN: '100',
                      PROMPT_CACHE_MISS_TOKEN: 50,
                      RESPONSE_TOKEN: '25',
                      REQUEST: 2,
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
    )
    const series = await client.getAmount({ start: 1, end: 2 })
    expect(series).toHaveLength(1)
    expect(series[0].buckets[0].usage).toEqual({ cacheHit: 100, cacheMiss: 50, output: 25, requests: 2 })
  })

  it('parses cost series including function costs', async () => {
    const { client } = createClient(() =>
      response({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: {
            data: [
              {
                currency: 'CNY',
                series: [
                  {
                    api_key: { tracking_id: 'tk_1', name: '示例A', sensitive_id: 'sk-abcde**1234' },
                    model: 'deepseek-flash',
                    buckets: [{ time: 1700000000, cost: '0.0123' }],
                  },
                ],
                function_series: [
                  {
                    api_key: { tracking_id: 'tk_1', name: '示例A', sensitive_id: 'sk-abcde**1234' },
                    buckets: [{ time: 1700000000, cost: 0.5 }],
                  },
                ],
              },
            ],
          },
        },
      }),
    )
    const series = await client.getCost({ start: 1, end: 2 })
    expect(series).toHaveLength(2)
    expect(series[0]).toMatchObject({ currency: 'CNY', kind: 'model' })
    expect(series[0].buckets[0].cost).toBeCloseTo(0.0123)
    expect(series[1].kind).toBe('function')
    expect(series[1].buckets[0].cost).toBe(0.5)
  })

  it('rejects when token is missing', async () => {
    const client = new PlatformClient({
      baseUrl: 'https://platform.deepseek.com',
      token: '',
      timeZone: 'Asia/Shanghai',
    })
    await expect(client.getSummary()).rejects.toMatchObject({ kind: 'config' })
  })

  it('maps business auth errors', async () => {
    const { client } = createClient(() => response({ code: 40003, msg: 'Authorization Failed (invalid token)', data: null }))
    await expect(client.getSummary()).rejects.toMatchObject({ kind: 'auth', code: 40003 })
  })

  it('maps http auth errors', async () => {
    const { client } = createClient(() => response({}, 401))
    await expect(client.getSummary()).rejects.toMatchObject({ kind: 'auth', status: 401 })
  })
})
