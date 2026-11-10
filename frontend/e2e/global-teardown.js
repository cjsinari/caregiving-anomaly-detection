import { cleanupOtpFile } from './service';

/*
 * Stop the service and remove the captured codes.
 *
 * The codes are short-lived and for a test account, but leaving a file of
 * one-time passwords on disk after a test run is a bad habit to build into a
 * project whose subject is authentication.
 */
export default async function globalTeardown() {
  const child = globalThis.__authService;
  if (child && !child.killed) {
    child.kill();
    // Give it a moment to close its database and Redis connections before the
    // process exits, so a run does not leave sockets behind.
    await new Promise((r) => setTimeout(r, 500));
  }
  cleanupOtpFile();
}
