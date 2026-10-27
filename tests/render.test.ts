import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import {
  buildQQKeyboard,
  cmdInput,
  flattenText,
  registerRenderer,
  renderBindingListMarkdown,
  renderOverview,
  renderOverviewMarkdown,
  renderReport,
  renderReportMarkdown,
  renderReports,
  renderUserView,
  resolveRenderer,
  type RenderOptions,
} from '../src/render'
import type { AccountView } from '../src/account-service'

// vitest 的 ESM 转换会破坏 koishi 的类继承，用 CJS 版本加载
const require = createRequire(import.meta.url)
const { h } = require('koishi') as typeof import('koishi')
import type { AccountOverview, ApiKeyInfo, Report } from '../src/types'

const options: RenderOptions = {
  platform: 'qq',
  isAdmin: false,
  showBalance: true,
  currency: 'CNY',
  timeZone: 'Asia/Shanghai',
  maxKeys: 1,
}

const key: ApiKeyInfo = {
  trackingId: 'tk_1',
  name: '示例A',
  sensitiveId: 'sk-abcde**1234',
  createdAt: Date.UTC(2026, 0, 1),
  lastUse: null,
}

const report: Report = {
  key,
  total: { cost: 0.03, cacheHit: 110, cacheMiss: 55, output: 22, requests: 3 },
  today: { cost: 0.02, cacheHit: 10, cacheMiss: 5, output: 2, requests: 1 },
  balance: { currency: 'CNY', total: 12.5, granted: 2.5, toppedUp: 10, available: true },
  range: { start: Math.floor(Date.UTC(2025, 11, 1) / 1000), end: Math.floor(Date.UTC(2026, 9, 25, 13, 30) / 1000) },
  updatedAt: Date.UTC(2026, 9, 25, 13, 30),
}

describe('renderReport', () => {
  it('renders the plain text report', () => {
    const text = renderReport(report, options)
    expect(text).toContain('DeepSeek API用量：')
    expect(text).toContain('API-1：sk-abcde**1234')
    expect(text).toContain('  名称：示例A')
    expect(text).toContain('  余额 ¥12.50（赠金 ¥2.50 / 充值 ¥10.00）')
    expect(text).toContain('  累计花费 ¥0.030 · Token 187')
    expect(text).toContain('    输入 165（命中 110 / 未命中 55）')
    expect(text).toContain('    输出 22 · 请求 3 次 · 命中率 66.67%')
    expect(text).toContain('  今日花费 ¥0.020 · Token 17')
    expect(text).toContain('  统计起始日期：2025-12-01')
    expect(text).toContain('更新于：2026-10-25 21:30')
  })

  it('hides balance when disabled', () => {
    const text = renderReport(report, { ...options, showBalance: false })
    expect(text).not.toContain('余额')
  })

  it('numbers multiple reports', () => {
    const second: Report = {
      ...report,
      key: { ...key, trackingId: 'tk_2', name: '示例B', sensitiveId: 'sk-fghij**5678' },
    }
    const text = renderReports([report, second], options)
    expect(text).toContain('API-1：sk-abcde**1234')
    expect(text).toContain('API-2：sk-fghij**5678')
    expect(text.indexOf('API-1')).toBeLessThan(text.indexOf('API-2'))
  })

  it('prepends the account total for admins', () => {
    const overview: AccountOverview = {
      keys: [
        { key, total: report.total, today: report.today },
        {
          key: { ...key, trackingId: 'tk_2', name: '示例B', sensitiveId: 'sk-fghij**5678' },
          total: report.total,
          today: report.today,
        },
      ],
      total: report.total,
      accountCost: 0.5,
      accountTokens: 187,
      balance: report.balance,
      updatedAt: report.updatedAt,
    }
    const text = renderReports([report], options, 0, true, overview)
    expect(text).toContain('**账户总用量**')
    expect(text).toContain('- 余额 ¥12.50 · 累计花费 ¥0.500 · 累计 Token 187')
    expect(text).toContain('- 今日花费 ¥0.040 · 今日 Token 34 · Key 2 个')
    expect(text).toContain('**DeepSeek API用量**')
  })

  it('shows the account total even without bindings', () => {
    const overview: AccountOverview = {
      keys: [{ key, total: report.total, today: report.today }],
      total: report.total,
      accountCost: 0.5,
      accountTokens: 187,
      balance: report.balance,
      updatedAt: report.updatedAt,
    }
    const text = renderReports([], options, 0, false, overview)
    expect(text).toContain('账户总用量：')
    expect(text).toContain('你还没有添加 API Key')
  })
})

describe('renderUserView', () => {
  const overview: AccountOverview = {
    keys: [
      {
        key,
        total: report.total,
        today: report.today,
        range: report.range,
        binding: {
          trackingId: 'tk_1',
          name: '示例A',
          sensitiveId: key.sensitiveId,
          boundAt: 0,
          boundBy: 'qq:user-1',
        },
      },
      {
        key: { ...key, trackingId: 'tk_2', name: '示例B', sensitiveId: 'sk-fghij**5678' },
        total: report.total,
        today: report.today,
        range: report.range,
      },
    ],
    total: report.total,
    accountCost: 3.21,
    accountTokens: 187,
    balance: report.balance,
    updatedAt: report.updatedAt,
  }

  it('shows account totals and a one-line summary per bound key', () => {
    const views: AccountView[] = [{ label: '主号', overview, reports: [{ ...report, number: 1 }] }]
    const text = renderUserView(views, options)
    expect(text).toContain('DeepSeek API用量')
    expect(text).toContain('账号：主号')
    expect(text).toContain('  余额 ¥12.50（赠金 ¥2.50 / 充值 ¥10.00） · 累计花费 ¥3.21 · 累计 Token 187')
    expect(text).toContain('  今日花费 ¥0.040 · 今日 Token 34 · Key 2 个')
    expect(text).toContain('1. 示例A · sk-abcde**1234 · 今日 ¥0.020 · 累计 ¥0.030')
    expect(text).toContain('（账号里还有 1 个 Key 没绑定）')
    expect(text).toContain('发送 dsu {序号}')
  })

  it('keeps the account totals when nothing is bound', () => {
    const views: AccountView[] = [{ label: '主号', overview: { ...overview, keys: [] }, reports: [] }]
    const text = renderUserView(views, options)
    expect(text).toContain('账号：主号')
    expect(text).toContain('累计花费 ¥3.21')
    expect(text).toContain('还没有绑定 Key')
    expect(text).not.toContain('发送 dsu {序号}')
  })
})

describe('renderOverview', () => {
  const overview: AccountOverview = {
    keys: [
      { key, total: report.total, today: report.today, binding: { trackingId: 'tk_1', name: '示例A', sensitiveId: key.sensitiveId, boundAt: 0, boundBy: 'qq:user-1' } },
      { key: { ...key, trackingId: 'tk_2', name: '示例B', sensitiveId: 'sk-fghij**5678' }, total: report.total, today: report.today },
    ],
    total: report.total,
    accountCost: 0.5,
    accountTokens: 187,
    balance: report.balance,
    updatedAt: report.updatedAt,
  }

  it('renders summary and truncates the key list', () => {
    const text = renderOverview(overview, options)
    expect(text).toContain('DeepSeek 账户总览')
    expect(text).toContain('累计花费 ¥0.50')
    expect(text).toContain('累计 Token 187')
    expect(text).toContain('Key 2 个')
    expect(text).toContain('1. 示例A sk-abcde**1234')
    expect(text).not.toContain('2. 示例B')
    expect(text).toContain('还有 1 个 Key 未展示')
    expect(text).toContain('（已绑定）')
  })
})

describe('markdown renderers', () => {
  it('renders a markdown report', () => {
    const text = renderReportMarkdown(report, options)
    expect(text).toContain('**DeepSeek API用量**')
    expect(text).toContain('- **API-1**：`sk-abcde**1234`')
    expect(text).toContain('  - 名称：示例A')
    expect(text).toContain('  - 余额 ¥12.50（赠金 ¥2.50 / 充值 ¥10.00）')
    expect(text).toContain('  - 累计花费 ¥0.030 · Token 187')
    expect(text).toContain('    - 输入 165（命中 110 / 未命中 55）')
    expect(text).not.toContain('**累计**')
  })

  it('renders a markdown overview', () => {
    const overview: AccountOverview = {
      keys: [{ key, total: report.total, today: report.today }],
      total: report.total,
      accountCost: 0.5,
      accountTokens: 187,
      balance: report.balance,
      updatedAt: report.updatedAt,
    }
    const text = renderOverviewMarkdown(overview, options)
    expect(text).toContain('# DeepSeek 账户总览')
    expect(text).toContain('**累计花费** ¥0.50')
    expect(text).toContain('1. **示例A** `sk-abcde**1234`')
  })

  it('renders a markdown binding list', () => {
    const text = renderBindingListMarkdown(
      [
        {
          trackingId: 'tk_1',
          name: '示例A',
          sensitiveId: 'sk-abcde**1234',
          boundAt: 0,
          boundBy: 'qq:user-1',
        },
      ],
      options,
    )
    expect(text).toContain('# 我绑定的 Key')
    expect(text).toContain('1. **示例A** `sk-abcde**1234`')
  })
})

describe('buildQQKeyboard', () => {
  it('builds a button that fills the command into the input box', () => {
    const keyboard = buildQQKeyboard([{ label: '查看 1', command: 'dsu 1' }])
    const button = keyboard.content.rows[0].buttons[0]
    expect(button.render_data.label).toBe('查看 1')
    expect(button.action.type).toBe(2)
    expect(button.action.data).toBe('dsu 1')
    expect(button.action.enter).toBe(false)
    expect(button.action.permission).toEqual({ type: 2 })
  })

  it('can send directly and wraps after five buttons', () => {
    const buttons = Array.from({ length: 7 }, (_, index) => ({
      label: `查看 ${index + 1}`,
      command: `dsu ${index + 1}`,
    }))
    const keyboard = buildQQKeyboard(buttons, true)
    expect(keyboard.content.rows).toHaveLength(2)
    expect(keyboard.content.rows[0].buttons).toHaveLength(5)
    expect(keyboard.content.rows[1].buttons).toHaveLength(2)
    expect(keyboard.content.rows[0].buttons[0].action.enter).toBe(true)
  })
})

describe('cmdInput', () => {
  it('fills a slash-prefixed command by default', () => {
    expect(cmdInput('dsu 1', '详情')).toBe('<qqbot-cmd-input text="/dsu 1" show="详情" reference="false"/>')
  })

  it('respects a custom prefix', () => {
    expect(cmdInput('dsu 1', '详情', '')).toContain('text="dsu 1"')
    expect(cmdInput('dsu 1', '详情', '.')).toContain('text=".dsu 1"')
  })
})

describe('flattenText', () => {
  it('reads the text Koishi wraps into attrs.content', () => {
    const element = h('qq:rawmarkdown-without-keyboard', {}, 'hello world')
    expect(flattenText(element)).toBe('hello world')
  })

  it('handles plain strings and nested elements', () => {
    expect(flattenText('abc')).toBe('abc')
    expect(flattenText(h('message', {}, [h('quote', { id: '1' }), h('text', { content: '正文' })]))).toBe('正文')
  })
})

describe('registerRenderer', () => {
  it('falls back to the default renderer', () => {
    const renderer = resolveRenderer('telegram')
    expect(renderer.report(report, { ...options, platform: 'telegram' })).toContain('DeepSeek API用量')
  })

  it('allows overriding a platform', () => {
    registerRenderer('custom-platform', { report: () => 'custom-report' })
    expect(renderReport(report, { ...options, platform: 'custom-platform' })).toBe('custom-report')
    expect(renderReport(report, { ...options, platform: 'qq' })).not.toBe('custom-report')
  })
})
