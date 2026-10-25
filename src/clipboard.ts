import { spawn } from 'node:child_process'

/**
 * 把文本复制到系统剪贴板。
 * bot 和浏览器在同一台电脑时，服务端直接操作剪贴板比浏览器里点按钮更省事。
 */
export function copyToClipboard(text: string): Promise<boolean> {
  const command = process.platform === 'win32' ? 'clip.exe' : process.platform === 'darwin' ? 'pbcopy' : 'xclip'
  const args = process.platform === 'linux' ? ['-selection', 'clipboard'] : []

  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
      const timer = setTimeout(() => {
        child.kill()
        finish(false)
      }, 2000)
      child.on('error', () => {
        clearTimeout(timer)
        finish(false)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        finish(code === 0)
      })
      child.stdin.end(text)
    } catch {
      finish(false)
    }
  })
}
