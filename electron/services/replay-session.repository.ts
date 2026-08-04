import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ReplaySession, ReplaySessionPatch, TrafficFlow, TrafficRequest } from '../contracts/traffic';
import { assertTrafficId, normalizeReplayDraft } from './traffic-contract';
import { projectDataPath } from './project-registry';

const SESSION_ID_PATTERN = /^replay-[a-f0-9]{32}$/;
const MAX_ATTEMPTS = 2_000;

export class ReplaySessionRepository {
  private readonly root: string;

  constructor(projectPath: string, private readonly projectId: string) {
    this.root = path.join(projectDataPath(projectPath), 'replay', 'sessions');
    fs.mkdirSync(this.root, { recursive: true });
  }

  open(source: TrafficFlow): ReplaySession {
    if (source.request.httpVersion === 'websocket') throw new Error('WebSocket flows cannot be replayed');
    const id = replaySessionId(source.id);
    const existing = this.read(id);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.write({
      id,
      projectId: this.projectId,
      sourceFlowId: source.id,
      draft: structuredClone(source.request),
      draftText: formatReplayRequest(source.request),
      attemptFlowIds: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  read(id: string): ReplaySession | null {
    const filePath = this.filePath(id);
    if (!fs.existsSync(filePath)) return null;
    return parseReplaySession(fs.readFileSync(filePath, 'utf8'), this.projectId, id);
  }

  update(current: ReplaySession, sourceRequest: TrafficRequest, patch: ReplaySessionPatch & { attemptFlowIds?: string[] }): ReplaySession {
    const attemptFlowIds = patch.attemptFlowIds === undefined
      ? current.attemptFlowIds
      : normalizeAttemptIds(patch.attemptFlowIds);
    const selectedAttemptFlowId = patch.selectedAttemptFlowId === undefined
      ? current.selectedAttemptFlowId
      : patch.selectedAttemptFlowId === null
        ? undefined
        : assertTrafficId(patch.selectedAttemptFlowId, 'selected replay attempt');
    if (selectedAttemptFlowId && !attemptFlowIds.includes(selectedAttemptFlowId)) {
      throw new Error('Selected replay attempt is not part of this session');
    }
    const draft = patch.draft === undefined ? current.draft : normalizeReplayDraft(sourceRequest, patch.draft);
    return this.write({
      ...current,
      draft,
      draftText: patch.draftText === undefined
        ? patch.draft === undefined ? current.draftText : formatReplayRequest(draft)
        : normalizeDraftText(patch.draftText),
      attemptFlowIds,
      selectedAttemptFlowId,
      updatedAt: new Date().toISOString(),
    });
  }

  clear(id: string) {
    const filePath = this.filePath(id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  clearSourceSessions(flowIds: readonly string[]) {
    const sessionIds = this.sourceSessionIds(flowIds);
    for (const sessionId of sessionIds) this.clear(sessionId);
    return sessionIds;
  }

  removeFlowReference(flowId: string) {
    return this.removeFlowReferences([flowId]);
  }

  removeFlowReferences(flowIds: readonly string[]) {
    const deleting = new Set(flowIds.map((flowId) => assertTrafficId(flowId)));
    if (this.retainedSourceFlowIds([...deleting]).length > 0) {
      throw new Error('Clear retained Hexestra Repeater sessions before clearing their source Flows');
    }
    let updated = 0;
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -'.json'.length);
      const session = this.read(id);
      if (!session?.attemptFlowIds.some((id) => deleting.has(id))) continue;
      const attemptFlowIds = session.attemptFlowIds.filter((id) => !deleting.has(id));
      this.write({
        ...session,
        attemptFlowIds,
        selectedAttemptFlowId: session.selectedAttemptFlowId && deleting.has(session.selectedAttemptFlowId)
          ? undefined
          : session.selectedAttemptFlowId,
        updatedAt: new Date().toISOString(),
      });
      updated += 1;
    }
    return updated;
  }

  retainedSourceFlowIds(flowIds: readonly string[]) {
    return [...new Set(flowIds.map((flowId) => assertTrafficId(flowId)))]
      .filter((flowId) => this.read(replaySessionId(flowId)) !== null);
  }

  sourceSessionIds(flowIds: readonly string[]) {
    return this.retainedSourceFlowIds(flowIds).map((flowId) => replaySessionId(flowId));
  }

  private write(session: ReplaySession) {
    const filePath = this.filePath(session.id);
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, filePath);
    return structuredClone(session);
  }

  private filePath(id: string) {
    if (!SESSION_ID_PATTERN.test(id)) throw new Error('Invalid replay session identifier');
    return path.join(this.root, `${id}.json`);
  }
}

export function replaySessionId(sourceFlowId: string) {
  assertTrafficId(sourceFlowId);
  return `replay-${crypto.createHash('sha256').update(sourceFlowId).digest('hex').slice(0, 32)}`;
}

function parseReplaySession(source: string, projectId: string, expectedId: string): ReplaySession {
  const value = JSON.parse(source) as ReplaySession;
  if (value.id !== expectedId || value.projectId !== projectId || !SESSION_ID_PATTERN.test(value.id)) {
    throw new Error('Replay session identity mismatch');
  }
  assertTrafficId(value.sourceFlowId, 'replay source');
  if (!value.draft || typeof value.draft.url !== 'string' || !Array.isArray(value.draft.headers) || !value.draft.body) {
    throw new Error('Invalid replay session draft');
  }
  return {
    ...value,
    draftText: typeof value.draftText === 'string' ? normalizeDraftText(value.draftText) : formatReplayRequest(value.draft),
    attemptFlowIds: normalizeAttemptIds(value.attemptFlowIds),
    selectedAttemptFlowId: value.selectedAttemptFlowId
      ? assertTrafficId(value.selectedAttemptFlowId, 'selected replay attempt')
      : undefined,
  };
}

function normalizeDraftText(value: unknown) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 25 * 1024 * 1024) {
    throw new Error('Invalid replay draft text');
  }
  return value;
}

function formatReplayRequest(request: TrafficRequest) {
  const version = request.httpVersion === 'h2' ? 'HTTP/2' : 'HTTP/1.1';
  return [
    `${request.method} ${request.url} ${version}`,
    ...request.headers.map((header) => `${header.name}: ${header.value}`),
    '',
    request.body.data,
  ].join('\r\n');
}

function normalizeAttemptIds(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_ATTEMPTS) throw new Error('Invalid replay attempt history');
  return [...new Set(value.map((id) => assertTrafficId(id, 'replay attempt')))];
}
