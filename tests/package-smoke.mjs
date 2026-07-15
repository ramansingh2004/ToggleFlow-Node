import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const esm = await import('../dist/index.js');

const packageJson = JSON.parse(
  await readFile(
    new URL('../package.json', import.meta.url),
    'utf8'
  )
);

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
  packageJson.version
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
  packageJson.version
);

console.log(
  'Package smoke test passed for ESM and CommonJS.'
);