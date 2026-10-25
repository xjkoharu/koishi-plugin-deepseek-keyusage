import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BindingStore } from '../src/store'
import type { Binding } from '../src/types'

const binding: Binding = {
  trackingId: 'tk_1',
  name: '示例A',
  sensitiveId: 'sk-abcde**1234',
  boundAt: 1700000000000,
  boundBy: 'qq:user-1',
}

const second: Binding = {
  trackingId: 'tk_2',
  name: '示例B',
  sensitiveId: 'sk-klmno**9012',
  boundAt: 1700000000001,
  boundBy: 'qq:user-1',
}

describe('BindingStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsu-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists multiple bindings per user', async () => {
    const file = join(dir, 'nested', 'bindings.json')
    const store = new BindingStore(file)
    await store.add('qq:user-1', binding)
    await store.add('qq:user-1', second)

    const reloaded = new BindingStore(file)
    await reloaded.ready()
    expect(reloaded.get('qq:user-1')).toEqual([binding, second])
    expect(reloaded.findByTrackingId('tk_2')?.name).toBe('示例B')
    expect(reloaded.findAllByTrackingId('tk_2')).toHaveLength(1)
  })

  it('removes one binding', async () => {
    const store = new BindingStore(join(dir, 'bindings.json'))
    await store.add('qq:user-1', binding)
    await store.add('qq:user-1', second)
    expect(await store.remove('qq:user-1', 'tk_1')).toBe(true)
    expect(store.get('qq:user-1')).toEqual([second])
    expect(await store.remove('qq:user-1', 'tk_1')).toBe(false)
  })

  it('removes all bindings', async () => {
    const store = new BindingStore(join(dir, 'bindings.json'))
    await store.add('qq:user-1', binding)
    await store.add('qq:user-1', second)
    expect(await store.removeAll('qq:user-1')).toBe(2)
    expect(store.get('qq:user-1')).toEqual([])
  })

  it('migrates the old single-binding format', async () => {
    const file = join(dir, 'bindings.json')
    await writeFile(file, JSON.stringify({ version: 1, bindings: { 'qq:user-1': binding } }), 'utf8')
    const store = new BindingStore(file)
    await store.ready()
    expect(store.get('qq:user-1')).toEqual([binding])

    await store.add('qq:user-1', second)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.version).toBe(2)
    expect(saved.bindings['qq:user-1']).toHaveLength(2)
  })

  it('treats a missing file as empty', async () => {
    const store = new BindingStore(join(dir, 'missing.json'))
    await store.ready()
    expect(store.list()).toEqual([])
  })
})
