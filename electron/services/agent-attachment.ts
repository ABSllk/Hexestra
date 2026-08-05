import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentAttachment, AgentAttachmentPicker } from '../agent-attachment-contract';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const IMAGE_MIME = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const TEXT_EXTENSIONS = new Set([
  '.bat', '.c', '.cfg', '.conf', '.cpp', '.cs', '.css', '.csv', '.go', '.h', '.html',
  '.ini', '.java', '.js', '.json', '.jsx', '.log', '.md', '.php', '.ps1', '.py', '.rb',
  '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

export const ATTACHMENT_DIALOG_FILTERS: Record<AgentAttachmentPicker, Electron.FileFilter[]> = {
  images: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  files: [
    { name: 'Supported files', extensions: [...TEXT_EXTENSIONS].map((value) => value.slice(1)).concat('pdf') },
    { name: 'All files', extensions: ['*'] },
  ],
};

export function readAgentAttachment(filePath: string): AgentAttachment {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${path.basename(filePath)} is not a file`);
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${path.basename(filePath)} exceeds the 10 MB attachment limit`);
  }

  const extension = path.extname(filePath).toLowerCase();
  const imageMime = IMAGE_MIME.get(extension);
  const metadata = {
    id: `attachment-${randomUUID()}`,
    name: path.basename(filePath),
    path: path.resolve(filePath),
    size: stat.size,
  };
  if (imageMime) {
    return {
      ...metadata,
      kind: 'image',
      mimeType: imageMime,
      base64: fs.readFileSync(filePath).toString('base64'),
    };
  }
  if (extension === '.pdf') {
    return {
      ...metadata,
      kind: 'pdf',
      mimeType: 'application/pdf',
      base64: fs.readFileSync(filePath).toString('base64'),
    };
  }
  if (TEXT_EXTENSIONS.has(extension) || stat.size <= MAX_TEXT_BYTES && looksLikeText(filePath)) {
    if (stat.size > MAX_TEXT_BYTES) {
      throw new Error(`${path.basename(filePath)} exceeds the 2 MB text attachment limit`);
    }
    return {
      ...metadata,
      kind: 'text',
      mimeType: textMime(extension),
      content: fs.readFileSync(filePath, 'utf8'),
    };
  }
  return { ...metadata, kind: 'file', mimeType: 'application/octet-stream' };
}

export function buildAgentSdkPrompt(
  prompt: string,
  attachments: AgentAttachment[] = [],
): string | AsyncIterable<SDKUserMessage> {
  const embedded = attachments.filter((attachment) => (
    (attachment.kind === 'image' || attachment.kind === 'pdf') && attachment.base64
  ));
  if (embedded.length === 0) return prompt;

  return (async function* messageStream() {
    const content: SDKUserMessage['message']['content'] = [
      { type: 'text', text: prompt },
      ...embedded.map((attachment) => attachment.kind === 'image'
        ? {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: imageMediaType(attachment.mimeType),
              data: attachment.base64!,
            },
          }
        : {
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf' as const,
              data: attachment.base64!,
            },
            title: attachment.name,
          }),
    ];
    yield {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    };
  })();
}

export function attachmentPromptContext(attachments: AgentAttachment[] = []) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    path: attachment.path,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    size: attachment.size,
    ...(attachment.kind === 'text' ? { content: attachment.content ?? '' } : {}),
  }));
}

function looksLikeText(filePath: string) {
  const sample = fs.readFileSync(filePath).subarray(0, 4_096);
  return !sample.includes(0);
}

function textMime(extension: string) {
  if (extension === '.json') return 'application/json';
  if (extension === '.xml') return 'application/xml';
  if (extension === '.html') return 'text/html';
  if (extension === '.csv') return 'text/csv';
  if (extension === '.md') return 'text/markdown';
  return 'text/plain';
}

function imageMediaType(value: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (value === 'image/png' || value === 'image/gif' || value === 'image/webp') return value;
  return 'image/jpeg';
}
