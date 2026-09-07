import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

/**
 * End-to-end against the production build, under the production headers.
 *
 * `webServer` runs the same static server for every suite and serves `dist/`
 * with the policy `dist/_headers` carries, so nothing here can pass in a
 * permissiveness the deployed app does not have. The build is not run for you:
 * `pnpm build` first, which is what the task verifications say.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  workers: 1,
  reporter: process.env.CI !== undefined ? 'github' : 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    command: `node e2e/serve.mjs dist`,
    url: BASE_URL,
    reuseExistingServer: process.env.CI === undefined,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
