import type { Config } from './config'

export type PermissionConfig = Pick<Config, 'adminUsers' | 'adminAuthority'>

/**
 * 管理员判定：白名单和 Koishi 权限等级取并集。
 * 满足任意一条即为管理员，任何一种机制失效时另一种仍能兜底。
 */
export function isAdminUser(
  platform: string,
  userId: string | undefined,
  authority: number,
  config: PermissionConfig,
): boolean {
  const raw = String(userId ?? '').trim()
  if (!raw) return false

  const candidates = new Set([raw, `${platform}:${raw}`])
  for (const entry of config.adminUsers ?? []) {
    if (candidates.has(entry.trim())) return true
  }

  return (authority ?? 0) >= config.adminAuthority
}
