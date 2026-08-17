import path from 'path';

export interface HexestraHomeResolutionInput {
  configuredPath?: string | null;
  defaultApp?: boolean;
  cwd?: string;
  executablePath?: string;
}

/**
 * Resolve the portable Hexestra installation root.
 * Development runs use the checkout working directory; packaged runs use the
 * executable directory. HEXESTRA_HOME is the explicit portable override.
 */
export function resolveHexestraHome(input: HexestraHomeResolutionInput = {}): string {
  const configured = input.configuredPath ?? process.env.HEXESTRA_HOME;
  if (configured?.trim()) return path.resolve(configured.trim());
  const executablePath = input.executablePath ?? process.execPath;
  const executableName = path.basename(executablePath, path.extname(executablePath)).toLowerCase();
  const defaultApp = input.defaultApp
    ?? (Boolean((process as NodeJS.Process & { defaultApp?: boolean }).defaultApp)
      || executableName === 'node'
      || executableName === 'electron');
  return defaultApp
    ? path.resolve(input.cwd ?? process.cwd())
    : path.dirname(path.resolve(executablePath));
}

export function resolveGlobalUserPath(input: HexestraHomeResolutionInput = {}): string {
  return path.join(resolveHexestraHome(input), 'user');
}
