import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditClaudePackageTree } from '../../scripts/audit-release-claude.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-release-audit-'));
  roots.push(root);
  return root;
}

describe('release Claude audit', () => {
  it('keeps the JavaScript SDK in the app while excluding platform CLIs', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const files = packageJson.build?.files ?? [];
    expect(files).toContain('node_modules/@anthropic-ai/claude-agent-sdk/**/*');
    expect(files).toContain('!node_modules/@anthropic-ai/claude-agent-sdk-darwin-*/**');
    expect(files).toContain('!node_modules/@anthropic-ai/claude-agent-sdk-linux-*/**');
    expect(files).toContain('!node_modules/@anthropic-ai/claude-agent-sdk-win32-*/**');
    expect(files).toContain('!**/claude');
    expect(files).toContain('!**/claude.exe');
    expect(files).toContain('!**/claude.cmd');
    expect(files).toContain('!**/claude.bat');
  });

  it('requires the JavaScript SDK and rejects platform CLI files', () => {
    const root = fixture();
    const sdk = path.join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json');
    const cli = path.join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe');
    fs.mkdirSync(path.dirname(sdk), { recursive: true });
    fs.writeFileSync(sdk, '{}');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, 'not a real executable');
    const result = auditClaudePackageTree(root);
    expect(result.hasJavaScriptSdk).toBe(true);
    expect(result.forbidden).toHaveLength(1);
  });
});
