import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  ToggleFlow,
  ToggleFlowError,
  TOGGLEFLOW_SDK_VERSION,
} from '../src/index.js';

function jsonResponse(
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function createClient(
  fetchImplementation: typeof fetch,
  onError?: (error: ToggleFlowError) => void
): ToggleFlow {
  return new ToggleFlow({
    apiKey: 'tf_test_example',
    baseUrl: 'http://localhost:5000/api/v1',
    fetchImplementation,
    maxRetries: 0,
    ...(onError ? { onError } : {}),
  });
}

describe('ToggleFlow', () => {
  it('retrieves all evaluated flags', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          a_mode: true,
          new_checkout: false,
        },
        message: 'Flags retrieved',
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);

    const flags = await client.getAllFlags({
      userId: 'user-123',
    });

    expect(flags).toEqual({
      a_mode: true,
      new_checkout: false,
    });

    const firstCall = fetchMock.mock.calls[0];

    expect(String(firstCall?.[0])).toBe(
      'http://localhost:5000/api/v1/sdk/flags?userId=user-123'
    );

    const headers = new Headers(
      firstCall?.[1]?.headers
    );

    expect(
      headers.get('Authorization')
    ).toBe('Bearer tf_test_example');

    expect(
      headers.get('User-Agent')
    ).toBe(
      `@toggleflow/node/${TOGGLEFLOW_SDK_VERSION}`
    );

    expect(
      headers.get('X-ToggleFlow-SDK')
    ).toBe('node');

    expect(
      headers.get('X-ToggleFlow-SDK-Version')
    ).toBe(TOGGLEFLOW_SDK_VERSION);
  });

  it('evaluates one enabled flag', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          key: 'a_mode',
          name: 'A Mode',
          enabled: true,
        },
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);

    await expect(
      client.isEnabled(
        'a_mode',
        { userId: 'user-123' },
        false
      )
    ).resolves.toBe(true);

    expect(
      String(fetchMock.mock.calls[0]?.[0])
    ).toBe(
      'http://localhost:5000/api/v1/sdk/flags/a_mode?userId=user-123'
    );
  });

  it('returns false for a disabled flag', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          key: 'a_mode',
          name: 'A Mode',
          enabled: false,
        },
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);

    await expect(
      client.isEnabled(
        'a_mode',
        { userId: 'user-123' },
        true
      )
    ).resolves.toBe(false);
  });

  it('uses the fallback during a network error', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const onError = vi.fn();

    fetchMock.mockRejectedValue(
      new Error('Connection refused')
    );

    const client = createClient(
      fetchMock,
      onError
    );

    await expect(
      client.isEnabled(
        'a_mode',
        { userId: 'user-123' },
        false
      )
    ).resolves.toBe(false);

    expect(onError).toHaveBeenCalledOnce();

    expect(
      onError.mock.calls[0]?.[0]
    ).toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('retrieves project information', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          id: 'project-1',
          name: 'Test Project',
          slug: 'test-project',
          isActive: true,
          enabledFlagCount: 2,
          createdAt: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);
    const project =
      await client.getProjectInfo();

    expect(project.name).toBe('Test Project');
    expect(project.enabledFlagCount).toBe(2);
  });

  it('checks public SDK health without an API key header', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);
    const health = await client.healthCheck();

    expect(health.status).toBe('healthy');

    const headers = new Headers(
      fetchMock.mock.calls[0]?.[1]?.headers
    );

    expect(
      headers.has('Authorization')
    ).toBe(false);
  });

  it('throws for an empty API key', () => {
    expect(
      () =>
        new ToggleFlow({
          apiKey: '',
        })
    ).toThrow(
      'A ToggleFlow API key is required.'
    );
  });

  it('throws a typed authorization error', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            message: 'Invalid API key',
            statusCode: 401,
          },
          timestamp: new Date().toISOString(),
        },
        401
      )
    );

    const client = createClient(fetchMock);

    await expect(
      client.getAllFlags()
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  });
  it('exports the current SDK version', () => {
      expect(TOGGLEFLOW_SDK_VERSION).toBe('0.5.0');
    });

  it('sends evaluation attributes in a POST request', async () => {
  const fetchMock = vi.fn<typeof fetch>();

  fetchMock.mockResolvedValue(
    jsonResponse({
      success: true,
      data: {
        key: 'a_mode',
        name: 'A Mode',
        enabled: true,
      },
      timestamp: new Date().toISOString(),
    })
  );

  const client = createClient(fetchMock);

  await client.getFlag('a_mode', {
    userId: 'user-123',
    attributes: {
      country: 'IN',
      plan: 'pro',
      betaTester: true,
    },
  });

  const firstCall = fetchMock.mock.calls[0];

  expect(String(firstCall?.[0])).toBe(
    'http://localhost:5000/api/v1/sdk/flags/a_mode/evaluate'
  );

  expect(firstCall?.[1]?.method).toBe(
    'POST'
  );

  expect(
    JSON.parse(
      String(firstCall?.[1]?.body)
    )
  ).toEqual({
    userId: 'user-123',
    attributes: {
      country: 'IN',
      plan: 'pro',
      betaTester: true,
    },
  });
});

it('does not share cached evaluations across attributes', async () => {
  const fetchMock = vi.fn<typeof fetch>();

  fetchMock
    .mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          key: 'a_mode',
          name: 'A Mode',
          enabled: true,
        },
        timestamp:
          new Date().toISOString(),
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          key: 'a_mode',
          name: 'A Mode',
          enabled: false,
        },
        timestamp:
          new Date().toISOString(),
      })
    );

  const client = createClient(fetchMock);

  const indiaResult =
    await client.isEnabled(
      'a_mode',
      {
        userId: 'user-123',
        attributes: {
          country: 'IN',
        },
      },
      false
    );

  const usaResult =
    await client.isEnabled(
      'a_mode',
      {
        userId: 'user-123',
        attributes: {
          country: 'US',
        },
      },
      false
    );

  expect(indiaResult).toBe(true);
  expect(usaResult).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
});

describe('ToggleFlow experiments', () => {
  it('assigns a user to an experiment variant', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          experimentId: 'experiment-1',
          experimentName: 'Homepage CTA',
          flagKey: 'new_homepage',
          conversionMetric: 'signup',
          userId: 'user-123',
          variant: {
            id: 'variant-b',
            name: 'Treatment',
            config: {
              buttonText: 'Start free',
            },
          },
        },
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);
    const assignment =
      await client.assignExperiment(
        'experiment-1',
        'user-123'
      );

    expect(assignment.variant.name).toBe(
      'Treatment'
    );
    expect(assignment.variant.config).toEqual({
      buttonText: 'Start free',
    });

    const requestCall = fetchMock.mock.calls[0];

    expect(String(requestCall?.[0])).toBe(
      'http://localhost:5000/api/v1/sdk/experiments/experiment-1/assign'
    );
    expect(requestCall?.[1]?.method).toBe('POST');
    expect(
      JSON.parse(String(requestCall?.[1]?.body))
    ).toEqual({
      userId: 'user-123',
    });
  });

  it('records an experiment conversion', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          recorded: true,
          alreadyConverted: false,
          experimentId: 'experiment-1',
          variantId: 'variant-b',
          conversionMetric: 'signup',
        },
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);
    const conversion =
      await client.trackConversion(
        'experiment-1',
        'user-123'
      );

    expect(conversion).toMatchObject({
      recorded: true,
      alreadyConverted: false,
      variantId: 'variant-b',
    });

    const requestCall = fetchMock.mock.calls[0];

    expect(String(requestCall?.[0])).toBe(
      'http://localhost:5000/api/v1/sdk/experiments/experiment-1/convert'
    );
    expect(
      JSON.parse(String(requestCall?.[1]?.body))
    ).toEqual({
      userId: 'user-123',
    });
  });

  it('rejects empty experiment identifiers before making a request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createClient(fetchMock);

    await expect(
      client.assignExperiment('', 'user-123')
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });

    await expect(
      client.trackConversion(
        'experiment-1',
        '   '
      )
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed experiment responses', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          experimentId: 'experiment-1',
          variant: null,
        },
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);

    await expect(
      client.assignExperiment(
        'experiment-1',
        'user-123'
      )
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('ToggleFlow flag analytics', () => {
  it('records an idempotent flag conversion', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          recorded: true,
          duplicate: false,
          flagId: 'flag-1',
          conversionType: 'signup',
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      })
    );

    const client = createClient(fetchMock);
    const conversion = await client.trackFlagConversion(
      'new_checkout',
      'user-123',
      'signup',
      {
        eventId: 'signup-456',
        metadata: { plan: 'pro' },
      }
    );

    expect(conversion).toMatchObject({
      recorded: true,
      duplicate: false,
      conversionType: 'signup',
    });

    const requestCall = fetchMock.mock.calls[0];
    expect(String(requestCall?.[0])).toBe(
      'http://localhost:5000/api/v1/sdk/flags/new_checkout/conversions'
    );
    expect(JSON.parse(String(requestCall?.[1]?.body))).toEqual({
      userId: 'user-123',
      conversionType: 'signup',
      eventId: 'signup-456',
      metadata: { plan: 'pro' },
    });
  });
});
