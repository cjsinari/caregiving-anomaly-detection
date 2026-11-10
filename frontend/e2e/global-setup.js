import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startAuthService } from './service';

/*
 * Seed the test database, then start the auth service.
 *
 * Seeding first and from scratch (--reset) is what makes the assertions
 * meaningful: the test opens the anomaly queue and resolves a flagged sign-in,
 * so there has to be one, and it has to be one this run put there rather than
 * whatever a previous run happened to leave behind.
 */
export default async function globalSetup() {
  const authDir = resolve(process.cwd(), '..', 'auth-service');

  process.stdout.write('[e2e] seeding the test database…\n');
  execFileSync(process.execPath, ['seed.js', '--env', '.env.test', '--reset', '--days', '14'], {
    cwd: authDir,
    stdio: process.env.E2E_VERBOSE ? 'inherit' : 'ignore',
  });

  process.stdout.write('[e2e] starting the auth service…\n');
  const child = await startAuthService();

  // Handed to the teardown through the global, which is how Playwright passes
  // state between setup and teardown without a file.
  globalThis.__authService = child;
  process.stdout.write('[e2e] ready\n');
}
