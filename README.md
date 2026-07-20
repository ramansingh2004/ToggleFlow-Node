# @toggleflow/node

Official Node.js SDK for ToggleFlow feature flags, segment targeting, gradual rollouts, and experiments.

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

## Typed flag keys

Provide a string union to catch misspelled flag keys during TypeScript builds:

```ts
type AppFlag =
  | 'new_checkout'
  | 'weekly_summary'
  | 'login_button';

const toggleflow = new ToggleFlow<AppFlag>({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
});

await toggleflow.isEnabled('new_checkout'); // valid
// await toggleflow.isEnabled('new_chekout'); // TypeScript error
```

The generic is optional. JavaScript projects and existing TypeScript projects
can continue using `new ToggleFlow(...)` with arbitrary string keys.

## Graceful fallback values

Configure safe defaults once for temporary API failures and startup before a
local snapshot has been loaded:

```ts
type AppFlag = 'checkout' | 'maintenance_banner';

const toggleflow = new ToggleFlow<AppFlag>({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
  fallbacks: {
    checkout: false,
    maintenance_banner: true,
  },
});
```

A fallback passed directly to `isEnabled()` or
`isEnabledFromSnapshot()` has priority over the configured value. If neither
is provided, the SDK safely returns `false`.

Use the same stable `userId` for the same application user. ToggleFlow uses it for deterministic percentage rollouts.

## Segment targeting

Pass application-user attributes when evaluating flags that use ToggleFlow segments.

```ts
const enabled = await toggleflow.isEnabled(
  'regional_checkout',
  {
    userId: 'customer-123',
    attributes: {
      country: 'IN',
      plan: 'pro',
      betaTester: true,
    },
  },
  false
);
```

Segment rules are configured in ToggleFlow. The SDK sends this evaluation context to ToggleFlow and returns the evaluated flag state.

## Flag analytics and conversions

Every flag evaluation automatically increments its real impression totals.
ToggleFlow stores only an HMAC digest of the stable `userId`, which supports
exact unique-user counts without retaining the raw identifier.

Record a conversion after the user completes the action attributed to a flag:

```ts
await toggleflow.trackFlagConversion(
  'new_checkout',
  'customer-123',
  'purchase',
  {
    // Use your business event ID so network retries cannot double-count it.
    eventId: 'order-789',
    metadata: {
      plan: 'pro',
    },
  }
);
```

Without `eventId`, ToggleFlow records at most one conversion for the same
flag, user, conversion type, and UTC day. Keep the API key on the server; do
not call this method directly from browser code.

## Experiments

### 1. Configure the experiment in ToggleFlow

In the ToggleFlow dashboard:

1. Create or select a feature flag.
2. Enable the flag.
3. Create an experiment for that flag.
4. Add at least two variants whose weights total 100%.
5. Set the conversion metric, such as `signup` or `purchase`.
6. Start the experiment.
7. Copy the experiment ID.

Only one experiment can run on a flag at a time.

### 2. Assign an application user

Call `assignExperiment()` on your server before rendering the experimental experience:

```ts
const assignment = await toggleflow.assignExperiment(
  'your-experiment-id',
  'customer-123'
);

if (assignment.variant.name === 'Treatment') {
  // Render the treatment experience.
} else {
  // Render the control experience.
}
```

The response also includes variant configuration:

```ts
const buttonText =
  assignment.variant.config?.buttonText;
```

Variant configuration values are typed as `unknown`. Validate or narrow a value before using it in application logic.

ToggleFlow deterministically assigns the user and persists one exposure. Calling `assignExperiment()` again with the same experiment ID and user ID returns the same variant.

### 3. Record the conversion

Call `trackConversion()` only after that assigned user completes the experiment's configured conversion event:

```ts
await toggleflow.trackConversion(
  'your-experiment-id',
  'customer-123'
);
```

Conversion tracking is idempotent. Repeating the call does not count the same user twice.

Assignment must happen before conversion tracking. ToggleFlow rejects a conversion if no assignment exists for that experiment and user.

### 4. Read the results

Open the experiment in ToggleFlow to inspect:

- participants and conversions per variant;
- conversion rates;
- 95% confidence intervals;
- the current winning variant;
- statistical significance.

Use the same stable application-user ID for assignment and conversion. Do not use random IDs on every request.

### Cancel an experiment request

```ts
const controller = new AbortController();

const assignment = toggleflow.assignExperiment(
  'your-experiment-id',
  'customer-123',
  {
    signal: controller.signal,
  }
);

controller.abort();

await assignment;
```

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

## Local snapshots and background polling

Long-running Node.js processes can keep an evaluated flag snapshot in memory:

```ts
type AppFlag = 'new_checkout' | 'weekly_summary';

const toggleflow = new ToggleFlow<AppFlag>({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
  fallbacks: {
    new_checkout: false,
    weekly_summary: false,
  },
  onUpdate({ changedKeys, current, isInitial }) {
    console.log('ToggleFlow snapshot updated', {
      changedKeys,
      current,
      isInitial,
    });
  },
});

await toggleflow.startPolling({
  intervalMs: 30_000,
  context: {
    userId: 'server-default',
  },
});

const enabled = toggleflow.isEnabledFromSnapshot(
  'new_checkout'
);
```

`startPolling()` performs one immediate refresh. Later refreshes are scheduled
after the previous request completes, so requests never overlap. A failed
refresh preserves the last successful snapshot and is reported through
`onError`.

Read or refresh the snapshot manually:

```ts
await toggleflow.refreshSnapshot({
  userId: 'server-default',
});

const snapshot = toggleflow.getSnapshot();
```

The returned object is an immutable defensive copy. After a successful bulk
refresh, a key omitted by the API is treated as disabled. Configured fallbacks
are only used before the first successful snapshot.

Stop polling during graceful shutdown:

```ts
toggleflow.close();
```

Polling is intended for a shared evaluation context in long-running services.
Use `isEnabled()` for user-specific segment rules, percentage rollouts, and
serverless requests.

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

## Next.js integration

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

Use it in a Server Component, Route Handler, or Server Action:

```ts
import { toggleflow } from '@/lib/toggleflow';

export default async function Page() {
  const enabled = await toggleflow.isEnabled(
    'new_checkout',
    { userId: 'stable-user-id' },
    false
  );

  return enabled ? <NewCheckout /> : <CurrentCheckout />;
}
```

Do not start background polling in Vercel or another serverless runtime.
Instances can be frozen or destroyed between requests. Use asynchronous
evaluation and the SDK request cache instead. Polling is appropriate when
Next.js runs as one long-lived Node.js server that you operate yourself.

## Express middleware example

Start polling once during application startup and expose the shared client to
request handlers:

```ts
import express from 'express';
import { ToggleFlow } from '@toggleflow/node';

type AppFlag = 'new_checkout' | 'weekly_summary';

const toggleflow = new ToggleFlow<AppFlag>({
  apiKey: process.env.TOGGLEFLOW_API_KEY!,
  fallbacks: {
    new_checkout: false,
    weekly_summary: false,
  },
});

await toggleflow.startPolling({ intervalMs: 30_000 });

const app = express();

app.use((request, response, next) => {
  response.locals.flags = toggleflow.getSnapshot();
  next();
});

app.get('/checkout', (request, response) => {
  const enabled = toggleflow.isEnabledFromSnapshot(
    'new_checkout'
  );

  response.json({ experience: enabled ? 'new' : 'current' });
});

const server = app.listen(3000);

function shutdown() {
  toggleflow.close();
  server.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
```

For flags depending on the signed-in user, evaluate inside the request instead:

```ts
const enabled = await toggleflow.isEnabled(
  'new_checkout',
  {
    userId: request.user.id,
    attributes: {
      plan: request.user.plan,
    },
  },
  false
);
```

## Telemetry roadmap

OpenTelemetry-compatible evaluation hooks are planned for a later release.
This release does not add an OpenTelemetry runtime dependency.

## CommonJS

```js
const {
  ToggleFlow,
} = require('@toggleflow/node');
```

## License

MIT
