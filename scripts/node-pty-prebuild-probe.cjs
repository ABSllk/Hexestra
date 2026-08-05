const pty = require('@lydell/node-pty');

const sentinel = 'HEXESTRA_NODE_PTY_PREBUILD_OK';
const probeTimeoutMs = process.env.CI ? 30_000 : 10_000;
const shell = process.platform === 'win32'
  ? 'powershell.exe'
  : process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
const args = process.platform === 'win32'
  ? ['-NoLogo', '-NoProfile', '-Command', `Write-Output ${sentinel}`]
  : ['-lc', `printf ${sentinel}`];
const terminal = pty.spawn(shell, args, {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
  useConptyDll: false,
});

let output = '';
const timeout = setTimeout(() => {
  console.error('node-pty prebuilt probe timed out');
  process.exit(1);
}, probeTimeoutMs);

terminal.onData((chunk) => {
  output += chunk;
});

terminal.onExit(({ exitCode }) => {
  clearTimeout(timeout);
  if (exitCode === 0 && output.includes(sentinel)) {
    process.stdout.write(sentinel);
    process.exit(0);
  }
  console.error(`node-pty prebuilt probe failed (${exitCode}): ${output.trim()}`);
  process.exit(1);
});
