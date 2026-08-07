import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findExtractedExecutable,
  MITMPROXY_RUNTIME_VERSION,
  resolveRuntimeRelease,
  stageExtractedRuntime,
  verifyArchiveDigest,
} from './prepare-mitmproxy-runtime.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('bundled mitmproxy release preparation', () => {
  it('packages the runtime without Authenticode-mutating the PyInstaller executable', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const mitmproxyResources = packageJson.build.extraResources.find(
      (entry) => entry.from === 'resources/mitmproxy',
    );
    expect(mitmproxyResources.filter).toContain('bin/**/*');
    expect(packageJson.build.win.signExts).toContain('!mitmdump.exe');
    expect(packageJson.build.mac.binaries).toContain(
      'Contents/Resources/mitmproxy/bin/mitmproxy.app/Contents/MacOS/mitmdump',
    );
  });

  it('maps every shipped platform and architecture to a pinned official archive', () => {
    expect(resolveRuntimeRelease('win32', 'x64')).toMatchObject({
      archiveName: `mitmproxy-${MITMPROXY_RUNTIME_VERSION}-windows-x86_64.zip`,
      executableName: 'mitmdump.exe',
    });
    expect(resolveRuntimeRelease('linux', 'x64').archiveName).toContain('linux-x86_64');
    expect(resolveRuntimeRelease('darwin', 'x64').archiveName).toContain('macos-x86_64');
    expect(resolveRuntimeRelease('darwin', 'arm64').archiveName).toContain('macos-arm64');
    expect(() => resolveRuntimeRelease('win32', 'arm64')).toThrow('not bundled');
  });

  it('rejects archives that do not match the pinned digest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-mitm-release-'));
    roots.push(root);
    const archive = path.join(root, 'archive.zip');
    fs.writeFileSync(archive, 'verified fixture');
    await expect(verifyArchiveDigest(
      archive,
      'f9adb7d924ed98c558040c910600d7363d749e7d20e8d355626edd53b4fb929f',
    )).resolves.toBe('f9adb7d924ed98c558040c910600d7363d749e7d20e8d355626edd53b4fb929f');
    await expect(verifyArchiveDigest(archive, '0'.repeat(64))).rejects.toThrow('SHA-256 mismatch');
  });

  it('requires one exact mitmdump executable in the extracted archive', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-mitm-release-'));
    roots.push(root);
    const executable = path.join(root, 'nested', 'mitmdump');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, 'fixture');
    await expect(findExtractedExecutable(root, 'mitmdump')).resolves.toBe(executable);
    fs.writeFileSync(path.join(root, 'mitmdump'), 'duplicate');
    await expect(findExtractedExecutable(root, 'mitmdump')).rejects.toThrow('found 2');
  });

  it('preserves the complete official macOS app bundle', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-mitm-release-'));
    roots.push(root);
    const extractionRoot = path.join(root, 'extracted');
    const destinationRoot = path.join(root, 'staged');
    const executable = path.join(
      extractionRoot,
      'mitmproxy.app',
      'Contents',
      'MacOS',
      'mitmdump',
    );
    const framework = path.join(
      extractionRoot,
      'mitmproxy.app',
      'Contents',
      'Frameworks',
      'Python',
    );
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.mkdirSync(path.dirname(framework), { recursive: true });
    fs.writeFileSync(executable, 'executable');
    fs.writeFileSync(framework, 'runtime dependency');
    fs.mkdirSync(destinationRoot, { recursive: true });

    await expect(stageExtractedRuntime(
      extractionRoot,
      destinationRoot,
      { executableName: 'mitmdump' },
      'darwin',
    )).resolves.toBe(path.join(
      destinationRoot,
      'mitmproxy.app',
      'Contents',
      'MacOS',
      'mitmdump',
    ));
    expect(fs.readFileSync(path.join(
      destinationRoot,
      'mitmproxy.app',
      'Contents',
      'Frameworks',
      'Python',
    ), 'utf8')).toBe('runtime dependency');
  });
});
