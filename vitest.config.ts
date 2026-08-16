import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// Keep test collection independent from application Vite plugins. In
// particular, importing vite.config.ts would construct managed-service
// lifecycle hooks that may inspect or reuse live loopback services.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./src/test/network-guard.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/skills-bundle/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
    server: {
      deps: {
        inline: [
          'react',
          'react-dom',
          '@testing-library/react',
          '@testing-library/dom',
        ],
      },
    },
  },
})
