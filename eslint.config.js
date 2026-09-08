const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  {
    ignores: [
      'android/**',
      'ios/**',
      '**/build/**',
      '**/.gradle/**',
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'web-build/**',
      'artifacts/**',
      'qa-artifacts/**',
      'test-builds/**',
      'tmp/**',
      'tmp-*',
      '.tmp-*',
      '.qa/**',
      '.qa-*',
      '.research/**',
      '.tooling/**',
      // Promotional renderers are separate projects with their own lint tools.
      // Do not traverse their frame exports or apply React Native rules to them.
      'tools/promo/**',
      // This gate is deliberately TypeScript/React-only. The two Node services
      // have independent runtimes and should receive their own Node ESLint job.
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },
  ...expoConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-promise-executor-return': 'error',
      'no-unsafe-finally': 'error',
      'no-unreachable-loop': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react/no-unescaped-entities': 'error',
    },
  },
]);
