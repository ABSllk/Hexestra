import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
const electronVersion = packageLock.packages?.['node_modules/electron']?.version;

if (!electronVersion || packageJson.allowScripts?.[`electron@${electronVersion}`] !== true) {
  throw new Error(
    `The locked Electron version (${electronVersion || 'unknown'}) must have an exact enabled `
    + '`allowScripts` entry in package.json before native prebuild verification.',
  );
}

const electronExecutable = require('electron');
const platformPackage = `@lydell/node-pty-${process.platform}-${process.arch}`;
const probeScript = path.join(import.meta.dirname, 'node-pty-prebuild-probe.cjs');
const probeTimeoutMs = process.env.CI ? 45_000 : 20_000;

try {
  require.resolve(platformPackage);
} catch {
  throw new Error(
    `Hexestra requires the prebuilt ${platformPackage} package. `
    + 'This platform/architecture is unsupported or optional dependencies were omitted. '
    + 'Hexestra does not compile node-pty from source.',
  );
}

const probe = spawnSync(
  electronExecutable,
  [probeScript],
  {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: probeTimeoutMs,
  },
);

if (probe.error || probe.status !== 0 || !probe.stdout.includes('HEXESTRA_NODE_PTY_PREBUILD_OK')) {
  const detail = String(probe.stderr || probe.error?.message || `exit code ${probe.status}`).trim();
  throw new Error(
    `The prebuilt ${platformPackage} package could not load in Electron: ${detail}. `
    + 'Hexestra will not fall back to a local source build.',
  );
}

console.log(`Verified prebuilt node-pty for Electron on ${process.platform}/${process.arch}`);
