import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const esm = await import('../dist/index.js');

assert.equal(
  typeof esm.ToggleFlow,
  'function',
  'ESM build must export ToggleFlow'
);

assert.equal(
  typeof esm.ToggleFlowError,
  'function',
  'ESM build must export ToggleFlowError'
);

assert.equal(
  esm.TOGGLEFLOW_SDK_VERSION,
  '0.1.1'
);

const require = createRequire(import.meta.url);
const commonJs = require('../dist/index.cjs');

assert.equal(
  typeof commonJs.ToggleFlow,
  'function',
  'CommonJS build must export ToggleFlow'
);

assert.equal(
  typeof commonJs.ToggleFlowError,
  'function',
  'CommonJS build must export ToggleFlowError'
);

assert.equal(
  commonJs.TOGGLEFLOW_SDK_VERSION,
  '0.1.1'
);

console.log(
  'Package smoke test passed for ESM and CommonJS.'
);