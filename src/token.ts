import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { LoggerLike } from './store'
import { readLevelDb } from './leveldb'

const TOKEN_PATTERN = /\{"value":"([A-Za-z0-9+/_.\-]{16,400})","__version":"?\d+"?\}/g
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const MAX_FILE_SIZE = 64 * 1024 * 1024
const MAX_CANDIDATES = 30

/** 去掉 localStorage 里可能带上的引号、Bearer 前缀。 */
export function sanitizeToken(raw: string | undefined | null): string {
  let text = (raw ?? '').trim()
  text = text.replace(/^["']+|["']+$/g, '').trim()
  text = text.replace(/^Bearer\s+/i, '').trim()
  return text.replace(/^["']+|["']+$/g, '').trim()
}

/** 从浏览器 Local Storage 的 LevelDB 文件里提取所有可能的 token。 */
export function extractTokenCandidates(buffer: Buffer): string[] {
  const found = new Set<string>()
  for (const text of [buffer.toString('latin1'), buffer.toString('utf16le')]) {
    for (const pattern of [TOKEN_PATTERN, JWT_PATTERN]) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text))) {
        const value = match[1] ?? match[0]
        if (value) found.add(value)
      }
    }
  }
  return [...found]
}

function browserRoots(): string[] {
  const local = process.env.LOCALAPPDATA
  if (!local) return []
  return [
    path.join(local, 'Microsoft', 'Edge', 'User Data'),
    path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
  ]
}

async function listProfiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name === 'Default' || name.startsWith('Profile') || name === 'Guest Profile')
  } catch {
    return []
  }
}

export interface ScanOptions {
  roots?: string[]
  /** 用平台接口验证候选 token 是否有效 */
  validate: (token: string) => Promise<boolean>
  maxCandidates?: number
  logger?: LoggerLike
}

function decodeStorageValue(value: Buffer): string {
  if (!value.length) return ''
  const marker = value[0]
  let text: string
  if (marker === 0) text = value.subarray(1).toString('utf16le')
  else if (marker === 1) text = value.subarray(1).toString('utf8')
  else text = value.toString('utf8')
  try {
    const parsed = JSON.parse(text)
    const token = typeof parsed === 'string' ? parsed : parsed?.value
    return typeof token === 'string' ? sanitizeToken(token) : ''
  } catch {
    return ''
  }
}

/**
 * 用纯 JS 的 LevelDB 读取器精确取出 platform.deepseek.com 的 userToken。
 * 不依赖原生模块，也不会复制/修改浏览器文件。
 */
async function readLevelDbTokens(dir: string, logger?: LoggerLike): Promise<string[]> {
  try {
    const entries = await readLevelDb(dir)
    const tokens: string[] = []
    for (const entry of entries) {
      const keyText = entry.key.toString('latin1')
      if (!keyText.includes('platform.deepseek.com') || !keyText.endsWith('userToken')) continue
      const token = decodeStorageValue(entry.value)
      if (token) tokens.push(token)
    }
    return tokens
  } catch (error) {
    logger?.debug?.(`读取浏览器 LevelDB 失败：${(error as Error).message}`)
    return []
  }
}

/**
 * 扫描本机 Edge / Chrome 的 Local Storage，找出能登录 DeepSeek 平台的 token。
 * 只会用平台接口验证，不会把文件内容发到其他地方。
 */
export async function scanBrowserTokens(options: ScanOptions): Promise<string | null> {
  const roots = options.roots ?? browserRoots()
  const candidates: string[] = []
  const seen = new Set<string>()

  const add = (token: string) => {
    if (seen.has(token)) return
    seen.add(token)
    candidates.push(token)
  }

  const levelDirs: string[] = []
  for (const root of roots) {
    for (const profile of await listProfiles(root)) {
      levelDirs.push(path.join(root, profile, 'Local Storage', 'leveldb'))
    }
  }

  // 优先用 LevelDB 精确读取，能处理平台网页里的前缀压缩
  for (const dir of levelDirs) {
    for (const token of await readLevelDbTokens(dir, options.logger)) add(token)
  }

  // 读取器不可用时退回原始的字符串扫描
  if (candidates.length === 0) {
    for (const dir of levelDirs) {
      let files: string[]
      try {
        files = await fs.readdir(dir)
      } catch {
        continue
      }
      for (const file of files) {
        if (!/\.(ldb|log)$/.test(file)) continue
        const full = path.join(dir, file)
        let buffer: Buffer
        try {
          const stat = await fs.stat(full)
          if (stat.size > MAX_FILE_SIZE) continue
          buffer = await fs.readFile(full)
        } catch {
          continue
        }
        for (const token of extractTokenCandidates(buffer)) add(token)
      }
    }
  }

  options.logger?.debug?.(`浏览器 Token 候选数量：${candidates.length}`)
  const limit = options.maxCandidates ?? MAX_CANDIDATES
  for (const token of candidates.slice(0, limit)) {
    if (await options.validate(token)) {
      options.logger?.info?.(`已从本机浏览器读取到平台 Token（${maskToken(token)}）`)
      return token
    }
  }
  return null
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '****'
  return `${token.slice(0, 4)}****${token.slice(-4)}`
}

export async function readTokenFile(file: string): Promise<string> {
  try {
    return sanitizeToken(await fs.readFile(file, 'utf8'))
  } catch {
    return ''
  }
}

export async function writeTokenFile(file: string, token: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await fs.writeFile(temp, token, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temp, file)
}

/** 把 Token 写进项目根目录的 .env，已存在则替换。 */
export async function upsertEnvToken(file: string, token: string): Promise<void> {
  let text = ''
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    text = ''
  }
  const line = `DEEPSEEK_PLATFORM_TOKEN=${token}`
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((item) => /^\s*DEEPSEEK_PLATFORM_TOKEN\s*=/.test(item))
  if (index >= 0) {
    lines[index] = line
  } else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push(line, '')
  }
  await fs.writeFile(file, lines.join('\n'), 'utf8')
}

export interface TokenManagerOptions {
  configToken?: string
  envToken?: string
  tokenFile: string
  autoRead: boolean
  baseUrl: string
  timeout?: number
  logger?: LoggerLike
  fetchImpl?: typeof fetch
}

/**
 * 平台 Token 的解析顺序：配置 → 环境变量 → 本地缓存文件 → 自动扫描浏览器。
 * 扫描结果会写进缓存文件，之后启动就不必再扫。
 */
export class TokenManager {
  private cached = ''
  private pending?: Promise<string>

  constructor(private readonly options: TokenManagerOptions) {}

  getToken(): Promise<string> {
    if (this.cached) return Promise.resolve(this.cached)
    this.pending ??= this.resolve().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  /** 强制重新扫描本机浏览器，忽略配置里的 Token。 */
  async scanNow(): Promise<string | null> {
    const token = await scanBrowserTokens({
      validate: (candidate) => this.validate(candidate),
      logger: this.options.logger,
    })
    if (token) {
      this.cached = token
      await writeTokenFile(this.options.tokenFile, token).catch((error) => {
        this.options.logger?.warn?.(`保存 Token 失败：${(error as Error).message}`)
      })
    }
    return token
  }

  clear(): void {
    this.cached = ''
  }

  private async resolve(): Promise<string> {
    const manual = sanitizeToken(this.options.configToken) || sanitizeToken(this.options.envToken)
    if (manual) return manual

    const cached = await readTokenFile(this.options.tokenFile)
    if (cached) return cached

    if (!this.options.autoRead) return ''
    return (await this.scanNow()) ?? ''
  }

  private async validate(token: string): Promise<boolean> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    try {
      const response = await fetchImpl(new URL('/api/v0/users/get_api_keys', this.options.baseUrl).toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.options.timeout ?? 8000),
      })
      if (!response.ok) return false
      const body = (await response.json()) as { code?: number; data?: { biz_code?: number } }
      return body?.code === 0 && body?.data?.biz_code === 0
    } catch {
      return false
    }
  }
}

export function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false
  const normalized = ip.replace(/^::ffff:/, '')
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

export function defaultTokenFile(baseDir: string): string {
  return path.join(baseDir, 'data', 'deepseek-keyusage', 'token')
}

export function userDataDir(baseDir: string): string {
  return path.join(baseDir, 'data', 'deepseek-keyusage')
}
