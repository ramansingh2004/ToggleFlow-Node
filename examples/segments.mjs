import { ToggleFlow } from '../dist/index.js';

const client = new ToggleFlow({
  apiKey: process.env.TOGGLEFLOW_API_KEY,
  baseUrl:
    process.env.TOGGLEFLOW_API_URL ??
    'http://localhost:5000/api/v1',
  cacheTtlMs: 0,
  maxRetries: 0,
});

const matching = await client.isEnabled(
  'a_mode',
  {
    userId: 'segment-user-in',
    attributes: {
      country: 'IN',
    },
  },
  false
);

const nonMatching = await client.isEnabled(
  'a_mode',
  {
    userId: 'segment-user-us',
    attributes: {
      country: 'US',
    },
  },
  false
);

console.log({
  matching,
  nonMatching,
});