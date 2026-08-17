// @vitest-environment node
import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveGlobalUserPath, resolveHexestraHome } from '@electron/services/hexestra-home';

const fixtureCwd = process.platform === 'win32' ? 'D:\\checkout\\Hexestra' : '/tmp/checkout/Hexestra';
const fixturePortableHome = process.platform === 'win32' ? 'D:\\portable\\Hexestra' : '/tmp/portable/Hexestra';
const fixtureNode = process.platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/local/bin/node';
const fixtureElectron = process.platform === 'win32'
  ? 'D:\\checkout\\Hexestra\\node_modules\\electron\\dist\\electron.exe'
  : '/tmp/checkout/Hexestra/node_modules/electron/dist/electron';
const fixturePackagedExecutable = process.platform === 'win32'
  ? 'D:\\Hexestra\\Hexestra.exe'
  : '/opt/Hexestra/Hexestra';

describe('portable Hexestra home', () => {
  it('uses an explicit portable override first', () => {
    expect(resolveHexestraHome({
      configuredPath: fixturePortableHome,
      defaultApp: true,
      cwd: fixtureCwd,
    })).toBe(path.resolve(fixturePortableHome));
  });

  it('uses the checkout root in development', () => {
    expect(resolveGlobalUserPath({
      configuredPath: null,
      defaultApp: true,
      cwd: fixtureCwd,
    })).toBe(path.join(path.resolve(fixtureCwd), 'user'));
  });

  it('treats Node and Electron launchers as development runtimes', () => {
    expect(resolveHexestraHome({
      configuredPath: null,
      cwd: fixtureCwd,
      executablePath: fixtureNode,
    })).toBe(path.resolve(fixtureCwd));
    expect(resolveHexestraHome({
      configuredPath: null,
      cwd: fixtureCwd,
      executablePath: fixtureElectron,
    })).toBe(path.resolve(fixtureCwd));
  });

  it('uses the executable directory when packaged', () => {
    expect(resolveGlobalUserPath({
      configuredPath: null,
      defaultApp: false,
      executablePath: fixturePackagedExecutable,
    })).toBe(path.join(path.dirname(path.resolve(fixturePackagedExecutable)), 'user'));
  });
});
