import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ToggleFlow } from '../src/index.js';

function successResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        key: 'a_mode',
        name: 'A Mode',
        enabled: true,
      },
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

function errorResponse(
  status: number,
  message: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
        statusCode: status,
      },
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }
  );
}

function createClient(
  fetchImplementation: typeof fetch,
  maxRetries = 2
): ToggleFlow {
  return new ToggleFlow({
    apiKey: 'tf_test_example',
    baseUrl:
      'http://localhost:5000/api/v1',
    fetchImplementation,
    maxRetries,
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
  });
}

describe('ToggleFlow retries', () => {
  it('retries a server error and succeeds', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock
      .mockResolvedValueOnce(
        errorResponse(
          500,
          'Internal server error'
        )
      )
      .mockResolvedValueOnce(
        successResponse()
      );

    const client = createClient(fetchMock, 1);

    const flag = await client.getFlag(
      'a_mode',
      { userId: 'user-123' }
    );

    expect(flag.enabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network failure', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock
      .mockRejectedValueOnce(
        new Error('Connection reset')
      )
      .mockResolvedValueOnce(
        successResponse()
      );

    const client = createClient(fetchMock, 1);

    await expect(
      client.getFlag('a_mode')
    ).resolves.toMatchObject({
      enabled: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries HTTP 429', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock
      .mockResolvedValueOnce(
        errorResponse(
          429,
          'Too many requests',
          {
            'Retry-After': '0',
          }
        )
      )
      .mockResolvedValueOnce(
        successResponse()
      );

    const client = createClient(fetchMock, 1);

    await expect(
      client.getFlag('a_mode')
    ).resolves.toMatchObject({
      enabled: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an invalid API key', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      errorResponse(
        401,
        'Invalid API key'
      )
    );

    const client = createClient(fetchMock, 2);

    await expect(
      client.getFlag('a_mode')
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('stops after the configured retry limit', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockImplementation(async () =>
      errorResponse(
        503,
        'Service unavailable'
      )
    );

    const client = createClient(fetchMock, 2);

    await expect(
      client.getFlag('a_mode')
    ).rejects.toMatchObject({
      code: 'API_ERROR',
      statusCode: 503,
    });

    // Initial request + 2 retries
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});