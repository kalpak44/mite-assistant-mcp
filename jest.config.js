// Native ESM, no transform. The source is `"type": "module"` and ships unbuilt, so a
// Babel step would mean tests run against transpiled code the container never executes.
// `npm test` sets NODE_OPTIONS=--experimental-vm-modules, which is what Jest needs to
// load ESM without that transform.
export default {
  testEnvironment: 'node',
  // v8, not babel: the babel provider needs the transform this config deliberately omits
  // and reports nothing for untransformed ESM.
  coverageProvider: 'v8',
  collectCoverageFrom: ['src/**/*.js'],
  // The gate. Jest exits non-zero when any of the four drops below 80, so publish.yml
  // needs no separate coverage check — and a PR that adds uncovered code fails on its own
  // PR rather than on someone else's.
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
  coverageReporters: ['text-summary', 'lcov'],
}
