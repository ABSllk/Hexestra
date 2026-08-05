import { createRequire } from 'node:module';
import process from 'node:process';
import { query } from '@anthropic-ai/claude-agent-sdk';

const require = createRequire(import.meta.url);
const { spawnClaudeCodeInWsl } = require('../dist-electron/services/wsl-agent-runtime.js');

const settings = {
  version: 1,
  executionMode: 'wsl',
  wslDistribution: process.env.HEXESTRA_WSL_DISTRO || 'Ubuntu-24.04',
  claudeExecutable: process.env.HEXESTRA_WSL_CLAUDE || '/usr/bin/claude',
  model: null,
  settingSources: ['user'],
};
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 90_000);
let result = '';

try {
  for await (const message of query({
    prompt: 'Reply with exactly HEXESTRA_WSL_OK and no other text.',
    options: {
      abortController: controller,
      cwd: process.cwd(),
      pathToClaudeCodeExecutable: settings.claudeExecutable,
      spawnClaudeCodeProcess: (options) => spawnClaudeCodeInWsl(options, settings),
      persistSession: false,
      settingSources: settings.settingSources,
      tools: [],
    },
  })) {
    if (message.type === 'result' && message.subtype === 'success') result = message.result;
  }
} finally {
  clearTimeout(timeout);
}

if (!result.includes('HEXESTRA_WSL_OK')) {
  throw new Error(`Unexpected WSL Agent response: ${result || '(empty)'}`);
}
console.log(result.trim());
