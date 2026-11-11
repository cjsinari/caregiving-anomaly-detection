import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/*
 * Running the auth service for the end-to-end test, and getting the codes out
 * of it.
 *
 * ── The problem ──
 *
 * Signing in needs a six-digit code. In development the service prints it to
 * its own stdout instead of sending an SMS, and the OTP table stores an
 * HMAC-SHA256 digest rather than the code, so the code cannot be read back out
 * of the database — which is the right design and exactly what makes it awkward
 * to automate.
 *
 * ── The approach, and what was rejected ──
 *
 * The service is spawned here with its stdout piped, and the codes it prints
 * are written to a scratch file the test polls. Nothing is added to the service
 * itself.
 *
 * The alternative was a test-only endpoint that hands back the current code.
 * That was rejected: it would be a route in production code whose entire
 * purpose is to defeat the second factor, guarded by nothing but an environment
 * variable that someone will eventually set wrong. A test harness reading the
 * log it already prints is strictly contained to the test.
 *
 * Playwright's own `webServer` cannot do this — it has no way to expose a
 * server's output to a test — which is why the service is spawned by hand and
 * only the dashboard is left to `webServer`.
 */

const AUTH_DIR = resolve(process.cwd(), '..', 'auth-service');
const OTP_FILE = resolve(process.cwd(), 'e2e', '.otps.json');

const read = () => {
  try { return JSON.parse(readFileSync(OTP_FILE, 'utf8')); } catch { return {}; }
};

const write = (data) => {
  mkdirSync(dirname(OTP_FILE), { recursive: true });
  writeFileSync(OTP_FILE, JSON.stringify(data));
};

/** Start the auth service against the test database, capturing its codes. */
export async function startAuthService() {
  write({});

  const child = spawn(process.execPath, ['index.js'], {
    cwd: AUTH_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // The test database, so the run cannot touch development data.
      DOTENV_CONFIG_PATH: '.env.test',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} -r dotenv/config`.trim(),
      OTP_DEV_MODE: 'true',
      NODE_ENV: 'development',
      PORT: '3000',
      // The dashboard is served from the preview server during the test, so it
      // has to be an allowed origin — the same arrangement production uses,
      // rather than the test disabling the check it is meant to exercise.
      CORS_ORIGINS: 'http://localhost:4173,http://127.0.0.1:4173',
      // One proxy hop, so the test can place a request from a Kenyan address
      // and get a plausible risk score instead of one from 127.0.0.1.
      TRUST_PROXY: '1',
    },
  });

  const onLine = (line) => {
    const match = /\[DEV\] OTP for (\S+) \((\w+)\): (\d{6})/.exec(line);
    if (match) {
      const codes = read();
      codes[`${match[1]}:${match[2]}`] = { otp: match[3], at: Date.now() };
      write(codes);
    }
  };

  const pump = (stream) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        onLine(line);
        if (process.env.E2E_VERBOSE) process.stdout.write(`[auth] ${line}\n`);
      }
    });
  };

  pump(child.stdout);
  pump(child.stderr);

  // Wait for it to answer rather than sleeping a fixed amount: a fixed sleep is
  // either slower than it needs to be or shorter than a cold start.
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('The auth service did not become healthy within 30 seconds.');
    }
    try {
      const response = await fetch('http://127.0.0.1:3000/health');
      if (response.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }

  return child;
}

/**
 * The most recent code printed for a number and purpose.
 *
 * Polls, because the code is printed as the request is handled and the test
 * asks for it immediately afterwards. `after` discards a code printed before a
 * known moment, so a second request cannot be satisfied by the first one's code.
 */
export async function waitForOtp(phone, purpose, { after = 0, timeoutMs = 15_000 } = {}) {
  const key = `${phone}:${purpose}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const entry = read()[key];
    if (entry && entry.at >= after) return entry.otp;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No ${purpose} code appeared for ${phone} within ${timeoutMs}ms.`);
}

export function cleanupOtpFile() {
  if (existsSync(OTP_FILE)) rmSync(OTP_FILE, { force: true });
}
