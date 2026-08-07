// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { attachmentPromptContext, buildAgentSdkPrompt, readAgentAttachment } from '@electron/services/agent-attachment';

describe('Agent attachments', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads text attachments and keeps their content in prompt context', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-attachment-'));
    roots.push(root);
    const file = path.join(root, 'notes.md');
    fs.writeFileSync(file, '# Target notes', 'utf8');

    const attachment = readAgentAttachment(file);

    expect(attachment).toMatchObject({ name: 'notes.md', kind: 'text', mimeType: 'text/markdown' });
    expect(attachmentPromptContext([attachment])[0]).toMatchObject({ content: '# Target notes' });
  });

  it('creates a structured SDK user message for image attachments', async () => {
    const prompt = buildAgentSdkPrompt('Inspect this image', [{
      id: 'image-1', name: 'screen.png', path: 'C:\\screen.png', kind: 'image',
      mimeType: 'image/png', size: 3, base64: 'YWJj',
    }]);
    expect(typeof prompt).not.toBe('string');
    const messages = [];
    for await (const message of prompt as AsyncIterable<SDKUserMessage>) messages.push(message);
    expect(messages[0].message.content).toEqual([
      { type: 'text', text: 'Inspect this image' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } },
    ]);
  });
});
