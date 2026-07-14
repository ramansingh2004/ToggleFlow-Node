import {
  ToggleFlow,
} from '../dist/index.js';

const apiKey =
  process.env.TOGGLEFLOW_API_KEY;

const baseUrl =
  process.env.TOGGLEFLOW_BASE_URL ??
  'http://localhost:5000/api/v1';

if (!apiKey) {
  throw new Error(
    'TOGGLEFLOW_API_KEY is required'
  );
}

const toggleflow = new ToggleFlow({
  apiKey,
  baseUrl,
  cacheTtlMs: 1_000,

  onError(error) {
    console.error(
      'ToggleFlow SDK error:',
      error.code,
      error.message
    );
  },
});

const health =
  await toggleflow.healthCheck();

console.log('Health:', health.status);

const project =
  await toggleflow.getProjectInfo();

console.log('Project:', project.name);

const flags = await toggleflow.getAllFlags({
  userId: 'sdk-example-user',
});

console.log('Flags:', flags);

const aMode = await toggleflow.isEnabled(
  'a_mode',
  {
    userId: 'sdk-example-user',
  },
  false
);

console.log('a_mode enabled:', aMode);