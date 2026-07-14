import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(
  await readFile(
    new URL('../package.json', import.meta.url),
    'utf8'
  )
);

const versionSource = await readFile(
  new URL('../src/version.ts', import.meta.url),
  'utf8'
);

const match = versionSource.match(
  /TOGGLEFLOW_SDK_VERSION\s*=\s*['"]([^'"]+)['"]/
);

if (!match) {
  throw new Error(
    'Unable to find TOGGLEFLOW_SDK_VERSION in src/version.ts.'
  );
}

const sdkVersion = match[1];

if (sdkVersion !== packageJson.version) {
  throw new Error(
    `Version mismatch: package.json is ${packageJson.version}, ` +
      `but src/version.ts is ${sdkVersion}.`
  );
}

console.log(
  `Version check passed: ${packageJson.version}`
);