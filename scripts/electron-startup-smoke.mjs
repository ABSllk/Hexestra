import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';

const require = createRequire(import.meta.url);
const pty = require('@lydell/node-pty');
const projectRoot = path.resolve(import.meta.dirname, '..');
let window;
let terminal;
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
app.setPath('userData', path.join(os.tmpdir(), `hexestra-startup-${process.pid}`));

const startupTimeoutMs = Number(process.env.HEXESTRA_STARTUP_TIMEOUT_MS || 45_000);

const withTimeout = (promise, milliseconds, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds)),
]);

try {
  console.log(`Starting Electron smoke on ${process.platform}/${process.arch}`);
  await withTimeout(app.whenReady(), startupTimeoutMs, 'Electron app ready');
  console.log('Electron app ready');
  ipcMain.handle('app:getCapabilities', () => ({ platform: process.platform, arch: process.arch, supportsWsl: process.platform === 'win32', defaultShell: process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')), usesNativeTitleBar: process.platform === 'darwin' }));
  window = new BrowserWindow({
    show: false,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: { preload: path.join(projectRoot, 'dist-electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  await withTimeout(window.loadFile(path.join(projectRoot, 'dist', 'index.html')), startupTimeoutMs, 'Renderer load');
  console.log('Renderer loaded');
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'));
  const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-Command', 'Write-Output HEXESTRA_PTY_OK'] : ['-lc', 'printf HEXESTRA_PTY_OK'];
  terminal = pty.spawn(shell, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd: projectRoot, env: process.env });
  console.log(`PTY spawned with ${shell}`);
  const output = await new Promise((resolve, reject) => {
    let value = '';
    const timer = setTimeout(() => reject(new Error('node-pty startup smoke timed out')), 5_000);
    terminal.onData((chunk) => {
      value += chunk;
      if (value.includes('HEXESTRA_PTY_OK')) { clearTimeout(timer); resolve(value); }
    });
    terminal.onExit(({ exitCode }) => {
      if (!value.includes('HEXESTRA_PTY_OK')) reject(new Error(`node-pty exited before sentinel (${exitCode})`));
    });
  });
  console.log(`HEXESTRA_STARTUP_SMOKE_OK ${process.platform}/${process.arch} ${String(output).trim()}`);
} catch (error) {
  console.error('Electron startup smoke failed');
  console.error(error);
  process.exitCode = 1;
} finally {
  try { terminal?.kill(); } catch { /* already stopped */ }
  if (window && !window.isDestroyed()) window.destroy();
  if (app.isReady()) app.quit();
  else app.exit(1);
}
