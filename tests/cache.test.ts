import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  ToggleFlow,
  type ToggleFlowError,
} from '../src/index.js';

function flagResponse(
  enabled: boolean
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        key: 'a_mode',
        name: 'A Mode',
        enabled,
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

describe('ToggleFlow caching', () => {
  it('uses a fresh cached flag evaluation', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      flagResponse(true)
    );

    const client = new ToggleFlow({
      apiKey: 'tf_test_example',
      baseUrl:
        'http://localhost:5000/api/v1',
      cacheTtlMs: 30_000,
      fetchImplementation: fetchMock,
    });

    const first = await client.isEnabled(
      'a_mode',
      { userId: 'user-123' }
    );

    const second = await client.isEnabled(
      'a_mode',
      { userId: 'user-123' }
    );

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not share cache between different users', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock
      .mockResolvedValueOnce(
        flagResponse(true)
      )
      .mockResolvedValueOnce(
        flagResponse(false)
      );

    const client = new ToggleFlow({
      apiKey: 'tf_test_example',
      baseUrl:
        'http://localhost:5000/api/v1',
      fetchImplementation: fetchMock,
    });

    const userOne = await client.isEnabled(
      'a_mode',
      { userId: 'user-1' }
    );

    const userTwo = await client.isEnabled(
      'a_mode',
      { userId: 'user-2' }
    );

    expect(userOne).toBe(true);
    expect(userTwo).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deduplicates simultaneous requests', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, 10)
      );

      return flagResponse(true);
    });

    const client = new ToggleFlow({
      apiKey: 'tf_test_example',
      baseUrl:
        'http://localhost:5000/api/v1',
      fetchImplementation: fetchMock,
    });

    const results = await Promise.all([
      client.isEnabled(
        'a_mode',
        { userId: 'user-123' }
      ),
      client.isEnabled(
        'a_mode',
        { userId: 'user-123' }
      ),
      client.isEnabled(
        'a_mode',
        { userId: 'user-123' }
      ),
    ]);

    expect(results).toEqual([
      true,
      true,
      true,
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses a stale value when refresh fails', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const errors: ToggleFlowError[] = [];

    fetchMock
      .mockResolvedValueOnce(
        flagResponse(true)
      )
      .mockRejectedValueOnce(
        new Error('ToggleFlow unavailable')
      );

    const client = new ToggleFlow({
      apiKey: 'tf_test_example',
      baseUrl:
        'http://localhost:5000/api/v1',
      cacheTtlMs: 1,
      staleTtlMs: 5_000,
      maxRetries: 0,
      fetchImplementation: fetchMock,
      onError: (error) => {
        errors.push(error);
      },
    });

    const initial = await client.isEnabled(
      'a_mode',
      { userId: 'user-123' },
      false
    );

    await new Promise((resolve) =>
      setTimeout(resolve, 5)
    );

    const duringFailure =
      await client.isEnabled(
        'a_mode',
        { userId: 'user-123' },
        false
      );

    expect(initial).toBe(true);
    expect(duringFailure).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(
      'NETWORK_ERROR'
    );
  });

  it('clearCache forces a new request', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockImplementation(async () =>
      flagResponse(true)
    );

    const client = new ToggleFlow({
      apiKey: 'tf_test_example',
      baseUrl:
        'http://localhost:5000/api/v1',
      fetchImplementation: fetchMock,
    });

    await client.isEnabled(
      'a_mode',
      { userId: 'user-123' }
    );

    client.clearCache();

    await client.isEnabled(
      'a_mode',
      { userId: 'user-123' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});