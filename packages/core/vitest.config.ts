import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Several tests spin up a real mock HTTP server and run an end-to-end fetch through the executor.
    // CI Linux runners can be slower than local dev, so allow a comfortable margin above the 5s default.
    testTimeout: 15_000,
  },
})
