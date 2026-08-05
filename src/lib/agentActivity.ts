import type { AgentActivity } from '@/types';

/**
 * Preserve references for timeline entries that did not change between IPC
 * snapshots. React can then skip completed Markdown and tool rows while only
 * the active tail continues to render.
 */
export function reconcileAgentActivities(
  previous: AgentActivity[] | undefined,
  incoming: AgentActivity[] | undefined,
): AgentActivity[] | undefined {
  if (!previous || !incoming) return incoming;

  const previousById = new Map(previous.map((activity) => [activity.id, activity]));
  let changed = previous.length !== incoming.length;
  const reconciled = incoming.map((activity, index) => {
    const existing = previousById.get(activity.id);
    if (existing && agentActivitiesEqual(existing, activity)) {
      if (previous[index] !== existing) changed = true;
      return existing;
    }
    changed = true;
    return activity;
  });

  return changed ? reconciled : previous;
}

function agentActivitiesEqual(left: AgentActivity, right: AgentActivity) {
  return left.id === right.id
    && left.kind === right.kind
    && left.status === right.status
    && left.content === right.content
    && left.toolUseId === right.toolUseId
    && left.toolName === right.toolName
    && left.label === right.label
    && left.summary === right.summary
    && jsonValuesEqual(left.input, right.input)
    && left.output === right.output
    && left.outputSummary === right.outputSummary
    && left.elapsedSeconds === right.elapsedSeconds;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValuesEqual(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(rightRecord, key)
      && jsonValuesEqual(leftRecord[key], rightRecord[key])
    ));
}
