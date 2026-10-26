import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 纯 JS 的 LevelDB 读取器，只做一件很小的事：
 * 读出 Key-Value，用于从 Edge/Chrome 的 LocalStorage 里找 userToken。
 *
 * 这样就不需要 classic-level 原生依赖，安装体积和平台安全扫描都更友好。
 */

export interface LevelEntry {
  key: Buffer
  value: Buffer
}

function readVarint(buffer: Buffer, position: number): [number, number] {
  let result = 0
  let shift = 0
  let pos = position
  while (pos < buffer.length) {
    const byte = buffer[pos++]
    result += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return [result, pos]
    shift += 7
    if (shift > 49) break
  }
  throw new Error('invalid varint')
}

function snappyUncompress(input: Buffer): Buffer {
  let [length, pos] = readVarint(input, 0)
  const output = Buffer.allocUnsafe(length)
  let out = 0

  while (pos < input.length) {
    const tag = input[pos++]
    const type = tag & 3

    if (type === 0) {
      let literalLength = tag >> 2
      if (literalLength < 60) {
        literalLength += 1
      } else {
        const byteCount = literalLength - 59
        literalLength = 0
        for (let i = 0; i < byteCount; i++) {
          literalLength += input[pos++] * 2 ** (8 * i)
        }
        literalLength += 1
      }
      input.copy(output, out, pos, pos + literalLength)
      pos += literalLength
      out += literalLength
      continue
    }

    let copyLength: number
    let offset: number
    if (type === 1) {
      copyLength = ((tag >> 2) & 0x7) + 4
      offset = ((tag & 0xe0) << 3) | input[pos++]
    } else if (type === 2) {
      copyLength = (tag >> 2) + 1
      offset = input[pos] | (input[pos + 1] << 8)
      pos += 2
    } else {
      copyLength = (tag >> 2) + 1
      offset = input.readUInt32LE(pos)
      pos += 4
    }

    for (let i = 0; i < copyLength; i++) {
      output[out] = output[out - offset]
      out++
    }
  }

  return output.subarray(0, out)
}

interface BlockHandle {
  offset: number
  size: number
}

function readHandle(buffer: Buffer, position: number): [BlockHandle, number] {
  const [offset, next] = readVarint(buffer, position)
  const [size, end] = readVarint(buffer, next)
  return [{ offset, size }, end]
}

function readBlock(file: Buffer, handle: BlockHandle): LevelEntry[] {
  const raw = file.subarray(handle.offset, handle.offset + handle.size)
  const compression = file[handle.offset + handle.size]
  const content = compression === 1 ? snappyUncompress(raw) : raw
  if (content.length < 4) return []

  const restartCount = content.readUInt32LE(content.length - 4)
  const restartsStart = content.length - 4 * (restartCount + 1)
  const entries: LevelEntry[] = []
  let pos = 0
  let lastKey = Buffer.alloc(0)

  while (pos < restartsStart) {
    const [shared, p1] = readVarint(content, pos)
    const [nonShared, p2] = readVarint(content, p1)
    const [valueLength, p3] = readVarint(content, p2)
    pos = p3

    const key = Buffer.concat([lastKey.subarray(0, shared), content.subarray(pos, pos + nonShared)])
    pos += nonShared
    const value = content.subarray(pos, pos + valueLength)
    pos += valueLength
    entries.push({ key, value })
    lastKey = key
  }

  return entries
}

function readTable(file: Buffer): LevelEntry[] {
  if (file.length < 48) return []
  const footer = file.subarray(file.length - 48)
  let pos = 0
  const [, p1] = readHandle(footer, pos)
  const [indexHandle] = readHandle(footer, p1)

  const entries: LevelEntry[] = []
  for (const entry of readBlock(file, indexHandle)) {
    const [dataHandle] = readHandle(entry.value, 0)
    for (const item of readBlock(file, dataHandle)) {
      // Internal key = user key + 8-byte sequence/type trailer
      entries.push({ key: item.key.subarray(0, Math.max(0, item.key.length - 8)), value: item.value })
    }
  }
  return entries
}

function readLog(file: Buffer): LevelEntry[] {
  const BLOCK_SIZE = 32768
  const entries: LevelEntry[] = []
  let pending: Buffer | null = null

  const applyBatch = (batch: Buffer) => {
    if (batch.length < 12) return
    let pos = 12 // sequence (8) + count (4)
    for (let i = 0; i < batch.readUInt32LE(8); i++) {
      if (pos >= batch.length) break
      const tag = batch[pos++]
      if (tag === 1) {
        const [keyLength, p1] = readVarint(batch, pos)
        const key = batch.subarray(p1, p1 + keyLength)
        const [valueLength, p2] = readVarint(batch, p1 + keyLength)
        const value = batch.subarray(p2, p2 + valueLength)
        entries.push({ key, value })
        pos = p2 + valueLength
      } else if (tag === 0) {
        const [keyLength, p1] = readVarint(batch, pos)
        pos = p1 + keyLength
      } else {
        break
      }
    }
  }

  for (let blockStart = 0; blockStart < file.length; blockStart += BLOCK_SIZE) {
    const block = file.subarray(blockStart, Math.min(blockStart + BLOCK_SIZE, file.length))
    let pos = 0
    while (pos + 7 <= block.length) {
      const length = block.readUInt16LE(pos + 4)
      const type = block[pos + 6]
      if (length === 0 && type === 0) break
      const fragment = block.subarray(pos + 7, pos + 7 + length)
      pos += 7 + length

      if (type === 1) {
        applyBatch(fragment)
        pending = null
      } else if (type === 2) {
        pending = fragment
      } else if (type === 3 && pending) {
        pending = Buffer.concat([pending, fragment])
      } else if (type === 4) {
        applyBatch(pending ? Buffer.concat([pending, fragment]) : fragment)
        pending = null
      }
    }
  }

  return entries
}

function fileNumber(name: string): number {
  const match = /^(\d+)\.(ldb|log)$/.exec(name)
  return match ? Number(match[1]) : 0
}

/** 读取一个 LevelDB 目录，返回最新写入的 Key-Value。 */
export async function readLevelDb(directory: string): Promise<LevelEntry[]> {
  let files: string[]
  try {
    files = await fs.readdir(directory)
  } catch {
    return []
  }

  files = files
    .filter((name) => /\.(ldb|log)$/.test(name))
    .sort((a, b) => fileNumber(a) - fileNumber(b) || a.localeCompare(b))

  const merged = new Map<string, LevelEntry>()
  for (const name of files) {
    let buffer: Buffer
    try {
      buffer = await fs.readFile(path.join(directory, name))
    } catch {
      continue
    }
    const entries = name.endsWith('.log') ? readLog(buffer) : readTable(buffer)
    for (const entry of entries) {
      merged.set(entry.key.toString('latin1'), entry)
    }
  }

  return [...merged.values()]
}
