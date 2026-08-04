import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDataRoot = process.env.APPDATA
  ?? process.env.XDG_CONFIG_HOME
  ?? path.join(os.homedir(), '.config');
const userDataPath = process.env.HEXESTRA_DEV_USER_DATA
  ?? path.join(appDataRoot, 'hexestra-development');
const applicationDataPath = process.env.HEXESTRA_USER_DATA
  ?? path.join(appDataRoot, 'hexestra');
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const cdpPort = process.env.HEXESTRA_CDP_PORT?.trim();
if (cdpPort && !/^\d+$/.test(cdpPort)) {
  throw new Error('HEXESTRA_CDP_PORT must be a numeric TCP port');
}
const electronArgs = [
  ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []),
  `--user-data-dir=${userDataPath}`,
  '.',
];

const child = spawn(
  electronPath,
  electronArgs,
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      HEXESTRA_USER_DATA: applicationDataPath,
      VITE_DEV_SERVER_URL: devServerUrl,
    },
    stdio: 'inherit',
    windowsHide: false,
  },
);

let stopping = false;
const stopChild = () => {
  if (stopping || child.killed) return;
  stopping = true;
  child.kill();
};

process.once('SIGINT', stopChild);
process.once('SIGTERM', stopChild);
child.once('error', (error) => {
  console.error('[Hexestra] Failed to start Electron development process:', error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal && !stopping) {
    console.error(`[Hexestra] Electron development process stopped by ${signal}.`);
  }
  process.exitCode = code ?? (stopping ? 0 : 1);
});
