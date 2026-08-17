// @vitest-environment node
import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveGlobalUserPath, resolveHexestraHome } from '@electron/services/hexestra-home';

describe('portable Hexestra home', () => {
  it('uses an explicit portable override first', () => {
    expect(resolveHexestraHome({
      configuredPath: 'D:\\portable\\Hexestra',
      defaultApp: true,
      cwd: 'D:\\checkout',
    })).toBe(path.resolve('D:\\portable\\Hexestra'));
  });

  it('uses the checkout root in development', () => {
    expect(resolveGlobalUserPath({
      configuredPath: null,
      defaultApp: true,
      cwd: 'D:\\checkout\\Hexestra',
    })).toBe(path.join(path.resolve('D:\\checkout\\Hexestra'), 'user'));
  });

  it('treats Node and Electron launchers as development runtimes', () => {
    expect(resolveHexestraHome({
      configuredPath: null,
      cwd: 'D:\\checkout\\Hexestra',
      executablePath: 'C:\\Program Files\\nodejs\\node.exe',
    })).toBe(path.resolve('D:\\checkout\\Hexestra'));
    expect(resolveHexestraHome({
      configuredPath: null,
      cwd: 'D:\\checkout\\Hexestra',
      executablePath: 'D:\\checkout\\Hexestra\\node_modules\\electron\\dist\\electron.exe',
    })).toBe(path.resolve('D:\\checkout\\Hexestra'));
  });

  it('uses the executable directory when packaged', () => {
    expect(resolveGlobalUserPath({
      configuredPath: null,
      defaultApp: false,
      executablePath: 'D:\\Hexestra\\Hexestra.exe',
    })).toBe(path.join(path.dirname(path.resolve('D:\\Hexestra\\Hexestra.exe')), 'user'));
  });
});
