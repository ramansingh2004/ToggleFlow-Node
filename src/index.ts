export {
  ToggleFlow,
} from './client.js';

export {
  ToggleFlowError,
  isToggleFlowError,
} from './errors.js';

export type {
  ToggleFlowErrorCode,
} from './errors.js';

export type {
  ApiErrorResponse,
  ApiSuccess,
  EvaluationContext,
  FeatureFlag,
  FlagMap,
  HealthResponse,
  ProjectInfo,
  ToggleFlowOptions,
} from './types.js';

export const TOGGLEFLOW_SDK_VERSION = '0.1.0';