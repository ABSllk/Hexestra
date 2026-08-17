import { useEffect, useState } from 'react';
import type { SubagentRun } from '@/types';

export function isLiveSubagent(run: SubagentRun) {
  return run.status === 'pending' || run.status === 'running';
}

export function formatSubagentDuration(run: SubagentRun, now = Date.now()) {
  const started = Date.parse(run.startedAt);
  const authoritativeDuration = run.usage?.durationMs;
  const ended = run.endedAt ? Date.parse(run.endedAt) : now;
  const milliseconds = authoritativeDuration !== undefined && !isLiveSubagent(run)
    ? authoritativeDuration
    : ended - started;
  if (!Number.isFinite(started) || !Number.isFinite(milliseconds)) return '—';
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

let sharedClockNow = Date.now();
let sharedClockTimer: number | null = null;
const sharedClockSubscribers = new Set<(now: number) => void>();

function subscribeSharedClock(listener: (now: number) => void) {
  sharedClockSubscribers.add(listener);
  if (sharedClockTimer === null) {
    sharedClockTimer = window.setInterval(() => {
      sharedClockNow = Date.now();
      sharedClockSubscribers.forEach((subscriber) => subscriber(sharedClockNow));
    }, 1_000);
  }
  return () => {
    sharedClockSubscribers.delete(listener);
    if (sharedClockSubscribers.size === 0 && sharedClockTimer !== null) {
      window.clearInterval(sharedClockTimer);
      sharedClockTimer = null;
    }
  };
}

/** A single process-local one-second clock serves all visible live subagents. */
export function useSubagentClock(run?: SubagentRun) {
  const [now, setNow] = useState(() => sharedClockNow);
  useEffect(() => {
    if (!run || !isLiveSubagent(run)) return;
    return subscribeSharedClock(setNow);
  }, [run?.status]);
  return run ? formatSubagentDuration(run, now) : '—';
}

export function subagentTitle(run: Pick<SubagentRun, 'description' | 'agentType'>) {
  return run.description?.trim() || run.agentType?.trim() || 'Subagent';
}

export function subagentStatusText(run: Pick<SubagentRun, 'summary' | 'lastToolName' | 'status'>, waiting = 'Waiting for subagent output...') {
  return run.summary?.trim() || run.lastToolName?.trim() || (run.status === 'pending' ? 'Queued' : waiting);
}
