import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TokenManager,
  extractTokenCandidates,
  readTokenFile,
  sanitizeToken,
  scanBrowserTokens,
  upsertEnvToken,
  writeTokenFile,
} from '../src/token'

const TOKEN = '3xCpmMZnHf0qISvTQqkPBGQWFmAmjv7NEObY6kdcTS/tC4E2NdNIGdoCxdFLW66U'

describe('sanitizeToken', () => {
  it('strips Bearer prefix and quotes', () => {
    expect(sanitizeToken(`"Bearer ${TOKEN}"`)).toBe(TOKEN)
    expect(sanitizeToken(`'${TOKEN}'`)).toBe(TOKEN)
  })
})

describe('extractTokenCandidates', () => {
  it('finds localStorage JSON values and JWTs', () => {
    const buffer = Buffer.from(
      `xx_https://platform.deepseek.com\x00\x01userToken\x01{"value":"${TOKEN}","__version":"0"}yy` +
        ' eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz',
      'latin1',
    )
    const candidates = extractTokenCandidates(buffer)
    expect(candidates).toContain(TOKEN)
    expect(candidates.some((item) => item.startsWith('eyJ'))).toBe(true)
  })
})

describe('token file', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsu-token-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes and reads a token', async () => {
    const file = join(dir, 'nested', 'token')
    await writeTokenFile(file, TOKEN)
    expect(await readTokenFile(file)).toBe(TOKEN)
  })

  it('returns empty for a missing file', async () => {
    expect(await readTokenFile(join(dir, 'missing'))).toBe('')
  })

  it('replaces the token line in .env', async () => {
    const file = join(dir, '.env')
    await writeFile(file, 'FOO=1\nDEEPSEEK_PLATFORM_TOKEN=old\nBAR=2\n', 'utf8')
    await upsertEnvToken(file, TOKEN)
    const text = await readFile(file, 'utf8')
    expect(text).toContain(`DEEPSEEK_PLATFORM_TOKEN=${TOKEN}`)
    expect(text).toContain('FOO=1')
    expect(text).toContain('BAR=2')
    expect(text).not.toContain('old')
  })

  it('appends the token line when missing', async () => {
    const file = join(dir, '.env')
    await writeFile(file, 'FOO=1\n', 'utf8')
    await upsertEnvToken(file, TOKEN)
    const text = await readFile(file, 'utf8')
    expect(text.split('\n')).toContain(`DEEPSEEK_PLATFORM_TOKEN=${TOKEN}`)
  })
})

describe('TokenManager', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsu-manager-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const create = (options: Partial<ConstructorParameters<typeof TokenManager>[0]> = {}) =>
    new TokenManager({
      tokenFile: join(dir, 'token'),
      autoRead: false,
      baseUrl: 'https://platform.deepseek.com',
      ...options,
    })

  it('prefers the configured token', async () => {
    await writeTokenFile(join(dir, 'token'), 'file-token')
    const manager = create({ configToken: TOKEN })
    expect(await manager.getToken()).toBe(TOKEN)
  })

  it('falls back to the token file', async () => {
    await writeTokenFile(join(dir, 'token'), TOKEN)
    expect(await create().getToken()).toBe(TOKEN)
  })

  it('returns empty when nothing is configured and auto read is off', async () => {
    expect(await create().getToken()).toBe('')
  })
})

describe('scanBrowserTokens', () => {
  it('returns null when no browser profile exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsu-browser-'))
    const tried: string[] = []
    const result = await scanBrowserTokens({
      roots: [join(root, 'missing-root')],
      validate: async (token) => {
        tried.push(token)
        return false
      },
    })
    expect(result).toBeNull()
    expect(tried).toHaveLength(0)
    await rm(root, { recursive: true, force: true })
  })
})
