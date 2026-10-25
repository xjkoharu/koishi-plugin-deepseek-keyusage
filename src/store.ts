import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { Binding } from './types'

export interface LoggerLike {
  debug?(...args: any[]): void
  info?(...args: any[]): void
  warn?(...args: any[]): void
  error?(...args: any[]): void
}

interface StoreFile {
  version: number
  bindings: Record<string, Binding[]>
}

const STORE_VERSION = 2

/**
 * 绑定关系持久化。一个用户可以绑定多个 Key。
 * 数据量很小（一个群/一个账号几十人），用单个 JSON 文件即可，不强制用户安装数据库插件。
 */
export class BindingStore {
  private data: StoreFile = { version: STORE_VERSION, bindings: {} }
  private loadPromise?: Promise<void>
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly logger?: LoggerLike,
  ) {}

  ready(): Promise<void> {
    this.loadPromise ??= this.load()
    return this.loadPromise
  }

  get(userId: string): Binding[] {
    return this.data.bindings[userId] ?? []
  }

  list(): Array<[string, Binding[]]> {
    return Object.entries(this.data.bindings)
  }

  findByTrackingId(trackingId: string): Binding | undefined {
    for (const bindings of Object.values(this.data.bindings)) {
      const found = bindings.find((binding) => binding.trackingId === trackingId)
      if (found) return found
    }
    return undefined
  }

  findAllByTrackingId(trackingId: string): Binding[] {
    const result: Binding[] = []
    for (const bindings of Object.values(this.data.bindings)) {
      for (const binding of bindings) {
        if (binding.trackingId === trackingId) result.push(binding)
      }
    }
    return result
  }

  async add(userId: string, binding: Binding): Promise<Binding[]> {
    await this.ready()
    const bindings = this.data.bindings[userId] ?? []
    if (!bindings.some((item) => item.trackingId === binding.trackingId)) {
      bindings.push(binding)
    }
    this.data.bindings[userId] = bindings
    await this.persist()
    return bindings
  }

  async remove(userId: string, trackingId: string): Promise<boolean> {
    await this.ready()
    const bindings = this.data.bindings[userId]
    if (!bindings) return false
    const next = bindings.filter((item) => item.trackingId !== trackingId)
    if (next.length === bindings.length) return false
    if (next.length) this.data.bindings[userId] = next
    else delete this.data.bindings[userId]
    await this.persist()
    return true
  }

  async removeAll(userId: string): Promise<number> {
    await this.ready()
    const bindings = this.data.bindings[userId]
    if (!bindings?.length) return 0
    delete this.data.bindings[userId]
    await this.persist()
    return bindings.length
  }

  private async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(content) as Partial<StoreFile> & { bindings?: Record<string, Binding | Binding[]> }
      if (parsed && typeof parsed === 'object' && parsed.bindings && typeof parsed.bindings === 'object') {
        const bindings: Record<string, Binding[]> = {}
        for (const [userId, value] of Object.entries(parsed.bindings)) {
          if (Array.isArray(value)) {
            if (value.length) bindings[userId] = value
          } else if (value) {
            // 兼容 v1 的单绑定格式
            bindings[userId] = [value]
          }
        }
        this.data = { version: STORE_VERSION, bindings }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        this.logger?.warn?.(`读取绑定数据失败（${this.file}）：${(error as Error).message}`)
      }
    }
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2)
    this.queue = this.queue
      .then(async () => {
        await fs.mkdir(dirname(this.file), { recursive: true })
        const temp = `${this.file}.tmp`
        await fs.writeFile(temp, snapshot, 'utf8')
        await fs.rename(temp, this.file)
      })
      .catch((error) => {
        this.logger?.error?.(`写入绑定数据失败（${this.file}）：${(error as Error).message}`)
      })
    return this.queue
  }
}
