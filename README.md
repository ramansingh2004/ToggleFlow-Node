# @toggleflow/node

Official Node.js SDK for ToggleFlow feature flags.

## Requirements

- Node.js 20 or newer
- A ToggleFlow project
- A ToggleFlow project API key

## Installation

```bash
npm install @toggleflow/node
```

## Quick start

```ts
import { ToggleFlow } from '@toggleflow/node';

const toggleflow = new ToggleFlow({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
});

const enabled = await toggleflow.isEnabled(
  'new_checkout',
  {
    userId: 'customer-123',
  },
  false
);

if (enabled) {
  console.log('Show the new checkout');
}
```

Use the same stable `userId` for the same application user. ToggleFlow uses it for deterministic percentage rollouts.

## Local ToggleFlow server

```ts
const toggleflow = new ToggleFlow({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
  baseUrl: 'http://localhost:5000/api/v1',
});
```

## Get one flag

```ts
const flag = await toggleflow.getFlag(
  'new_checkout',
  {
    userId: 'customer-123',
  }
);

console.log(flag.key);
console.log(flag.name);
console.log(flag.enabled);
```

## Evaluate one flag safely

```ts
const enabled = await toggleflow.isEnabled(
  'new_checkout',
  {
    userId: 'customer-123',
  },
  false
);
```

The final argument is the fallback value. It is used when:

- the flag does not exist;
- ToggleFlow is unavailable;
- the request times out;
- an invalid response is received;
- no usable cached value exists.

## Get all flags

```ts
const flags = await toggleflow.getAllFlags({
  userId: 'customer-123',
});

if (flags.new_checkout) {
  // Show the new checkout.
}
```

Disabled flags may be omitted from the bulk response. Treat a missing key as false:

```ts
const enabled =
  flags.new_checkout ?? false;
```

## Project information

```ts
const project =
  await toggleflow.getProjectInfo();

console.log(project.name);
console.log(project.slug);
console.log(project.enabledFlagCount);
```

## Health check

```ts
const health =
  await toggleflow.healthCheck();

console.log(health.status);
```

The health endpoint is public, but constructing the SDK still requires a project API key.

## Caching

Evaluations are cached in memory by flag key and application user.

```ts
const toggleflow = new ToggleFlow({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
  cacheTtlMs: 30_000,
  staleTtlMs: 5 * 60_000,
  maxCacheEntries: 1_000,
});
```

Defaults:

| Option | Default |
|---|---:|
| `cacheTtlMs` | 30 seconds |
| `staleTtlMs` | 5 minutes |
| `maxCacheEntries` | 1,000 |

When the fresh cache expires, the SDK requests a new evaluation. If that request fails, `isEnabled()` can use the last-known-good value until its stale lifetime expires.

Clear the cache manually:

```ts
toggleflow.clearCache();
```

## Retries

The SDK retries transient failures:

- network errors;
- request timeouts;
- HTTP 408;
- HTTP 429;
- HTTP 5xx.

It does not retry authentication failures, missing flags, invalid arguments, or invalid successful responses.

```ts
const toggleflow = new ToggleFlow({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
  maxRetries: 2,
  retryBaseDelayMs: 100,
  retryMaxDelayMs: 5_000,
});
```

## Error reporting

Fail-safe evaluation can report swallowed errors:

```ts
const toggleflow = new ToggleFlow({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,

  onError(error) {
    console.error(
      'ToggleFlow evaluation failed',
      {
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      }
    );
  },
});
```

Strict methods such as `getFlag()` and `getAllFlags()` throw `ToggleFlowError`.

```ts
import {
  ToggleFlowError,
  isToggleFlowError,
} from '@toggleflow/node';

try {
  await toggleflow.getFlag('new_checkout');
} catch (error) {
  if (isToggleFlowError(error)) {
    console.error(error.code);
  }
}
```

## Request cancellation

```ts
const controller = new AbortController();

const promise = toggleflow.getFlag(
  'new_checkout',
  {
    userId: 'customer-123',
    signal: controller.signal,
  }
);

controller.abort();

await promise;
```

## Next.js security

Only use the SDK on the server.

```env
TOGGLEFLOW_API_KEY=tf_your_secret_key
```

Never expose an API key using:

```env
NEXT_PUBLIC_TOGGLEFLOW_API_KEY=...
```

Create one shared server-side client:

```ts
import 'server-only';
import { ToggleFlow } from '@toggleflow/node';

export const toggleflow = new ToggleFlow({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
  baseUrl: process.env.TOGGLEFLOW_API_URL,
});
```

Creating one shared instance is important because the in-memory cache belongs to that SDK instance.

## CommonJS

```js
const {
  ToggleFlow,
} = require('@toggleflow/node');
```

## License

MIT