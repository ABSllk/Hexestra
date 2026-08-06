import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  SubagentActivity,
  SubagentRun,
  SubagentRunStatus,
  SubagentUsage,
} from '../agent-subagent-contract';
import { AgentTimelineBuilder, type AgentActivity } from './agent-timeline';

const SPAWN_TOOL_NAMES = new Set(['Agent', 'Task']);

export class SubagentRegistry {
  private readonly runs = new Map<string, SubagentRun>();
  private readonly timelines = new Map<string, AgentTimelineBuilder>();
  private readonly runByToolUseId = new Map<string, string>();
  private readonly ownerByToolUseId = new Map<string, string>();
  private readonly runByAgentId = new Map<string, string>();

  constructor(private readonly turnId: string) {}

  consume(message: SDKMessage) {
    const changed = new Set<string>();

    if (message.type === 'system') {
      if (message.subtype === 'task_started') {
        const run = this.startRun(message);
        changed.add(run.id);
        return [...changed];
      }
      if (message.subtype === 'task_progress') {
        const run = this.findByTaskId(message.task_id);
        if (!run) return [];
        run.description = message.description || run.description;
        run.agentType = message.subagent_type ?? run.agentType;
        run.lastToolName = message.last_tool_name ?? run.lastToolName;
        run.summary = message.summary ?? run.summary;
        run.usage = normalizeUsage(message.usage);
        run.status = 'running';
        this.touch(run);
        changed.add(run.id);
        return [...changed];
      }
      if (message.subtype === 'task_updated') {
        const run = this.findByTaskId(message.task_id);
        if (!run) return [];
        this.applyTaskPatch(run, message.patch);
        changed.add(run.id);
        return [...changed];
      }
      if (message.subtype === 'task_notification') {
        const run = this.findByTaskId(message.task_id);
        if (!run) return [];
        run.status = mapNotificationStatus(message.status);
        run.summary = message.summary || run.summary;
        run.usage = message.usage ? normalizeUsage(message.usage) : run.usage;
        run.endedAt = run.status === 'running' ? undefined : new Date().toISOString();
        this.touch(run);
        changed.add(run.id);
        return [...changed];
      }
    }

    if (message.type === 'tool_use_summary') {
      for (const toolUseId of message.preceding_tool_use_ids) {
        const runId = this.runByToolUseId.get(toolUseId);
        if (!runId) continue;
        const builder = this.timelines.get(runId);
        if (builder?.consume(message)) {
          this.updateFromTimeline(this.runs.get(runId)!, builder);
          changed.add(runId);
        }
      }
      return [...changed];
    }

    if (message.type === 'assistant' && message.parent_tool_use_id == null) {
      this.indexSpawnTools(message.message.content);
      return [];
    }

    const parentToolUseId = parentToolUseIdOf(message);
    let runId = parentToolUseId
      ? this.runByToolUseId.get(parentToolUseId)
      : message.type === 'tool_progress'
        ? this.runByToolUseId.get(message.tool_use_id)
        : undefined;

    if (!runId && parentToolUseId && this.isChildMessage(message)) {
      const placeholder = this.ensureParentRun(parentToolUseId);
      runId = placeholder.id;
      changed.add(placeholder.id);
    }

    if (runId) {
      const run = this.runs.get(runId);
      const builder = this.timelines.get(runId);
      if (!run || !builder) return [];
      if (builder.consume(message)) {
        this.indexRunActivities(run, builder.snapshot());
        this.updateFromTimeline(run, builder);
        changed.add(run.id);
      }
      return [...changed];
    }

    if (message.type === 'user' && message.parent_tool_use_id == null) {
      for (const block of toolResultBlocks(message.message.content)) {
        const runIdForTool = this.runByToolUseId.get(block.toolUseId);
        if (!runIdForTool) continue;
        const run = this.runs.get(runIdForTool);
        if (!run) continue;
        run.output = truncate(extractContent(block.content), 50_000);
        const structured = structuredToolResult(message.tool_use_result);
        if (structured.output) run.output = truncate(structured.output, 50_000);
        if (structured.usage) run.usage = structured.usage;
        run.status = block.isError ? 'failed' : run.status;
        run.error = block.isError ? run.output : run.error;
        this.touch(run);
        changed.add(run.id);
      }
    }

    return [...changed];
  }

  finish(status: Extract<SubagentRunStatus, 'completed' | 'failed' | 'stopped'>) {
    const changed: string[] = [];
    for (const run of this.runs.values()) {
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped') continue;
      run.status = status;
      run.endedAt = new Date().toISOString();
      const builder = this.timelines.get(run.id);
      if (builder) {
        builder.finish();
        this.updateFromTimeline(run, builder);
      }
      this.touch(run);
      changed.push(run.id);
    }
    return changed;
  }

  annotateMainTimeline(timeline: AgentTimelineBuilder) {
    for (const run of this.runs.values()) {
      if (!run.toolUseId) continue;
      timeline.annotateTool(run.toolUseId, {
        subagentRunId: run.id,
        agentType: run.agentType,
        subagentDescription: run.description,
      });
    }
  }

  getRuns(): SubagentRun[] {
    return [...this.runs.values()].map(cloneRun);
  }

  getRun(runId: string) {
    const run = this.runs.get(runId);
    return run ? cloneRun(run) : undefined;
  }

  getRunForAgent(agentId: string) {
    const mapped = this.runByAgentId.get(agentId);
    if (mapped) return this.getRun(mapped);
    const run = [...this.runs.values()].find((candidate) =>
      candidate.agentId === agentId || candidate.taskId === agentId || candidate.id === agentId,
    );
    return run ? cloneRun(run) : undefined;
  }

  isChildMessage(message: SDKMessage) {
    if (message.type === 'tool_progress') {
      return message.parent_tool_use_id != null || this.runByToolUseId.has(message.tool_use_id);
    }
    return (message.type === 'assistant' || message.type === 'user' || message.type === 'stream_event')
      && message.parent_tool_use_id != null;
  }

  private startRun(message: Extract<SDKMessage, { type: 'system'; subtype: 'task_started' }>) {
    const id = safeId(message.task_id, `subagent-${Date.now()}`);
    const mappedByTool = message.tool_use_id
      ? this.runByToolUseId.get(message.tool_use_id)
      : undefined;
    const mappedRun = mappedByTool ? this.runs.get(mappedByTool) : undefined;
    const existingByTool = mappedRun?.toolUseId === message.tool_use_id
      ? mappedByTool
      : undefined;
    const existing = this.runs.get(id) ?? (existingByTool ? this.runs.get(existingByTool) : undefined);
    if (existing) {
      existing.taskId = message.task_id;
      existing.description = message.description || existing.description;
      existing.agentType = message.subagent_type ?? message.task_type ?? existing.agentType;
      existing.prompt = message.prompt ?? existing.prompt;
      existing.agentId ??= message.task_id;
      existing.status = 'running';
      if (message.tool_use_id) {
        existing.toolUseId = message.tool_use_id;
        this.runByToolUseId.set(message.tool_use_id, existing.id);
        const owner = this.ownerByToolUseId.get(message.tool_use_id);
        if (owner && owner !== 'main') {
          existing.parentRunId ??= owner;
          existing.parentToolUseId ??= this.runs.get(owner)?.toolUseId;
        }
      }
      this.touch(existing);
      this.runByAgentId.set(message.task_id, existing.id);
      return existing;
    }

    const now = new Date().toISOString();
    const run: SubagentRun = {
      id,
      taskId: message.task_id,
      messageId: this.turnId,
      ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
      agentId: message.task_id,
      ...((message.subagent_type ?? message.task_type) ? { agentType: message.subagent_type ?? message.task_type } : {}),
      description: message.description || 'Subagent task',
      ...(message.prompt ? { prompt: message.prompt } : {}),
      ...(message.tool_use_id && this.ownerByToolUseId.has(message.tool_use_id)
        && this.ownerByToolUseId.get(message.tool_use_id) !== 'main'
        ? {
          parentRunId: this.ownerByToolUseId.get(message.tool_use_id),
          parentToolUseId: this.runs.get(this.ownerByToolUseId.get(message.tool_use_id)!)?.toolUseId,
        }
        : {}),
      status: 'running',
      startedAt: now,
      updatedAt: now,
      ...(message.skip_transcript ? { isBackgrounded: true } : {}),
      activities: [],
    };
    this.runs.set(run.id, run);
    this.timelines.set(run.id, new AgentTimelineBuilder(`${this.turnId}-${run.id}`));
    if (message.tool_use_id) this.runByToolUseId.set(message.tool_use_id, run.id);
    this.runByAgentId.set(message.task_id, run.id);
    return run;
  }

  private findByTaskId(taskId: string) {
    return [...this.runs.values()].find((run) => run.taskId === taskId || run.id === taskId);
  }

  private ensureParentRun(parentToolUseId: string) {
    const existingId = this.runByToolUseId.get(parentToolUseId);
    if (existingId) return this.runs.get(existingId)!;
    const now = new Date().toISOString();
    const run: SubagentRun = {
      id: `pending-${safeId(parentToolUseId, `subagent-${Date.now()}`)}`,
      taskId: parentToolUseId,
      messageId: this.turnId,
      toolUseId: parentToolUseId,
      description: 'Subagent task',
      status: 'running',
      startedAt: now,
      updatedAt: now,
      activities: [],
    };
    this.runs.set(run.id, run);
    this.timelines.set(run.id, new AgentTimelineBuilder(`${this.turnId}-${run.id}`));
    this.runByToolUseId.set(parentToolUseId, run.id);
    return run;
  }

  private indexSpawnTools(content: unknown) {
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'tool_use' || typeof block.id !== 'string') continue;
      if (typeof block.name === 'string' && SPAWN_TOOL_NAMES.has(block.name)) {
        this.ownerByToolUseId.set(block.id, 'main');
      }
    }
  }

  private indexRunActivities(run: SubagentRun, activities: AgentActivity[]) {
    for (const activity of activities) {
      if (!activity.toolUseId) continue;
      this.runByToolUseId.set(activity.toolUseId, run.id);
      if (activity.kind === 'tool' && activity.toolName && SPAWN_TOOL_NAMES.has(activity.toolName)) {
        this.ownerByToolUseId.set(activity.toolUseId, run.id);
      }
    }
  }

  private updateFromTimeline(run: SubagentRun, builder: AgentTimelineBuilder) {
    run.activities = builder.snapshot().map(cloneActivity);
    run.output = truncate(builder.getText(), 50_000) || run.output;
    run.status = run.status === 'pending' ? 'running' : run.status;
    this.touch(run);
  }

  private applyTaskPatch(
    run: SubagentRun,
    patch: Extract<SDKMessage, { type: 'system'; subtype: 'task_updated' }>['patch'],
  ) {
    if (patch.description) run.description = patch.description;
    if (patch.status) run.status = normalizeTaskStatus(patch.status);
    if (patch.is_backgrounded !== undefined) run.isBackgrounded = patch.is_backgrounded;
    if (patch.error) run.error = patch.error;
    if (patch.end_time) run.endedAt = new Date(patch.end_time).toISOString();
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped' || run.status === 'killed') {
      run.endedAt ??= new Date().toISOString();
    }
    this.touch(run);
  }

  private touch(run: SubagentRun) {
    run.updatedAt = new Date().toISOString();
  }
}

function parentToolUseIdOf(message: SDKMessage) {
  if (message.type === 'assistant' || message.type === 'user' || message.type === 'stream_event') {
    return message.parent_tool_use_id;
  }
  if (message.type === 'tool_progress') return message.parent_tool_use_id;
  return null;
}

function mapNotificationStatus(status: 'completed' | 'failed' | 'stopped'): SubagentRunStatus {
  return status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'stopped';
}

function normalizeTaskStatus(status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused'): SubagentRunStatus {
  if (status === 'pending') return 'pending';
  if (status === 'running' || status === 'paused') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'killed';
}

function normalizeUsage(value: { total_tokens: number; tool_uses: number; duration_ms: number }): SubagentUsage | undefined {
  const usage = {
    totalTokens: safeNumber(value.total_tokens),
    toolUses: safeNumber(value.tool_uses),
    durationMs: safeNumber(value.duration_ms),
  };
  return usage.totalTokens === undefined && usage.toolUses === undefined && usage.durationMs === undefined
    ? undefined
    : usage;
}

function toolResultBlocks(content: unknown) {
  if (!Array.isArray(content)) return [];
  return content.flatMap((value) => {
    if (!isRecord(value) || value.type !== 'tool_result' || typeof value.tool_use_id !== 'string') return [];
    return [{
      toolUseId: value.tool_use_id,
      content: value.content,
      isError: value.is_error === true,
    }];
  });
}

function extractContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return value == null ? '' : JSON.stringify(value, null, 2);
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.text === 'string') return [item.text];
    if (typeof item.content === 'string') return [item.content];
    return [];
  }).join('\n');
}

function structuredToolResult(value: unknown): { output?: string; usage?: SubagentUsage } {
  if (value === undefined) return {};
  if (!isRecord(value)) return { output: extractContent(value) };
  const usageValue = isRecord(value.usage) ? value.usage : isRecord(value.stats) ? value.stats : undefined;
  const usage = usageValue
    ? normalizeUsage({
      total_tokens: Number(usageValue.total_tokens ?? usageValue.totalTokens),
      tool_uses: Number(usageValue.tool_uses ?? usageValue.toolUses),
      duration_ms: Number(usageValue.duration_ms ?? usageValue.durationMs),
    })
    : undefined;
  const outputValue = value.output ?? value.result ?? value.final_output ?? value.finalOutput ?? value.content;
  const output = outputValue === undefined ? undefined : extractContent(outputValue);
  return { ...(output ? { output } : {}), ...(usage ? { usage } : {}) };
}

function cloneRun(run: SubagentRun): SubagentRun {
  return {
    ...run,
    usage: run.usage ? { ...run.usage } : undefined,
    activities: run.activities.map(cloneActivity),
  };
}

function cloneActivity(activity: AgentActivity | SubagentActivity): SubagentActivity {
  return {
    ...activity,
    input: activity.input ? { ...activity.input } : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeId(value: string, fallback: string) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '-');
  return normalized.slice(0, 200) || fallback;
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max)}\n… output truncated by Hexestra`;
}
