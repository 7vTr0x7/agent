export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public override readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      code?: string;
      statusCode?: number;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.statusCode = options.statusCode ?? 500;
    this.cause = options.cause;
  }
}
