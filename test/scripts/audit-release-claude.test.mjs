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
