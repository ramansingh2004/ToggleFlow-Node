import { MemoryCache } from './cache.js';

import {
  ToggleFlowError,
  isToggleFlowError,
} from './errors.js';

import { HttpTransport } from './transport.js';

import type {
  EvaluationContext,
  FeatureFlag,
  FlagMap,
  HealthResponse,
  ProjectInfo,
  ToggleFlowOptions,
} from './types.js';

const DEFAULT_BASE_URL =
  'https://api.toggleflow.com/api/v1';

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_STALE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 1_000;

export class ToggleFlow {
  private readonly transport: HttpTransport;
  private readonly cache: MemoryCache;

  private readonly cacheTtlMs: number;
  private readonly staleTtlMs: number;

  private readonly onError:
    | ToggleFlowOptions['onError']
    | undefined;

  constructor(options: ToggleFlowOptions) {
    if (!options || typeof options !== 'object') {
      throw new ToggleFlowError(
        'ToggleFlow configuration is required.',
        {
          code: 'INVALID_CONFIGURATION',
        }
      );
    }

    const apiKey = options.apiKey?.trim();

    if (!apiKey) {
      throw new ToggleFlowError(
        'A ToggleFlow API key is required.',
        {
          code: 'INVALID_CONFIGURATION',
        }
      );
    }

    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? DEFAULT_BASE_URL
    );

    const timeoutMs = validatePositiveNumber(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      'timeoutMs'
    );

    this.cacheTtlMs =
      validateNonNegativeNumber(
        options.cacheTtlMs ??
          DEFAULT_CACHE_TTL_MS,
        'cacheTtlMs'
      );

    this.staleTtlMs =
      validateNonNegativeNumber(
        options.staleTtlMs ??
          DEFAULT_STALE_TTL_MS,
        'staleTtlMs'
      );

    const maxCacheEntries =
      validatePositiveInteger(
        options.maxCacheEntries ??
          DEFAULT_MAX_CACHE_ENTRIES,
        'maxCacheEntries'
      );

    const fetchImplementation =
      options.fetchImplementation ??
      globalThis.fetch;

    if (!fetchImplementation) {
      throw new ToggleFlowError(
        'A fetch implementation is required.',
        {
          code: 'INVALID_CONFIGURATION',
        }
      );
    }

    this.onError = options.onError;
    this.cache = new MemoryCache(
      maxCacheEntries
    );

    this.transport = new HttpTransport({
      apiKey,
      baseUrl,
      timeoutMs,
      fetchImplementation,
    });
  }

  async getAllFlags(
    context: EvaluationContext = {}
  ): Promise<FlagMap> {
    const userId = validateUserId(
      context.userId
    );

    const cacheKey = createCacheKey(
      'all-flags',
      userId ?? 'anonymous'
    );

    return this.loadCached(
      cacheKey,
      context.signal,
      async () => {
        const flags =
          await this.transport.getData<unknown>(
            '/sdk/flags',
            { userId },
            context.signal
          );

        if (!isFlagMap(flags)) {
          throw new ToggleFlowError(
            'ToggleFlow returned an invalid flag map.',
            {
              code: 'INVALID_RESPONSE',
            }
          );
        }

        return flags;
      }
    );
  }

  async getFlag(
    key: string,
    context: EvaluationContext = {}
  ): Promise<FeatureFlag> {
    const flagKey = validateFlagKey(key);
    const userId = validateUserId(
      context.userId
    );

    const cacheKey = createFlagCacheKey(
      flagKey,
      userId
    );

    return this.loadCached(
      cacheKey,
      context.signal,
      async () => {
        const flag =
          await this.transport.getData<unknown>(
            `/sdk/flags/${encodeURIComponent(flagKey)}`,
            { userId },
            context.signal
          );

        if (!isFeatureFlag(flag)) {
          throw new ToggleFlowError(
            'ToggleFlow returned an invalid flag response.',
            {
              code: 'INVALID_RESPONSE',
            }
          );
        }

        return flag;
      }
    );
  }

  async isEnabled(
    key: string,
    context: EvaluationContext = {},
    fallback = false
  ): Promise<boolean> {
    let cacheKey: string | undefined;

    try {
      const flagKey = validateFlagKey(key);
      const userId = validateUserId(
        context.userId
      );

      cacheKey = createFlagCacheKey(
        flagKey,
        userId
      );

      const flag = await this.getFlag(
        flagKey,
        context
      );

      return flag.enabled;
    } catch (error) {
      const normalizedError =
        normalizeError(error);

      this.reportError(normalizedError);

      if (cacheKey) {
        const stale =
          this.cache.getStale<FeatureFlag>(
            cacheKey
          );

        if (stale) {
          return stale.enabled;
        }
      }

      return fallback;
    }
  }

  async getProjectInfo(
    signal?: AbortSignal
  ): Promise<ProjectInfo> {
    const cacheKey = 'project-info';

    return this.loadCached(
      cacheKey,
      signal,
      async () => {
        const project =
          await this.transport.getData<unknown>(
            '/sdk/info',
            {},
            signal
          );

        if (!isProjectInfo(project)) {
          throw new ToggleFlowError(
            'ToggleFlow returned invalid project information.',
            {
              code: 'INVALID_RESPONSE',
            }
          );
        }

        return project;
      }
    );
  }

  async healthCheck(
    signal?: AbortSignal
  ): Promise<HealthResponse> {
    const health =
      await this.transport.getPublic<unknown>(
        '/sdk/health',
        {},
        signal
      );

    if (!isHealthResponse(health)) {
      throw new ToggleFlowError(
        'ToggleFlow returned an invalid health response.',
        {
          code: 'INVALID_RESPONSE',
        }
      );
    }

    return health;
  }

  /**
   * Clears cached evaluations and project information.
   */
  clearCache(): void {
    this.cache.clear();
  }

  private async loadCached<T>(
    key: string,
    signal: AbortSignal | undefined,
    loader: () => Promise<T>
  ): Promise<T> {
    const fresh = this.cache.getFresh<T>(key);

    if (fresh !== undefined) {
      return fresh;
    }

    /*
     * Do not share an in-flight request when a caller supplies
     * its own AbortSignal. One caller cancelling its request
     * must not cancel another caller's evaluation.
     */
    if (signal) {
      const value = await loader();

      this.cache.set(
        key,
        value,
        this.cacheTtlMs,
        this.staleTtlMs
      );

      return value;
    }

    return this.cache.getOrLoad(
      key,
      this.cacheTtlMs,
      this.staleTtlMs,
      loader
    );
  }

  private reportError(
    error: ToggleFlowError
  ): void {
    if (!this.onError) return;

    try {
      this.onError(error);
    } catch {
      // Error reporting cannot break evaluation.
    }
  }
}

function createFlagCacheKey(
  flagKey: string,
  userId: string | undefined
): string {
  return createCacheKey(
    'flag',
    flagKey,
    userId ?? 'anonymous'
  );
}

function createCacheKey(
  ...parts: string[]
): string {
  return JSON.stringify(parts);
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);

    if (
      url.protocol !== 'http:' &&
      url.protocol !== 'https:'
    ) {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw new ToggleFlowError(
      'baseUrl must be a valid HTTP or HTTPS URL.',
      {
        code: 'INVALID_CONFIGURATION',
      }
    );
  }

  return trimmed.replace(/\/+$/, '');
}

function validateFlagKey(key: string): string {
  const normalized = key?.trim();

  if (!normalized) {
    throw new ToggleFlowError(
      'Feature flag key must be a non-empty string.',
      {
        code: 'INVALID_ARGUMENT',
      }
    );
  }

  return normalized;
}

function validateUserId(
  userId: string | undefined
): string | undefined {
  if (userId === undefined) {
    return undefined;
  }

  const normalized = userId.trim();

  if (!normalized) {
    throw new ToggleFlowError(
      'userId must be a non-empty string when provided.',
      {
        code: 'INVALID_ARGUMENT',
      }
    );
  }

  return normalized;
}

function validatePositiveNumber(
  value: number,
  name: string
): number {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new ToggleFlowError(
      `${name} must be a positive number.`,
      {
        code: 'INVALID_CONFIGURATION',
      }
    );
  }

  return value;
}

function validateNonNegativeNumber(
  value: number,
  name: string
): number {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new ToggleFlowError(
      `${name} must be zero or a positive number.`,
      {
        code: 'INVALID_CONFIGURATION',
      }
    );
  }

  return value;
}

function validatePositiveInteger(
  value: number,
  name: string
): number {
  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new ToggleFlowError(
      `${name} must be a positive integer.`,
      {
        code: 'INVALID_CONFIGURATION',
      }
    );
  }

  return value;
}

function normalizeError(
  error: unknown
): ToggleFlowError {
  if (isToggleFlowError(error)) {
    return error;
  }

  return new ToggleFlowError(
    'An unexpected ToggleFlow SDK error occurred.',
    {
      code: 'API_ERROR',
      cause: error,
    }
  );
}

function isFlagMap(
  value: unknown
): value is FlagMap {
  if (!isObject(value)) return false;

  return Object.values(value).every(
    (flagValue) =>
      typeof flagValue === 'boolean'
  );
}

function isFeatureFlag(
  value: unknown
): value is FeatureFlag {
  return (
    isObject(value) &&
    typeof value.key === 'string' &&
    typeof value.name === 'string' &&
    typeof value.enabled === 'boolean'
  );
}

function isProjectInfo(
  value: unknown
): value is ProjectInfo {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.isActive === 'boolean' &&
    typeof value.enabledFlagCount === 'number' &&
    typeof value.createdAt === 'string'
  );
}

function isHealthResponse(
  value: unknown
): value is HealthResponse {
  return (
    isObject(value) &&
    value.status === 'healthy' &&
    typeof value.timestamp === 'string'
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