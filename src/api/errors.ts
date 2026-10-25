export type PlatformErrorKind = 'auth' | 'config' | 'network' | 'rate-limit' | 'api' | 'invalid-key'

/** 统一的平台接口错误。 */
export class PlatformError extends Error {
  constructor(
    message: string,
    public readonly kind: PlatformErrorKind,
    public readonly code?: number,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}

export function isPlatformError(error: unknown): error is PlatformError {
  return error instanceof PlatformError
}
