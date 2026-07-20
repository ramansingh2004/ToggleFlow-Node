import type { ToggleFlowError } from './errors.js';

export type FlagMap<
  TFlagKey extends string = string,
> = Partial<Record<TFlagKey, boolean>>;

export type FlagSnapshot<
  TFlagKey extends string = string,
> = Readonly<FlagMap<TFlagKey>>;

export interface EvaluationContext {
  userId?: string;
  attributes?: EvaluationAttributes;
  signal?: AbortSignal;
}

export interface FeatureFlag {
  key: string;
  name: string;
  enabled: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  enabledFlagCount: number;
  createdAt: string;
}

export interface HealthResponse {
  status: 'healthy';
  timestamp: string;
}

export interface ExperimentVariantAssignment {
  id: string;
  name: string;
  config: Record<string, unknown> | null;
}

export interface ExperimentAssignment {
  experimentId: string;
  experimentName: string;
  flagKey: string;
  conversionMetric: string;
  userId: string;
  variant: ExperimentVariantAssignment;
}

export interface ExperimentConversion {
  recorded: true;
  alreadyConverted: boolean;
  experimentId: string;
  variantId: string;
  conversionMetric: string;
}

export interface ExperimentRequestOptions {
  signal?: AbortSignal;
}

export interface FlagConversion {
  recorded: boolean;
  duplicate: boolean;
  flagId: string;
  conversionType: string;
  timestamp: string;
}

export interface FlagConversionOptions {
  eventId?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;

  error: {
    message: string;
    statusCode: number;
    details?: unknown;
  };

  timestamp: string;
}

export interface FlagUpdate<
  TFlagKey extends string = string,
> {
  previous: FlagSnapshot<TFlagKey>;
  current: FlagSnapshot<TFlagKey>;
  changedKeys: readonly TFlagKey[];
  updatedAt: Date;
  isInitial: boolean;
}

export interface PollingOptions {
  /**
   * Time between completed refreshes.
   *
   * @default 30000
   */
  intervalMs?: number;

  /** Evaluation context used for every background refresh. */
  context?: Omit<EvaluationContext, 'signal'>;
}

export interface ToggleFlowOptions<
  TFlagKey extends string = string,
> {
  apiKey: string;

  /**
   * @default https://toggleflow-api.onrender.com/api/v1
   */
  baseUrl?: string;

  /**
   * Request timeout.
   *
   * @default 3000
   */
  timeoutMs?: number;

  /**
   * Time a successful evaluation remains fresh.
   *
   * @default 30000
   */
  cacheTtlMs?: number;

  /**
   * Additional time an expired value can be used when the
   * ToggleFlow API is unavailable.
   *
   * @default 300000
   */
  staleTtlMs?: number;

  /**
   * Maximum number of cached evaluations.
   *
   * @default 1000
   */
  maxCacheEntries?: number;

  /**
 * Number of retries after the initial request.
 *
 * @default 2
 */
maxRetries?: number;

/**
 * Initial exponential backoff delay.
 *
 * @default 100
 */
retryBaseDelayMs?: number;

/**
 * Maximum retry delay, including Retry-After.
 *
 * @default 5000
 */
retryMaxDelayMs?: number;

  fetchImplementation?: typeof globalThis.fetch;

  onError?: (error: ToggleFlowError) => void;

  /**
   * Values used when an evaluation fails and no usable cached or
   * successfully refreshed snapshot value exists.
   */
  fallbacks?: Partial<Record<TFlagKey, boolean>>;

  /** Called after the initial snapshot and whenever snapshot values change. */
  onUpdate?: (update: FlagUpdate<TFlagKey>) => void;
}

export type EvaluationAttributeValue =
  | string
  | number
  | boolean;

export type EvaluationAttributes = Record<
  string,
  EvaluationAttributeValue
>;
