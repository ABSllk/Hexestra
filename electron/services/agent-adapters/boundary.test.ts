// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../../..');

describe('Agent backend boundary', () => {
  it('keeps Claude SDK imports out of the coordinator, contracts, and neutral tools', () => {
    const files = [
      path.join(projectRoot, 'electron/services/agent.service.ts'),
      path.join(projectRoot, 'electron/contracts/agent-runtime.ts'),
      path.join(projectRoot, 'electron/contracts/agent-tools.ts'),
      ...fs.readdirSync(path.join(projectRoot, 'electron/services/agent-tools'))
        .filter((file) => file.endsWith('.ts'))
        .map((file) => path.join(projectRoot, 'electron/services/agent-tools', file)),
    ];
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/@anthropic-ai\/claude-agent-sdk/);
    }
  });
});
