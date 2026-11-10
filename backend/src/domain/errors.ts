export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = (m = 'not allowed for this role') => new AppError(403, 'forbidden', m);
export const notFound = (m = 'not found') => new AppError(404, 'not_found', m);
export const conflict = (m: string, extra?: Record<string, unknown>) => new AppError(409, 'conflict', m, extra);
export const badRequest = (m: string, extra?: Record<string, unknown>) => new AppError(400, 'bad_request', m, extra);
