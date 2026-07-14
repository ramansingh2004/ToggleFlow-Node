import {
  ToggleFlowError,
  isToggleFlowError,
  type ToggleFlowErrorCode,
} from './errors.js';

import type {
  ApiErrorResponse,
  ApiSuccess,
} from './types.js';

interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImplementation: typeof fetch;
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

  constructor(options: TransportOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs;
    this.fetchImplementation =
      options.fetchImplementation;
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
    externalSignal?: AbortSignal
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
        'User-Agent': '@toggleflow/node/0.1.0',
      });

      if (authenticated) {
        headers.set(
          'Authorization',
          `Bearer ${this.apiKey}`
        );
      }

      const response =
        await this.fetchImplementation(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

      const body = await parseJson(response);

      if (!response.ok) {
        throw createApiError(
          response.status,
          body
        );
      }

      return body;
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

async function parseJson(
  response: Response
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
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

function createApiError(
  statusCode: number,
  body: unknown
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

  return new ToggleFlowError(message, {
    code,
    statusCode,
  });
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