import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export type AgentActivityKind = 'text' | 'thinking' | 'tool';
export type AgentActivityStatus = 'streaming' | 'running' | 'complete' | 'error';

export interface AgentActivity {
  id: string;
  kind: AgentActivityKind;
  status: AgentActivityStatus;
  content?: string;
  toolUseId?: string;
  toolName?: string;
  label?: string;
  summary?: string;
  input?: Record<string, unknown>;
  output?: string;
  outputSummary?: string;
  elapsedSeconds?: number;
}

interface StreamEvent {
  type?: string;
  index?: number;
  content_block?: {
    type?: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

const MAX_TOOL_STRING_LENGTH = 4_000;
const MAX_TOOL_OUTPUT_LENGTH = 12_000;
const MAX_TOOL_SUMMARY_LENGTH = 700;

export class AgentTimelineBuilder {
  private activities: AgentActivity[] = [];
  private streamBlocks = new Map<number, string>();
  private partialToolInputs = new Map<string, string>();
  private seenAssistantMessages = new Set<string>();
  private counter = 0;

  constructor(private readonly turnId: string) {}

  consume(message: SDKMessage) {
    switch (message.type) {
      case 'stream_event':
        return this.consumeStreamEvent(message.event as StreamEvent);
      case 'assistant':
        return this.consumeAssistantMessage(message);
      case 'user':
        return this.consumeToolResults(message);
      case 'tool_progress':
        return this.consumeToolProgress(message);
      case 'tool_use_summary':
        return this.consumeToolSummary(message.preceding_tool_use_ids, message.summary);
      default:
        return false;
    }
  }

  addText(content: string, status: AgentActivityStatus = 'complete') {
    if (!content) return false;
    this.activities.push({
      id: this.nextId(),
      kind: 'text',
      status,
      content,
    });
    return true;
  }

  finish() {
    for (const activity of this.activities) {
      if (activity.status === 'streaming') activity.status = 'complete';
      if (activity.kind === 'tool' && activity.status === 'running') {
        activity.status = 'complete';
        activity.outputSummary ??= 'Completed';
      }
    }
  }

  getText() {
    return this.activities
      .filter((activity) => activity.kind === 'text')
      .map((activity) => activity.content?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n');
  }

  snapshot() {
    return this.activities.map((activity) => ({
      ...activity,
      input: activity.input ? { ...activity.input } : undefined,
    }));
  }

  private consumeStreamEvent(event: StreamEvent) {
    if (event.type === 'message_start') {
      this.streamBlocks.clear();
      this.partialToolInputs.clear();
      return false;
    }

    if (event.type === 'content_block_start' && event.index !== undefined) {
      const activity = this.activityFromBlock(event.content_block ?? {}, 'streaming');
      if (!activity) return false;
      this.activities.push(activity);
      this.streamBlocks.set(event.index, activity.id);
      return true;
    }

    if (event.type === 'content_block_delta' && event.index !== undefined) {
      const activity = this.ensureDeltaActivity(event.index, event.delta?.type);
      if (!activity) return false;
      if (event.delta?.type === 'text_delta') {
        activity.content = `${activity.content ?? ''}${event.delta.text ?? ''}`;
      } else if (event.delta?.type === 'thinking_delta') {
        activity.content = `${activity.content ?? ''}${event.delta.thinking ?? ''}`;
      } else if (event.delta?.type === 'input_json_delta' && activity.kind === 'tool') {
        const partial = `${this.partialToolInputs.get(activity.id) ?? ''}${event.delta.partial_json ?? ''}`;
        this.partialToolInputs.set(activity.id, partial);
      } else {
        return false;
      }
      return true;
    }

    if (event.type === 'content_block_stop' && event.index !== undefined) {
      const activity = this.findStreamActivity(event.index);
      if (!activity) return false;
      if (activity.kind === 'tool') {
        const partial = this.partialToolInputs.get(activity.id);
        if (partial) {
          try {
            activity.input = sanitizeToolInput(JSON.parse(partial) as Record<string, unknown>);
          } catch {
            // The complete assistant message will provide canonical tool input.
          }
        }
        this.refreshToolPresentation(activity);
      } else {
        activity.status = 'complete';
      }
      return true;
    }

    return false;
  }

  private consumeAssistantMessage(message: Extract<SDKMessage, { type: 'assistant' }>) {
    if (this.seenAssistantMessages.has(message.uuid)) return false;
    this.seenAssistantMessages.add(message.uuid);
    if (!Array.isArray(message.message.content)) return false;

    let changed = false;
    const claimedStreamIds = new Set<string>();
    (message.message.content as ContentBlock[]).forEach((block, index) => {
      const indexedStream = this.findStreamActivity(index);
      const streamed = indexedStream
        && !claimedStreamIds.has(indexedStream.id)
        && this.blockMatchesActivity(block, indexedStream)
        ? indexedStream
        : this.findMatchingStreamActivity(block, claimedStreamIds);
      if (streamed) {
        claimedStreamIds.add(streamed.id);
        this.applyCanonicalBlock(streamed, block);
        changed = true;
        return;
      }

      const existingTool = block.type === 'tool_use' && block.id
        ? this.findTool(block.id)
        : undefined;
      if (existingTool) {
        this.applyCanonicalBlock(existingTool, block);
        changed = true;
        return;
      }

      const activity = this.activityFromBlock(block, 'complete');
      if (activity) {
        this.activities.push(activity);
        changed = true;
      }
    });
    this.streamBlocks.clear();
    this.partialToolInputs.clear();
    return changed;
  }

  private consumeToolResults(message: Extract<SDKMessage, { type: 'user' }>) {
    if (!Array.isArray(message.message.content)) return false;
    let changed = false;
    for (const block of message.message.content as Array<{
      type?: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue;
      let activity = this.findTool(block.tool_use_id);
      if (!activity) {
        activity = {
          id: this.nextId(),
          kind: 'tool',
          status: 'running',
          toolUseId: block.tool_use_id,
          toolName: 'Tool',
          label: 'Tool',
        };
        this.activities.push(activity);
      }
      const fullOutput = extractToolOutput(block.content);
      activity.status = block.is_error ? 'error' : 'complete';
      activity.outputSummary = summarizeToolOutput(fullOutput, block.is_error ?? false);
      activity.output = truncate(fullOutput, MAX_TOOL_OUTPUT_LENGTH);
      changed = true;
    }
    return changed;
  }

  private consumeToolProgress(message: Extract<SDKMessage, { type: 'tool_progress' }>) {
    const activity = this.findTool(message.tool_use_id);
    if (!activity) return false;
    activity.elapsedSeconds = Math.max(0, Math.round(message.elapsed_time_seconds));
    activity.status = 'running';
    return true;
  }

  private consumeToolSummary(toolUseIds: string[], summary: string) {
    const activity = [...toolUseIds].reverse()
      .map((toolUseId) => this.findTool(toolUseId))
      .find(Boolean);
    if (!activity) return false;
    activity.outputSummary = summary;
    return true;
  }

  private activityFromBlock(
    block: ContentBlock,
    status: AgentActivityStatus,
  ): AgentActivity | null {
    if (block.type === 'text') {
      return {
        id: this.nextId(),
        kind: 'text',
        status,
        content: block.text ?? '',
      };
    }
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      return {
        id: this.nextId(),
        kind: 'thinking',
        status,
        content: block.thinking ?? '',
      };
    }
    if (block.type === 'tool_use') {
      const activity: AgentActivity = {
        id: this.nextId(),
        kind: 'tool',
        status: 'running',
        toolUseId: block.id,
        toolName: block.name ?? 'Tool',
        input: sanitizeToolInput(block.input ?? {}),
      };
      this.refreshToolPresentation(activity);
      return activity;
    }
    return null;
  }

  private ensureDeltaActivity(index: number, deltaType?: string) {
    const existing = this.findStreamActivity(index);
    if (existing) return existing;
    const kind = deltaType === 'thinking_delta'
      ? 'thinking'
      : deltaType === 'input_json_delta'
        ? 'tool'
        : deltaType === 'text_delta'
          ? 'text'
          : null;
    if (!kind) return undefined;
    const activity: AgentActivity = {
      id: this.nextId(),
      kind,
      status: kind === 'tool' ? 'running' : 'streaming',
      ...(kind === 'tool' ? { toolName: 'Tool', label: 'Tool', input: {} } : { content: '' }),
    };
    this.activities.push(activity);
    this.streamBlocks.set(index, activity.id);
    return activity;
  }

  private applyCanonicalBlock(activity: AgentActivity, block: ContentBlock) {
    if (activity.kind === 'text') {
      activity.content = block.text ?? activity.content ?? '';
      activity.status = 'complete';
    } else if (activity.kind === 'thinking') {
      activity.content = block.thinking ?? activity.content ?? '';
      activity.status = 'complete';
    } else if (activity.kind === 'tool') {
      activity.toolUseId = block.id ?? activity.toolUseId;
      activity.toolName = block.name ?? activity.toolName ?? 'Tool';
      activity.input = block.input ? sanitizeToolInput(block.input) : activity.input;
      activity.status = 'running';
      this.refreshToolPresentation(activity);
    }
  }

  private blockMatchesActivity(block: ContentBlock, activity: AgentActivity) {
    return (block.type === 'text' && activity.kind === 'text')
      || ((block.type === 'thinking' || block.type === 'redacted_thinking') && activity.kind === 'thinking')
      || (block.type === 'tool_use' && activity.kind === 'tool');
  }

  private refreshToolPresentation(activity: AgentActivity) {
    const presentation = summarizeToolCall(activity.toolName ?? 'Tool', activity.input ?? {});
    activity.label = presentation.label;
    activity.summary = presentation.summary;
  }

  private findStreamActivity(index: number) {
    const id = this.streamBlocks.get(index);
    return id ? this.activities.find((activity) => activity.id === id) : undefined;
  }

  private findMatchingStreamActivity(block: ContentBlock, claimedIds: Set<string>) {
    const streamed = [...this.streamBlocks.values()]
      .map((id) => this.activities.find((activity) => activity.id === id))
      .filter((activity): activity is AgentActivity => Boolean(activity))
      .filter((activity) => !claimedIds.has(activity.id))
      .filter((activity) => this.blockMatchesActivity(block, activity));

    if (block.type === 'tool_use') {
      return streamed.find((activity) => !block.id || activity.toolUseId === block.id);
    }

    const canonicalContent = block.type === 'text' ? block.text : block.thinking;
    return streamed.find((activity) => activity.content === (canonicalContent ?? ''));
  }

  private findTool(toolUseId: string) {
    return this.activities.find(
      (activity) => activity.kind === 'tool' && activity.toolUseId === toolUseId,
    );
  }

  private nextId() {
    this.counter += 1;
    return `${this.turnId}-activity-${this.counter}`;
  }
}

export function summarizeToolCall(toolName: string, input: Record<string, unknown>) {
  const label = humanizeToolName(toolName);
  const path = firstString(input, ['file_path', 'path', 'url']);
  const command = firstString(input, ['command', 'pattern', 'query', 'description']);
  let summary = command ?? path ?? '';

  if (/^read$/i.test(toolName) && path) {
    const offset = numberValue(input.offset);
    const limit = numberValue(input.limit);
    summary = path;
    if (offset !== undefined || limit !== undefined) {
      const start = offset ?? 1;
      const end = limit === undefined ? undefined : start + Math.max(0, limit - 1);
      summary += end === undefined ? ` (from line ${start})` : ` (lines ${start}-${end})`;
    }
  } else if (/^(edit|write)$/i.test(toolName) && path) {
    summary = path;
  } else if (/^(grep|glob)$/i.test(toolName)) {
    const pattern = firstString(input, ['pattern']);
    summary = [pattern ? `“${pattern}”` : '', path ? `in ${path}` : ''].filter(Boolean).join(' ');
  } else if (/asset_register$/i.test(toolName) && Array.isArray(input.assets)) {
    const counts = new Map<string, number>();
    for (const asset of input.assets) {
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)) continue;
      const type = (asset as Record<string, unknown>).type;
      if (typeof type === 'string') counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    summary = [...counts.entries()]
      .map(([type, count]) => `${count} ${type}${count === 1 ? '' : 's'}`)
      .join(', ');
  }

  return { label, summary: truncate(summary, MAX_TOOL_SUMMARY_LENGTH) };
}

function humanizeToolName(name: string) {
  const clean = name
    .replace(/^mcp__[^_]+__/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Tool';
}

function firstString(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractToolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content, null, 2);
  return content
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const block = item as { type?: string; text?: string; content?: unknown };
      if (block.type === 'text' && typeof block.text === 'string') return [block.text];
      if (typeof block.content === 'string') return [block.content];
      return [];
    })
    .join('\n');
}

function summarizeToolOutput(output: string, isError: boolean) {
  if (isError) return output.trim().split(/\r?\n/, 1)[0] || 'Failed';
  const trimmed = output.trim();
  if (!trimmed) return 'Completed';
  const lines = trimmed.split(/\r?\n/).length;
  if (lines === 1 && trimmed.length <= 80) return trimmed;
  return `${lines} ${lines === 1 ? 'line' : 'lines'} of output`;
}

function sanitizeToolInput(input: Record<string, unknown>) {
  return sanitizeObject(input, 0);
}

function sanitizeObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .slice(0, 30)
      .map(([key, value]) => [key, sanitizeValue(value, depth + 1)]),
  );
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return truncate(value, MAX_TOOL_STRING_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= 4) return '[nested value omitted]';
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>, depth);
  }
  return String(value ?? '');
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}\n… output truncated by Hexestra`;
}
