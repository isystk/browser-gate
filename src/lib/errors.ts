/** API が返すエラーコードと HTTP ステータスの対応表。 */
export const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN_PROFILE: 403,
  FORBIDDEN_USER: 403,
  FORBIDDEN_DOMAIN: 403,
  BLOCKED_URL: 400,
  INVALID_REQUEST: 400,
  PROFILE_NOT_FOUND: 404,
  SESSION_EXPIRED: 409,
  PROFILE_BUSY: 409,
  TIMEOUT: 504,
  NAVIGATION_FAILED: 502,
  RESPONSE_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** クライアントへ返すエラーコードを持つアプリケーション例外。 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): (typeof ERROR_STATUS)[ErrorCode] {
    return ERROR_STATUS[this.code];
  }
}
