export interface PlatformCapabilities {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  supportsWsl: boolean;
  defaultShell: string;
  usesNativeTitleBar: boolean;
}

export function getPlatformCapabilities(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  environment: NodeJS.ProcessEnv = process.env,
): PlatformCapabilities {
  const supportsWsl = platform === 'win32';
  const defaultShell = platform === 'win32'
    ? 'powershell.exe'
    : environment.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return {
    platform,
    arch,
    supportsWsl,
    defaultShell,
    usesNativeTitleBar: platform === 'darwin',
  };
}
