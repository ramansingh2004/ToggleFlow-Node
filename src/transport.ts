import {
  ToggleFlowError,
  isToggleFlowError,
  type ToggleFlowErrorCode,
} from './errors.js';

import type {
  ApiErrorResponse,
  ApiSuccess,
} from './types.js';
import {
  TOGGLEFLOW_SDK_VERSION,
} from './version.js';

interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImplementation: typeof fetch;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

type Query = Record<
  string,
  string | undefined
>;

export class HttpTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(options: TransportOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs;
    this.fetchImplementation =
      options.fetchImplementation;
    this.maxRetries = options.maxRetries;
    this.retryBaseDelayMs =
      options.retryBaseDelayMs;
    this.retryMaxDelayMs =
      options.retryMaxDelayMs;
  }

  async getData<T>(
    path: string,
    query: Query = {},
    signal?: AbortSignal
  ): Promise<T> {
    const body = await this.request(
      path,
      query,
      true,
      signal
    );

    if (!isSuccessEnvelope<T>(body)) {
      throw new ToggleFlowError(
        'ToggleFlow returned an invalid success response.',
        {
          code: 'INVALID_RESPONSE',
        }
      );
    }

    return body.data;
  }

  async postData<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  const responseBody = await this.request(
    path,
    {},
    true,
    signal,
    'POST',
    body
  );

  if (!isSuccessEnvelope<T>(responseBody)) {
    throw new ToggleFlowError(
      'ToggleFlow returned an invalid success response.',
      {
        code: 'INVALID_RESPONSE',
      }
    );
  }

  return responseBody.data;
}

  async getPublic<T>(
    path: string,
    query: Query = {},
    signal?: AbortSignal
  ): Promise<T> {
    return (await this.request(
      path,
      query,
      false,
      signal
    )) as T;
  }

  private async request(
    path: string,
    query: Query,
    authenticated: boolean,
    signal?: AbortSignal,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown
  ): Promise<unknown> {
    let retryNumber = 0;

    while (true) {
      try {
        return await this.requestOnce(
          path,
          query,
          authenticated,
          signal,
          method,
          body
        );
      } catch (error) {
        const normalizedError =
          normalizeTransportError(error);

        const canRetry =
          retryNumber < this.maxRetries &&
          isRetryable(normalizedError) &&
          !signal?.aborted;

        if (!canRetry) {
          throw normalizedError;
        }

        const delay = calculateRetryDelay(
          normalizedError,
          retryNumber,
          this.retryBaseDelayMs,
          this.retryMaxDelayMs
        );

        retryNumber += 1;

        await waitForRetry(delay, signal);
      }
    }
  }

  private async requestOnce(
    path: string,
    query: Query,
    authenticated: boolean,
    externalSignal?: AbortSignal,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown
  ): Promise<unknown> {
    const url = this.createUrl(path, query);
    const controller = new AbortController();

    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    const abortFromCaller = () => {
      controller.abort(externalSignal?.reason);
    };

    if (externalSignal?.aborted) {
      clearTimeout(timeoutId);

      throw new ToggleFlowError(
        'ToggleFlow request was aborted.',
        {
          code: 'REQUEST_ABORTED',
          cause: externalSignal.reason,
        }
      );
    }

    externalSignal?.addEventListener(
      'abort',
      abortFromCaller,
      { once: true }
    );

    try {
      const headers = new Headers({
        Accept: 'application/json',
        'User-Agent': `@toggleflow/node/${TOGGLEFLOW_SDK_VERSION}`,
        'X-ToggleFlow-SDK': 'node',
        'X-ToggleFlow-SDK-Version':
        TOGGLEFLOW_SDK_VERSION,
      });

      if (authenticated) {
        headers.set(
          'Authorization',
          `Bearer ${this.apiKey}`
        );
      }

      if (body !== undefined) {
  headers.set(
    'Content-Type',
    'application/json'
  );
}

const requestInit: RequestInit = {
  method,
  headers,
  signal: controller.signal,
  ...(body === undefined
    ? {}
    : {
        body: JSON.stringify(body),
      }),
};

const response =
  await this.fetchImplementation(
    url,
    requestInit
  );

const responseBody =
  await parseResponse(response);

if (!response.ok) {
  throw createApiError(
    response.status,
    responseBody,
    response.headers
  );
}

return responseBody;
    } catch (error) {
      if (isToggleFlowError(error)) {
        throw error;
      }

      if (timedOut) {
        throw new ToggleFlowError(
          `ToggleFlow request timed out after ${this.timeoutMs}ms.`,
          {
            code: 'TIMEOUT',
            cause: error,
          }
        );
      }

      if (
        externalSignal?.aborted ||
        controller.signal.aborted
      ) {
        throw new ToggleFlowError(
          'ToggleFlow request was aborted.',
          {
            code: 'REQUEST_ABORTED',
            cause: error,
          }
        );
      }

      throw new ToggleFlowError(
        'Unable to connect to ToggleFlow.',
        {
          code: 'NETWORK_ERROR',
          cause: error,
        }
      );
    } finally {
      clearTimeout(timeoutId);

      externalSignal?.removeEventListener(
        'abort',
        abortFromCaller
      );
    }
  }

  private createUrl(
    path: string,
    query: Query
  ): URL {
    const normalizedPath = path.startsWith('/')
      ? path
      : `/${path}`;

    const url = new URL(
      `${this.baseUrl}${normalizedPath}`
    );

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    return url;
  }
}

async function parseResponse(
  response: Response
): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    if (!response.ok) {
      return undefined;
    }

    throw new ToggleFlowError(
      'ToggleFlow returned an empty response.',
      {
        code: 'INVALID_RESPONSE',
        statusCode: response.status,
      }
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    /*
     * A non-JSON 5xx response should still become an API
     * error so it remains eligible for retry.
     */
    if (!response.ok) {
      return undefined;
    }

    throw new ToggleFlowError(
      'ToggleFlow returned a non-JSON response.',
      {
        code: 'INVALID_RESPONSE',
        statusCode: response.status,
        cause: error,
      }
    );
  }
}

function createApiError(
  statusCode: number,
  body: unknown,
  headers: Headers
): ToggleFlowError {
  const message = isApiErrorResponse(body)
    ? body.error.message
    : `ToggleFlow returned HTTP ${statusCode}.`;

  let code: ToggleFlowErrorCode = 'API_ERROR';

  if (statusCode === 401 || statusCode === 403) {
    code = 'UNAUTHORIZED';
  } else if (statusCode === 404) {
    code = 'NOT_FOUND';
  }

  const retryAfterMs = parseRetryAfter(
    headers.get('Retry-After')
  );

  return new ToggleFlowError(message, {
    code,
    statusCode,
    ...(retryAfterMs === undefined
      ? {}
      : { retryAfterMs }),
  });
}

function parseRetryAfter(
  value: string | null
): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (
    Number.isFinite(seconds) &&
    seconds >= 0
  ) {
    return seconds * 1_000;
  }

  const retryDate = Date.parse(value);

  if (Number.isNaN(retryDate)) {
    return undefined;
  }

  return Math.max(
    0,
    retryDate - Date.now()
  );
}

function isRetryable(
  error: ToggleFlowError
): boolean {
  if (
    error.code === 'NETWORK_ERROR' ||
    error.code === 'TIMEOUT'
  ) {
    return true;
  }

  const status = error.statusCode;

  if (status === undefined) {
    return false;
  }

  return (
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

function calculateRetryDelay(
  error: ToggleFlowError,
  retryNumber: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  if (error.retryAfterMs !== undefined) {
    return Math.min(
      error.retryAfterMs,
      maxDelayMs
    );
  }

  const exponentialDelay =
    baseDelayMs * 2 ** retryNumber;

  return Math.min(
    exponentialDelay,
    maxDelayMs
  );
}

function waitForRetry(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new ToggleFlowError(
        'ToggleFlow request was aborted.',
        {
          code: 'REQUEST_ABORTED',
          cause: signal.reason,
        }
      )
    );
  }

  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener(
        'abort',
        onAbort
      );

      reject(
        new ToggleFlowError(
          'ToggleFlow request was aborted.',
          {
            code: 'REQUEST_ABORTED',
            cause: signal?.reason,
          }
        )
      );
    };

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener(
        'abort',
        onAbort
      );

      resolve();
    }, delayMs);

    signal?.addEventListener(
      'abort',
      onAbort,
      { once: true }
    );
  });
}

function normalizeTransportError(
  error: unknown
): ToggleFlowError {
  if (isToggleFlowError(error)) {
    return error;
  }

  return new ToggleFlowError(
    'Unexpected ToggleFlow transport error.',
    {
      code: 'NETWORK_ERROR',
      cause: error,
    }
  );
}

function isSuccessEnvelope<T>(
  value: unknown
): value is ApiSuccess<T> {
  return (
    isObject(value) &&
    value.success === true &&
    'data' in value &&
    typeof value.timestamp === 'string'
  );
}

function isApiErrorResponse(
  value: unknown
): value is ApiErrorResponse {
  return (
    isObject(value) &&
    value.success === false &&
    typeof value.timestamp === 'string' &&
    isObject(value.error) &&
    typeof value.error.message === 'string' &&
    typeof value.error.statusCode === 'number'
  );
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}