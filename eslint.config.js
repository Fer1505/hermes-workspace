//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  ...tanstackConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
  },
  {
    ignores: [
      'dist/**',
      'electron/server-bundle.cjs',
      'node_modules/**',
      'playground-ws-worker/**',
      'playwright-report/**',
      'test-results/**',
      'eslint.config.js',
      'prettier.config.js',
      'vite.config.ts',
    ],
  },
  {
    rules: {
      // Runtime payloads, provider responses, persisted state, and mocks do not
      // inherit TypeScript's compile-time guarantees. Defensive null/shape
      // checks at those trust boundaries are intentional and must survive lint.
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // Keep the required gate focused on behavior and correctness. These
      // conventions are formatter/import-organizer preferences and previously
      // generated a 200+ file rewrite with no runtime value.
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/method-signature-style': 'off',
      'import/consistent-type-specifier-style': 'off',
      'import/first': 'off',
      'import/newline-after-import': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
    },
  },
  {
    // Block client-side imports of server-only MCP input types.
    // `src/types/mcp-input.ts` may carry secret-bearing fields and must
    // never be referenced from screens or shared components.
    files: ['src/screens/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/types/mcp-input',
              message:
                'mcp-input.ts is server-only (carries unmasked secrets). Import McpClientInput from @/types/mcp instead.',
            },
          ],
          patterns: [
            {
              group: ['**/types/mcp-input', '**/types/mcp-input.ts'],
              message:
                'mcp-input.ts is server-only (carries unmasked secrets). Import McpClientInput from @/types/mcp instead.',
            },
          ],
        },
      ],
    },
  },
]
