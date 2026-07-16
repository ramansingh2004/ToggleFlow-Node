import { MemoryCache } from './cache.js';

import {
  ToggleFlowError,
  isToggleFlowError,
} from './errors.js';

import { HttpTransport } from './transport.js';

import type {
  EvaluationContext,
  ExperimentAssignment,
  ExperimentConversion,
  ExperimentRequestOptions,
  FeatureFlag,
  FlagMap,
  HealthResponse,
  ProjectInfo,
  ToggleFlowOptions,
  EvaluationAttributes,
EvaluationAttributeValue,
} from './types.js';

const DEFAULT_BASE_URL =
  'https://toggleflow-api.onrender.com/api/v1';

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_STALE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 1_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;

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

    const maxRetries =
  validateNonNegativeInteger(
    options.maxRetries ??
      DEFAULT_MAX_RETRIES,
    'maxRetries'
  );

const retryBaseDelayMs =
  validateNonNegativeNumber(
    options.retryBaseDelayMs ??
      DEFAULT_RETRY_BASE_DELAY_MS,
    'retryBaseDelayMs'
  );

const retryMaxDelayMs =
  validateNonNegativeNumber(
    options.retryMaxDelayMs ??
      DEFAULT_RETRY_MAX_DELAY_MS,
    'retryMaxDelayMs'
  );

if (retryMaxDelayMs < retryBaseDelayMs) {
  throw new ToggleFlowError(
    'retryMaxDelayMs must be greater than or equal to retryBaseDelayMs.',
    {
      code: 'INVALID_CONFIGURATION',
    }
  );
}

    this.transport = new HttpTransport({
  apiKey,
  baseUrl,
  timeoutMs,
  fetchImplementation,
  maxRetries,
  retryBaseDelayMs,
  retryMaxDelayMs,
});
  }

  async getAllFlags(
  context: EvaluationContext = {}
): Promise<FlagMap> {
  const evaluation =
    normalizeEvaluationContext(context);

  const cacheKey = createCacheKey(
    'all-flags',
    evaluation.userId ?? 'anonymous',
    evaluation.attributeFingerprint
  );

  return this.loadCached(
    cacheKey,
    context.signal,
    async () => {
      const flags =
        evaluation.hasAttributes
          ? await this.transport.postData<unknown>(
              '/sdk/flags/evaluate',
              createEvaluationBody(
                evaluation.userId,
                evaluation.attributes
              ),
              context.signal
            )
          : await this.transport.getData<unknown>(
              '/sdk/flags',
              {
                userId:
                  evaluation.userId,
              },
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

  const evaluation =
    normalizeEvaluationContext(context);

  const cacheKey = createFlagCacheKey(
    flagKey,
    evaluation.userId,
    evaluation.attributeFingerprint
  );

  return this.loadCached(
    cacheKey,
    context.signal,
    async () => {
      const encodedKey =
        encodeURIComponent(flagKey);

      const flag =
        evaluation.hasAttributes
          ? await this.transport.postData<unknown>(
              `/sdk/flags/${encodedKey}/evaluate`,
              createEvaluationBody(
                evaluation.userId,
                evaluation.attributes
              ),
              context.signal
            )
          : await this.transport.getData<unknown>(
              `/sdk/flags/${encodedKey}`,
              {
                userId:
                  evaluation.userId,
              },
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
      const evaluation =
  normalizeEvaluationContext(context);

cacheKey = createFlagCacheKey(
  flagKey,
  evaluation.userId,
  evaluation.attributeFingerprint
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
   * Deterministically assigns an application user to a running experiment.
   * Repeating this call for the same experiment and user returns the same
   * persisted variant.
   */
  async assignExperiment(
    experimentId: string,
    userId: string,
    options: ExperimentRequestOptions = {}
  ): Promise<ExperimentAssignment> {
    const normalizedExperimentId =
      validateRequiredString(
        experimentId,
        'experimentId'
      );
    const normalizedUserId =
      validateRequiredUserId(userId);

    const assignment =
      await this.transport.postData<unknown>(
        `/sdk/experiments/${encodeURIComponent(normalizedExperimentId)}/assign`,
        { userId: normalizedUserId },
        options.signal
      );

    if (!isExperimentAssignment(assignment)) {
      throw new ToggleFlowError(
        'ToggleFlow returned an invalid experiment assignment.',
        {
          code: 'INVALID_RESPONSE',
        }
      );
    }

    return assignment;
  }

  /**
   * Records the configured conversion for an already assigned user.
   * The backend treats repeated calls as idempotent.
   */
  async trackConversion(
    experimentId: string,
    userId: string,
    options: ExperimentRequestOptions = {}
  ): Promise<ExperimentConversion> {
    const normalizedExperimentId =
      validateRequiredString(
        experimentId,
        'experimentId'
      );
    const normalizedUserId =
      validateRequiredUserId(userId);

    const conversion =
      await this.transport.postData<unknown>(
        `/sdk/experiments/${encodeURIComponent(normalizedExperimentId)}/convert`,
        { userId: normalizedUserId },
        options.signal
      );

    if (!isExperimentConversion(conversion)) {
      throw new ToggleFlowError(
        'ToggleFlow returned an invalid experiment conversion response.',
        {
          code: 'INVALID_RESPONSE',
        }
      );
    }

    return conversion;
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
  userId: string | undefined,
  attributeFingerprint = 'no-attributes'
): string {
  return createCacheKey(
    'flag',
    flagKey,
    userId ?? 'anonymous',
    attributeFingerprint
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

  if (normalized.length > 200) {
    throw new ToggleFlowError(
      'userId cannot exceed 200 characters.',
      {
        code: 'INVALID_ARGUMENT',
      }
    );
  }

  return normalized;
}

function validateRequiredUserId(
  userId: string
): string {
  const normalized = validateUserId(userId);

  if (!normalized) {
    throw new ToggleFlowError(
      'userId must be a non-empty string.',
      {
        code: 'INVALID_ARGUMENT',
      }
    );
  }

  return normalized;
}

function validateRequiredString(
  value: string,
  name: string
): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new ToggleFlowError(
      `${name} must be a non-empty string.`,
      {
        code: 'INVALID_ARGUMENT',
      }
    );
  }

  return normalized;
}

function normalizeEvaluationContext(
  context: EvaluationContext
): {
  userId: string | undefined;
  attributes: EvaluationAttributes;
  hasAttributes: boolean;
  attributeFingerprint: string;
} {
  const userId = validateUserId(
    context.userId
  );

  const attributes =
    validateAttributes(
      context.attributes
    );

  const attributeFingerprint =
    createAttributeFingerprint(
      attributes
    );

  return {
    userId,
    attributes,
    hasAttributes:
      Object.keys(attributes).length > 0,
    attributeFingerprint,
  };
}

function validateAttributes(
  attributes:
    | EvaluationAttributes
    | undefined
): EvaluationAttributes {
  if (attributes === undefined) {
    return {};
  }

  if (!isObject(attributes)) {
    throw new ToggleFlowError(
      'attributes must be an object.',
      {
        code: 'INVALID_ARGUMENT',
      }
    );
  }

  const entries =
    Object.entries(attributes);

  if (entries.length > 50) {
    throw new ToggleFlowError(
      'attributes can contain at most 50 entries.',
      {
        code: 'INVALID_ARGUMENT',
      }
    );
  }

  const normalized: EvaluationAttributes =
    {};

  for (const [rawKey, value] of entries) {
    const key = rawKey.trim();

    if (!key || key.length > 100) {
      throw new ToggleFlowError(
        'Attribute names must contain between 1 and 100 characters.',
        {
          code: 'INVALID_ARGUMENT',
        }
      );
    }

    if (
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor'
    ) {
      throw new ToggleFlowError(
        `Attribute name "${key}" is not allowed.`,
        {
          code: 'INVALID_ARGUMENT',
        }
      );
    }

    if (!isEvaluationAttributeValue(value)) {
      throw new ToggleFlowError(
        `Attribute "${key}" must be a string, number, or boolean.`,
        {
          code: 'INVALID_ARGUMENT',
        }
      );
    }

    if (
      typeof value === 'string' &&
      value.length > 500
    ) {
      throw new ToggleFlowError(
        `Attribute "${key}" cannot exceed 500 characters.`,
        {
          code: 'INVALID_ARGUMENT',
        }
      );
    }

    if (
      typeof value === 'number' &&
      !Number.isFinite(value)
    ) {
      throw new ToggleFlowError(
        `Attribute "${key}" must be a finite number.`,
        {
          code: 'INVALID_ARGUMENT',
        }
      );
    }

    normalized[key] = value;
  }

  return normalized;
}

function isEvaluationAttributeValue(
  value: unknown
): value is EvaluationAttributeValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' &&
      Number.isFinite(value))
  );
}

function createAttributeFingerprint(
  attributes: EvaluationAttributes
): string {
  const entries = Object.entries(
    attributes
  ).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return JSON.stringify(entries);
}

function createEvaluationBody(
  userId: string | undefined,
  attributes: EvaluationAttributes
): {
  userId?: string;
  attributes: EvaluationAttributes;
} {
  return {
    ...(userId ? { userId } : {}),
    attributes,
  };
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

function validateNonNegativeInteger(
  value: number,
  name: string
): number {
  if (
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new ToggleFlowError(
      `${name} must be zero or a positive integer.`,
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

function isExperimentAssignment(
  value: unknown
): value is ExperimentAssignment {
  if (
    !isObject(value) ||
    typeof value.experimentId !== 'string' ||
    typeof value.experimentName !== 'string' ||
    typeof value.flagKey !== 'string' ||
    typeof value.conversionMetric !== 'string' ||
    typeof value.userId !== 'string' ||
    !isObject(value.variant) ||
    typeof value.variant.id !== 'string' ||
    typeof value.variant.name !== 'string'
  ) {
    return false;
  }

  return (
    value.variant.config === null ||
    isObject(value.variant.config)
  );
}

function isExperimentConversion(
  value: unknown
): value is ExperimentConversion {
  return (
    isObject(value) &&
    value.recorded === true &&
    typeof value.alreadyConverted === 'boolean' &&
    typeof value.experimentId === 'string' &&
    typeof value.variantId === 'string' &&
    typeof value.conversionMetric === 'string'
  );
}