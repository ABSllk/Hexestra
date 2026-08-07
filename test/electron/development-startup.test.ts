import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron development startup', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  const launcher = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'start-electron-dev.mjs'),
    'utf8',
  );

  it('loads the Vite server through the dedicated development launcher', () => {
    expect(packageJson.scripts['electron:dev']).toContain('node scripts/start-electron-dev.mjs');
    expect(launcher).toContain("VITE_DEV_SERVER_URL: devServerUrl");
    expect(launcher).toContain("'http://localhost:5173'");
  });

  it('isolates development Chromium data from the production profile', () => {
    expect(launcher).toContain("path.join(appDataRoot, 'hexestra-development')");
    expect(launcher).toContain('`--user-data-dir=${userDataPath}`');
    expect(launcher).toContain("path.join(appDataRoot, 'hexestra')");
    expect(launcher).toContain('HEXESTRA_USER_DATA: applicationDataPath');
  });
});
