const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  name: pkg.name,
  displayName: pkg.name,
  // The shared base matches only `*.test.js`; this extension's suites are
  // TypeScript, so under the base pattern `yarn jest extensions/pacsai-hp`
  // found nothing and exited 1 — which is how 60 tests sat unrun in CI.
  testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // Before the catch-all, which maps any `@ohif/…` to a platform package's
    // src and so could not load a file inside one (pinGeneration, imported as
    // OHIFCornerstoneViewport imports it) or an extension (the priors loader's
    // @ohif/extension-default) — not even as a mock.
    '^@ohif/core/src/(.*)$': '<rootDir>/../../platform/core/src/$1',
    '^@ohif/extension-default$': '<rootDir>/../default/src',
    // The radcopilot mode's test (src/readingDock/radcopilotMode.test.ts) loads
    // the mode from modes/ and mocks its two imports by these names.
    '^@ohif/mode-longitudinal$': '<rootDir>/../../modes/longitudinal/src/index.ts',
    '^@ohif/extension-pacsai-hp$': '<rootDir>/src/index.tsx',
    // OHIF's tracking prompts off in radcopilot (src/readingDock/trackingPrompts.test.tsx,
    // radcopilotMode.test.ts): measurement-tracking's context and panel, their
    // imports mocked by these names.
    '^@ohif/extension-measurement-tracking$': '<rootDir>/../measurement-tracking/src/index.tsx',
    '^@ohif/extension-cornerstone$': '<rootDir>/../cornerstone/src/index.tsx',
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
};
