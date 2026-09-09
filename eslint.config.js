import js from '@eslint/js'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // package-lock.json aside, nothing outside src is JavaScript this project owns.
  globalIgnores(['node_modules']),
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      // The MCP server is plain Node ESM — `process`, `console`, `fetch`, `URL` and
      // `Buffer` all come from the runtime, and without globals.node every one of them
      // is reported as `no-undef`.
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // A caught error the handler deliberately ignores is the common case here, and
      // renaming it to `_err` is clearer than disabling the rule for the whole block.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // describe/test/expect and the lifecycle hooks are injected by Jest, so without this
  // every test file is one long list of no-undef. `jest` itself is imported from
  // @jest/globals in each test rather than taken from here, because native ESM has no
  // injected `jest` object.
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
])
