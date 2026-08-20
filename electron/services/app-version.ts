let cachedVersion: string | undefined;

/**
 * Resolve the running application version from the Electron runtime.
 * Falls back safely to '0.0.0' outside an Electron runtime (for example in unit
 * tests that import a service without an Electron app), and caches the result.
 */
export async function resolveAppVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const { app } = await import('electron');
    cachedVersion = app?.getVersion?.() ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}
