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
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
};
