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

function flagsResponse(
  flags: Record<string, boolean>
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: flags,
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

describe('ToggleFlow snapshots and polling', () => {
  it('uses configured and per-call fallbacks before initialization', () => {
    const client = new ToggleFlow<
      'a_mode' | 'new_checkout'
    >({
      apiKey: 'tf_test_example',
      fallbacks: {
        a_mode: true,
      },
      fetchImplementation: vi.fn<typeof fetch>(),
    });

    expect(
      client.isEnabledFromSnapshot('a_mode')
    ).toBe(true);
    expect(
      client.isEnabledFromSnapshot(
        'a_mode',
        false
      )
    ).toBe(false);
    expect(
      client.isEnabledFromSnapshot(
        'new_checkout'
      )
    ).toBe(false);
  });

  it('atomically refreshes an immutable snapshot and reports updates', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const onUpdate = vi.fn();

    fetchMock
      .mockResolvedValueOnce(
        flagsResponse({ a_mode: true })
      )
      .mockResolvedValueOnce(
        flagsResponse({
          a_mode: false,
          new_checkout: true,
        })
      );

    const client = new ToggleFlow<
      'a_mode' | 'new_checkout'
    >({
      apiKey: 'tf_test_example',
      baseUrl:
        'http://localhost:5000/api/v1',
      fetchImplementation: fetchMock,
      onUpdate,
    });

    const initial = await client.refreshSnapshot();

    expect(initial).toEqual({ a_mode: true });
    expect(Object.isFrozen(initial)).toBe(true);
    expect(client.hasSnapshotValue()).toBe(true);
    expect(
      client.isEnabledFromSnapshot('a_mode')
    ).toBe(true);
    expect(
      client.isEnabledFromSnapshot(
        'new_checkout',
        true
      )
    ).toBe(false);

    await client.refreshSnapshot();

    expect(client.getSnapshot()).toEqual({
      a_mode: false,
      new_checkout: true,
    });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({
      changedKeys: ['a_mode'],
      isInitial: true,
    });
    expect(
      new Set(
        onUpdate.mock.calls[1]?.[0].changedKeys
      )
    ).toEqual(
      new Set(['a_mode', 'new_checkout'])
    );
  });

  it('polls in the background and stops cleanly', async () => {
    vi.useFakeTimers();

    try {
      const fetchMock = vi.fn<typeof fetch>();

      fetchMock
        .mockResolvedValueOnce(
          flagsResponse({ a_mode: false })
        )
        .mockResolvedValueOnce(
          flagsResponse({ a_mode: true })
        );

      const client = new ToggleFlow<'a_mode'>({
        apiKey: 'tf_test_example',
        baseUrl:
          'http://localhost:5000/api/v1',
        fetchImplementation: fetchMock,
      });

      await client.startPolling({
        intervalMs: 1_000,
        context: { userId: 'user-123' },
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(
        client.isEnabledFromSnapshot('a_mode')
      ).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        client.isEnabledFromSnapshot('a_mode')
      ).toBe(true);

      client.close();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the last snapshot when a poll refresh fails', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const onError = vi.fn();

    fetchMock
      .mockResolvedValueOnce(
        flagsResponse({ a_mode: true })
      )
      .mockRejectedValueOnce(
        new Error('Unavailable')
      );

    const client = new ToggleFlow<'a_mode'>({
      apiKey: 'tf_test_example',
      baseUrl:
        'http://localhost:5000/api/v1',
      maxRetries: 0,
      fetchImplementation: fetchMock,
      onError,
    });

    await client.refreshSnapshot();
    await client.startPolling({
      intervalMs: 30_000,
    });
    client.close();

    expect(client.getSnapshot()).toEqual({
      a_mode: true,
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('restricts flag keys when a key union is provided', () => {
    const client = new ToggleFlow<
      'a_mode' | 'new_checkout'
    >({
      apiKey: 'tf_test_example',
      fetchImplementation: vi.fn<typeof fetch>(),
    });

    client.isEnabledFromSnapshot('a_mode');

    if (false) {
      // @ts-expect-error Unknown keys must fail type checking.
      client.isEnabledFromSnapshot('unknown_flag');
    }
  });
});
