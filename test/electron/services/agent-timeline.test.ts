import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentTimelineBuilder, summarizeToolCall } from '@electron/services/agent-timeline';

const sdkMessage = (value: unknown) => value as SDKMessage;

describe('AgentTimelineBuilder', () => {
  it('preserves streamed text, tool execution, result, and following text in order', () => {
    const timeline = new AgentTimelineBuilder('turn-1');
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'message_start' },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will inspect it.' } },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      },
    }));
    timeline.consume(sdkMessage({
      type: 'assistant',
      uuid: 'assistant-1',
      message: {
        content: [
          { type: 'text', text: 'I will inspect it.' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'package.json', offset: 2, limit: 4 } },
        ],
      },
    }));
    timeline.consume(sdkMessage({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'line one\nline two' }],
      },
    }));
    timeline.consume(sdkMessage({
      type: 'assistant',
      uuid: 'assistant-2',
      message: { content: [{ type: 'text', text: 'The dependency is pinned.' }] },
    }));

    const activities = timeline.snapshot();
    expect(activities.map((activity) => activity.kind)).toEqual(['text', 'tool', 'text']);
    expect(activities[0].content).toBe('I will inspect it.');
    expect(activities[1]).toMatchObject({
      label: 'Read',
      summary: 'package.json (lines 2-5)',
      outputSummary: '2 lines of output',
      status: 'complete',
    });
    expect(activities[2].content).toBe('The dependency is pinned.');
    expect(timeline.getText()).toBe('I will inspect it.\n\nThe dependency is pinned.');
  });

  it('captures thinking as a separate collapsible activity without duplicating full blocks', () => {
    const timeline = new AgentTimelineBuilder('turn-2');
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'message_start' },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking evidence' } },
    }));
    timeline.consume(sdkMessage({
      type: 'assistant',
      uuid: 'assistant-thinking',
      message: { content: [{ type: 'thinking', thinking: 'Checking evidence' }] },
    }));

    expect(timeline.snapshot()).toHaveLength(1);
    expect(timeline.snapshot()[0]).toMatchObject({
      kind: 'thinking',
      content: 'Checking evidence',
      status: 'complete',
    });
  });

  it('reconciles full assistant blocks when omitted thinking shifts stream indexes', () => {
    const timeline = new AgentTimelineBuilder('turn-shifted-index');
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'message_start' },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking result' } },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    }));
    timeline.consume(sdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'The project is Hexestra.' } },
    }));
    timeline.consume(sdkMessage({
      type: 'assistant',
      uuid: 'assistant-without-thinking',
      message: { content: [{ type: 'text', text: 'The project is Hexestra.' }] },
    }));

    expect(timeline.snapshot().map((activity) => activity.kind)).toEqual(['thinking', 'text']);
    expect(timeline.snapshot().filter((activity) => activity.kind === 'text')).toHaveLength(1);
  });

  it('bounds large tool results before sending them across IPC', () => {
    const timeline = new AgentTimelineBuilder('turn-3');
    timeline.consume(sdkMessage({
      type: 'assistant',
      uuid: 'assistant-tool',
      message: {
        content: [{ type: 'tool_use', id: 'large-tool', name: 'Read', input: { file_path: 'large.txt' } }],
      },
    }));
    timeline.consume(sdkMessage({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'large-tool', content: 'x'.repeat(20_000) }],
      },
    }));

    const tool = timeline.snapshot()[0];
    expect(tool.output?.length).toBeLessThan(12_100);
    expect(tool.output).toContain('output truncated by Hexestra');
    expect(tool.outputSummary).toBe('1 line of output');
  });
});

describe('summarizeToolCall', () => {
  it('normalizes MCP and command tool labels into compact display text', () => {
    expect(summarizeToolCall('mcp__hexestra__browser_read', {})).toEqual({
      label: 'Browser Read',
      summary: '',
    });
    expect(summarizeToolCall('Bash', { command: 'nmap -sV 192.0.2.10' })).toEqual({
      label: 'Bash',
      summary: 'nmap -sV 192.0.2.10',
    });
  });

  it('summarizes structured asset registration batches', () => {
    expect(summarizeToolCall('mcp__hexestra__asset_register', {
      assets: [
        { type: 'host', ip: '192.0.2.10' },
        { type: 'domain', domain: 'api.example.com' },
        { type: 'domain', domain: 'admin.example.com' },
        { type: 'webapp', url: 'https://api.example.com' },
      ],
    })).toEqual({
      label: 'Asset Register',
      summary: '1 host, 2 domains, 1 webapp',
    });
  });
});
