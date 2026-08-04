import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from './platform';

describe('platform capabilities', () => {
  it('uses WSL and PowerShell only on Windows', () => {
    expect(getPlatformCapabilities('win32', 'x64', { ComSpec: 'cmd.exe' })).toMatchObject({
      supportsWsl: true, defaultShell: 'powershell.exe', usesNativeTitleBar: false,
    });
    expect(getPlatformCapabilities('linux', 'x64', {})).toMatchObject({
      supportsWsl: false, defaultShell: '/bin/bash', usesNativeTitleBar: false,
    });
  });

  it('uses zsh fallback on macOS when SHELL is missing', () => {
    expect(getPlatformCapabilities('darwin', 'arm64', {})).toMatchObject({
      supportsWsl: false, defaultShell: '/bin/zsh', usesNativeTitleBar: true,
    });
  });
});
