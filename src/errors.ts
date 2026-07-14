export type ToggleFlowErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_ARGUMENT'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'API_ERROR';

interface ToggleFlowErrorOptions {
  code: ToggleFlowErrorCode;
  statusCode?: number;
  cause?: unknown;
}

export class ToggleFlowError extends Error {
  readonly code: ToggleFlowErrorCode;
  readonly statusCode: number | undefined;

  constructor(
    message: string,
    options: ToggleFlowErrorOptions
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : { cause: options.cause }
    );

    this.name = 'ToggleFlowError';
    this.code = options.code;
    this.statusCode = options.statusCode;
  }
}

export function isToggleFlowError(
  error: unknown
): error is ToggleFlowError {
  return error instanceof ToggleFlowError;
}