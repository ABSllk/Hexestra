export type AgentAttachmentKind = 'text' | 'image' | 'pdf' | 'file';

export interface AgentAttachmentMetadata {
  id: string;
  name: string;
  path: string;
  kind: AgentAttachmentKind;
  mimeType: string;
  size: number;
}

export interface AgentAttachment extends AgentAttachmentMetadata {
  content?: string;
  base64?: string;
}

export type AgentAttachmentPicker = 'files' | 'images';

export function attachmentMetadata(attachment: AgentAttachment): AgentAttachmentMetadata {
  const { content: _content, base64: _base64, ...metadata } = attachment;
  return metadata;
}
