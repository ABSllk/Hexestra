import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentTimelineBuilder } from '@electron/services/agent-timeline';
import { SubagentRegistry } from '@electron/services/subagent-registry';

const sdkMessage = (value: unknown) => value as SDKMessage;

describe('SubagentRegistry', () => {
  it('keeps child output separate and annotates the parent Agent tool', () => {
    const registry = new SubagentRegistry('turn-1');
    const mainTimeline = new AgentTimelineBuilder('turn-1');

    mainTimeline.consume(sdkMessage({
      type: 'assistant',
      uuid: 'main-assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'spawn-1', name: 'Agent', input: { prompt: 'Inspect headers' } }] },
    }));
    registry.consume(sdkMessage({
      type: 'assistant',
      uuid: 'main-assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'spawn-1', name: 'Agent', input: { prompt: 'Inspect headers' } }] },
    }));
    registry.consume(sdkMessage({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-1',
      tool_use_id: 'spawn-1',
      subagent_type: 'Explore',
      description: 'Inspect headers',
      prompt: 'Read-only header review',
      uuid: 'task-start',
      session_id: 'session-1',
    }));
    registry.consume(sdkMessage({
      type: 'assistant',
      uuid: 'child-assistant',
      parent_tool_use_id: 'spawn-1',
      message: { content: [{ type: 'text', text: 'The response includes strict transport headers.' }] },
    }));
    registry.consume(sdkMessage({
      type: 'user',
      parent_tool_use_id: null,
      tool_use_result: {
        result: 'Final structured child report',
        usage: { total_tokens: 42, tool_uses: 1, duration_ms: 1200 },
      },
      message: { content: [{ type: 'tool_result', tool_use_id: 'spawn-1', content: 'Final child report' }] },
    }));
    registry.consume(sdkMessage({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      status: 'completed',
      summary: 'Finished header review',
      uuid: 'task-end',
      session_id: 'session-1',
    }));

    registry.annotateMainTimeline(mainTimeline);
    const [run] = registry.getRuns();
    expect(run).toMatchObject({
      taskId: 'task-1',
      agentType: 'Explore',
      status: 'completed',
      output: 'Final structured child report',
      usage: { totalTokens: 42, toolUses: 1, durationMs: 1200 },
    });
    expect(run.activities.map((activity) => activity.kind)).toEqual(['text']);
    expect(mainTimeline.snapshot()[0]).toMatchObject({
      toolUseId: 'spawn-1',
      subagentRunId: run.id,
      agentType: 'Explore',
    });
  });

  it('supports parallel runs and marks an out-of-order child as interrupted on finish', () => {
    const registry = new SubagentRegistry('turn-2');
    registry.consume(sdkMessage({
      type: 'assistant',
      uuid: 'child-before-start',
      parent_tool_use_id: 'nested-spawn',
      message: { content: [{ type: 'text', text: 'Early child output' }] },
    }));
    registry.consume(sdkMessage({
      type: 'system', subtype: 'task_started', task_id: 'task-a', tool_use_id: 'spawn-a',
      subagent_type: 'Explore', description: 'A', uuid: 'start-a', session_id: 's',
    }));
    registry.consume(sdkMessage({
      type: 'system', subtype: 'task_started', task_id: 'task-b', tool_use_id: 'spawn-b',
      subagent_type: 'Plan', description: 'B', uuid: 'start-b', session_id: 's',
    }));

    const runs = registry.getRuns();
    expect(runs).toHaveLength(3);
    expect(new Set(runs.map((run) => run.id)).size).toBe(3);
    expect(registry.finish('stopped')).toHaveLength(3);
    expect(registry.getRuns().every((run) => run.status === 'stopped')).toBe(true);
  });

  it('keeps a nested Agent task separate from the child that spawned it', () => {
    const registry = new SubagentRegistry('turn-nested');
    registry.consume(sdkMessage({
      type: 'system', subtype: 'task_started', task_id: 'task-parent', tool_use_id: 'spawn-parent',
      subagent_type: 'Explore', description: 'Parent', uuid: 'start-parent', session_id: 's',
    }));
    registry.consume(sdkMessage({
      type: 'assistant', uuid: 'parent-assistant', parent_tool_use_id: 'spawn-parent',
      message: { content: [{ type: 'tool_use', id: 'spawn-nested', name: 'Task', input: { description: 'Nested' } }] },
    }));
    registry.consume(sdkMessage({
      type: 'system', subtype: 'task_started', task_id: 'task-nested', tool_use_id: 'spawn-nested',
      subagent_type: 'Plan', description: 'Nested', uuid: 'start-nested', session_id: 's',
    }));

    const runs = registry.getRuns();
    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run.taskId === 'task-nested')).toMatchObject({
      parentRunId: runs.find((run) => run.taskId === 'task-parent')?.id,
      parentToolUseId: 'spawn-parent',
    });
  });
});
