import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const projectRoot = resolve(import.meta.dirname, '..');
const testRoot = mkdtempSync(join(tmpdir(), 'hexestra-terminal-remount-'));
const userDataPath = join(testRoot, 'chromium');
const applicationDataPath = join(testRoot, 'application');
const fatalOutput = /AttachConsole failed|UnhandledPromiseRejection|uncaught exception|render-process-gone/i;

let vite;
let electron;
let browser;
let stdout = '';
let stderr = '';

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate a smoke-test port'));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitFor(predicate, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function run() {
  const cdpPort = await getFreePort();
  vite = await createViteServer({
    root: projectRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await vite.listen();
  const devUrl = vite.resolvedUrls?.local[0];
  if (!devUrl) throw new Error('Vite did not expose a local URL');

  electron = spawn(electronPath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataPath}`,
    '.',
  ], {
    cwd: projectRoot,
    windowsHide: true,
    env: {
      ...process.env,
      HEXESTRA_USER_DATA: applicationDataPath,
      VITE_DEV_SERVER_URL: devUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  electron.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  electron.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    return response.ok;
  }, 'Electron CDP endpoint did not become ready');

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = await waitFor(async () => {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        if (await candidate.title().catch(() => '') === 'Hexestra') return candidate;
      }
    }
    return null;
  }, 'Hexestra renderer page did not become ready');

  await page.getByRole('button', { name: 'New Terminal' }).click();
  await page.locator('.xterm-container .xterm').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);

  const mountedSessions = await page.evaluate(() => window.hexestra.invoke('terminal:list'));
  if (mountedSessions.length !== 1) {
    throw new Error(`StrictMode mount left ${mountedSessions.length} PTY sessions instead of one`);
  }
  const createdCount = (stdout.match(/\[PTY\] Created session/g) ?? []).length;
  if (createdCount !== 1) {
    throw new Error(`StrictMode mount created ${createdCount} PTYs instead of one`);
  }

  await page.locator('button[aria-label^="Close Terminal"]').click();
  await waitFor(async () => (
    await page.evaluate(() => window.hexestra.invoke('terminal:list'))
  ).length === 0, 'Closed Terminal tab remained visible in terminal:list');
  await page.waitForTimeout(900);

  const closedCount = (stdout.match(/\[PTY\] Closed session/g) ?? []).length;
  if (closedCount !== 1) throw new Error(`Final cleanup closed the PTY ${closedCount} times instead of once`);
  const combinedOutput = `${stdout}\n${stderr}`;
  if (fatalOutput.test(combinedOutput)) {
    throw new Error(`Electron emitted a fatal runtime error:\n${combinedOutput}`);
  }

  process.stdout.write('TERMINAL_REMOUNT_SMOKE_OK one PTY reused and closed without AttachConsole failure\n');
}

try {
  await run();
} catch (error) {
  process.stderr.write(`TERMINAL_REMOUNT_SMOKE_FAILED ${error instanceof Error ? error.stack : String(error)}\n`);
  if (stdout || stderr) process.stderr.write(`--- Electron output ---\n${stdout}\n${stderr}\n`);
  process.exitCode = 1;
} finally {
  try {
    const pages = browser?.contexts().flatMap((context) => context.pages()) ?? [];
    await pages[0]?.evaluate(() => window.hexestra.invoke('app:window:close')).catch(() => {});
  } catch {}
  await new Promise((resolveExit) => {
    if (!electron || electron.exitCode !== null) {
      resolveExit();
      return;
    }
    const timeout = setTimeout(() => {
      electron.kill();
      resolveExit();
    }, 2_000);
    electron.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
  await browser?.close().catch(() => {});
  await vite?.close();
  rmSync(testRoot, { recursive: true, force: true });
}
