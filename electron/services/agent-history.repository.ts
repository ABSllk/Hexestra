import fs from 'fs';
import path from 'path';
import type {
  PersistedAgentActivity,
  PersistedChatMessage,
  PersistedConversationBranch,
  ProjectState,
} from './project-state';
import type { SubagentRun } from '../agent-subagent-contract';

export const AGENT_HISTORY_FORMAT_VERSION = 1 as const;
export const DEFAULT_HISTORY_MESSAGE_LIMIT = 30;
export const DEFAULT_HISTORY_ACTIVITY_BUDGET = 300;
export const HISTORY_ACTIVITY_PAGE_LIMIT = 200;
export const LIVE_RECOVERY_TAIL_BYTES = 64 * 1024 * 1024;

export interface HistoryPage<T> {
  items: T[];
  beforeCursor: string | null;
  hasEarlier: boolean;
  total: number;
  totalActivities?: number;
}

export interface HistoryMessagePage extends HistoryPage<PersistedChatMessage> {
  totalActivities: number;
}

export interface HistoryBranchStats {
  messageCount: number;
  activityCount: number;
  subagentRunCount: number;
  lastMessageId?: string;
  lastMessageAt?: string;
}

export interface HistoryManifestBranch {
  id: string;
  parentBranchId?: string;
  forkBeforeMessageId?: string;
  /** Inclusive parent message count at the fork point; avoids copying parent history. */
  forkBeforeSeq?: number;
  createdAt: string;
}

interface HistoryManifest {
  version: typeof AGENT_HISTORY_FORMAT_VERSION;
  branches: Record<string, HistoryManifestBranch>;
}

interface MessageRecord {
  v: typeof AGENT_HISTORY_FORMAT_VERSION;
  seq: number;
  id: string;
  message: Omit<PersistedChatMessage, 'activities'>;
  activityCount: number;
}

interface ActivityRecord {
  v: typeof AGENT_HISTORY_FORMAT_VERSION;
  seq: number;
  messageId: string;
  activity: PersistedAgentActivity;
}

interface SubagentRecord {
  v: typeof AGENT_HISTORY_FORMAT_VERSION;
  seq: number;
  id: string;
  run: Omit<SubagentRun, 'activities'>;
  activityCount: number;
}

interface SubagentActivityRecord {
  v: typeof AGENT_HISTORY_FORMAT_VERSION;
  seq: number;
  runId: string;
  activity: SubagentRun['activities'][number];
}

interface LiveRecord {
  v: typeof AGENT_HISTORY_FORMAT_VERSION;
  timestamp: string;
  message?: PersistedChatMessage;
  subagentRuns?: SubagentRun[];
}

interface BranchFiles {
  directory: string;
  messages: string;
  activities: string;
  subagents: string;
  subagentActivities: string;
  live: string;
  index: string;
}

export class AgentHistoryRepository {
  private readonly root: string;
  private readonly manifestPath: string;
  private manifest: HistoryManifest;
  private statsCache = new Map<string, HistoryBranchStats>();

  constructor(private readonly sessionPath: string) {
    this.root = path.join(sessionPath, '.hexestra', 'agent-history');
    this.manifestPath = path.join(this.root, 'manifest.json');
    this.manifest = this.loadManifest();
  }

  ensureBranch(branch: Pick<PersistedConversationBranch, 'id' | 'parentBranchId' | 'createdAt'>) {
    if (!this.manifest.branches[branch.id]) {
      this.manifest.branches[branch.id] = {
        id: branch.id,
        parentBranchId: branch.parentBranchId,
        createdAt: branch.createdAt,
      };
      this.saveManifest();
    }
    this.ensureFiles(branch.id);
    this.statsCache.delete(branch.id);
  }

  ensureBranches(branches: PersistedConversationBranch[]) {
    branches.forEach((branch) => this.ensureBranch(branch));
  }

  createBranch(
    branch: Pick<PersistedConversationBranch, 'id' | 'parentBranchId' | 'createdAt'>,
    forkBeforeMessageId?: string,
  ) {
    this.ensureBranch(branch);
    const record = this.manifest.branches[branch.id];
    record.parentBranchId = branch.parentBranchId;
    record.forkBeforeMessageId = forkBeforeMessageId;
    if (forkBeforeMessageId && branch.parentBranchId) {
      const parentMessages = this.getMessages(branch.parentBranchId);
      const sourceIndex = parentMessages.findIndex((message) => message.id === forkBeforeMessageId);
      record.forkBeforeSeq = sourceIndex >= 0 ? sourceIndex + 1 : 0;
    } else {
      delete record.forkBeforeSeq;
    }
    this.statsCache.delete(branch.id);
    this.saveManifest();
  }

  migrateLegacyState(state: ProjectState) {
    this.ensureBranches(state.agent.branches);
    const migrationMarker = path.join(this.root, '.migrated-v9');
    if (fs.existsSync(migrationMarker)) return;

    for (const branch of state.agent.branches) {
      const legacyMessages = branch.messages ?? [];
      const legacyRuns = branch.subagentRuns ?? [];
      for (const message of legacyMessages) this.appendMessage(branch.id, message);
      for (const run of legacyRuns) this.appendSubagent(branch.id, run);
      const migratedMessages = this.getMessages(branch.id);
      const migratedRuns = this.getSubagentRuns(branch.id);
      if (migratedMessages.length < legacyMessages.length || migratedRuns.length < legacyRuns.length) {
        throw new Error(`Agent history migration validation failed for branch ${branch.id}`);
      }
      for (const message of legacyMessages) {
        if (!migratedMessages.some((candidate) => candidate.id === message.id)) {
          throw new Error(`Agent history migration lost message ${message.id}`);
        }
      }
      for (const run of legacyRuns) {
        if (!migratedRuns.some((candidate) => candidate.id === run.id)) {
          throw new Error(`Agent history migration lost subagent ${run.id}`);
        }
      }
    }
    fs.writeFileSync(migrationMarker, `${new Date().toISOString()}\n`, 'utf8');
    this.saveManifest();
  }

  listMessages(
    branchId: string,
    beforeCursor?: string | null,
    limit = DEFAULT_HISTORY_MESSAGE_LIMIT,
    activityBudget = DEFAULT_HISTORY_ACTIVITY_BUDGET,
  ): HistoryMessagePage {
    const all = this.getMessages(branchId);
    const end = cursorToIndex(beforeCursor, all.length);
    const start = Math.max(0, end - Math.max(1, limit));
    const page = all.slice(start, end);
    let remainingActivities = Math.max(0, activityBudget);
    const items = [...page].reverse().map((message) => {
      const activities = message.activities ?? [];
      if (activities.length <= remainingActivities) {
        remainingActivities -= activities.length;
        return message;
      }
      const visible = remainingActivities > 0 ? activities.slice(-remainingActivities) : [];
      remainingActivities = 0;
      return {
        ...message,
        activities: visible,
        hiddenActivityCount: activities.length - visible.length,
      };
    }).reverse();
    return {
      items,
      beforeCursor: start > 0 ? String(start) : null,
      hasEarlier: start > 0,
      total: all.length,
      totalActivities: all.reduce((sum, message) => sum + (message.activities?.length ?? 0), 0),
    };
  }

  listActivities(
    branchId: string,
    messageId: string,
    beforeCursor?: string | null,
    limit = HISTORY_ACTIVITY_PAGE_LIMIT,
  ): HistoryPage<PersistedAgentActivity> {
    const message = this.getMessages(branchId).find((candidate) => candidate.id === messageId);
    const all = message?.activities ?? [];
    const end = cursorToIndex(beforeCursor, all.length);
    const start = Math.max(0, end - Math.max(1, limit));
    return {
      items: all.slice(start, end),
      beforeCursor: start > 0 ? String(start) : null,
      hasEarlier: start > 0,
      total: all.length,
    };
  }

  listSubagentSummaries(branchId: string) {
    return this.getSubagentRuns(branchId).map((run) => {
      const {
        activities: _activities,
        prompt: _prompt,
        output: _output,
        error: _error,
        ...summary
      } = run;
      return { ...summary, activities: [] };
    });
  }

  getSubagentDetail(
    branchId: string,
    runId: string,
    beforeCursor?: string | null,
    limit = HISTORY_ACTIVITY_PAGE_LIMIT,
  ): { run: SubagentRun | null; page: HistoryPage<SubagentRun['activities'][number]> | null } {
    const run = this.getSubagentRuns(branchId).find((candidate) => candidate.id === runId);
    if (!run) return { run: null, page: null };
    const all = run.activities ?? [];
    const end = cursorToIndex(beforeCursor, all.length);
    const start = Math.max(0, end - Math.max(1, limit));
    return {
      run: {
        ...run,
        activities: all.slice(start, end),
        hiddenActivityCount: start > 0 ? start : undefined,
      },
      page: {
        items: all.slice(start, end),
        beforeCursor: start > 0 ? String(start) : null,
        hasEarlier: start > 0,
        total: all.length,
      },
    };
  }

  getMessages(branchId: string): PersistedChatMessage[] {
    const branch = this.manifest.branches[branchId];
    if (!branch) return [];
    const inherited = branch.parentBranchId
      ? this.getMessages(branch.parentBranchId)
      : [];
    const cutoffIndex = branch.forkBeforeMessageId
      ? inherited.findIndex((message) => message.id === branch.forkBeforeMessageId)
      : typeof branch.forkBeforeSeq === 'number'
        ? branch.forkBeforeSeq - 1
        : -1;
    // The fork marker identifies the last message retained by the child branch.
    // Keeping it makes the local transcript match Claude's resume/fork prefix.
    const hasForkMarker = Boolean(branch.forkBeforeMessageId) || typeof branch.forkBeforeSeq === 'number';
    const prefix = hasForkMarker
      ? (cutoffIndex >= 0 ? inherited.slice(0, cutoffIndex + 1) : [])
      : inherited;
    const own = this.readMessageRecords(branchId).map((record) => record.message);
    const activities = this.readActivities(branchId);
    return [...prefix, ...own].map((message) => {
      const messageActivities = activities.get(message.id) ?? [];
      return messageActivities.length ? { ...message, activities: messageActivities } : message;
    });
  }

  getSubagentRuns(branchId: string): SubagentRun[] {
    const branch = this.manifest.branches[branchId];
    if (!branch) return [];
    const visibleMessageIds = new Set(this.getMessages(branchId).map((message) => message.id));
    const inherited = branch.parentBranchId
      ? this.getSubagentRuns(branch.parentBranchId).filter((run) => !run.messageId || visibleMessageIds.has(run.messageId))
      : [];
    const own = this.readSubagentRecords(branchId).map((record) => record.run);
    const activities = this.readSubagentActivities(branchId);
    return [...inherited, ...own].map((run) => {
      const runActivities = activities.get(run.id) ?? [];
      return { ...run, activities: runActivities };
    });
  }

  getBranchStats(branchId: string): HistoryBranchStats {
    const cached = this.statsCache.get(branchId);
    if (cached) return { ...cached };
    const messages = this.getMessages(branchId);
    const subagentRuns = this.getSubagentRuns(branchId);
    const stats: HistoryBranchStats = {
      messageCount: messages.length,
      activityCount: messages.reduce((sum, message) => sum + (message.activities?.length ?? 0), 0),
      subagentRunCount: subagentRuns.length,
      lastMessageId: messages.at(-1)?.id,
      lastMessageAt: messages.at(-1)?.timestamp,
    };
    this.statsCache.set(branchId, stats);
    return { ...stats };
  }

  appendMessage(branchId: string, message: PersistedChatMessage) {
    this.ensureFiles(branchId);
    const existing = this.getOwnMessageRecords(branchId).find((record) => record.id === message.id);
    if (existing) {
      const existingActivityIds = new Set(
        this.readActivityRecords(branchId)
          .filter((record) => record.messageId === message.id)
          .map((record) => record.activity.id),
      );
      this.appendActivities(branchId, message.id, (message.activities ?? []).filter((activity) => !existingActivityIds.has(activity.id)));
      this.rebuildIndex(branchId);
      this.statsCache.clear();
      return;
    }
    const records = this.readMessageRecords(branchId);
    const base = { ...message } as PersistedChatMessage;
    delete base.activities;
    const record: MessageRecord = {
      v: AGENT_HISTORY_FORMAT_VERSION,
      seq: records.length + 1,
      id: message.id,
      message: base,
      activityCount: message.activities?.length ?? 0,
    };
    fs.appendFileSync(this.files(branchId).messages, `${JSON.stringify(record)}\n`, 'utf8');
    this.appendActivities(branchId, message.id, message.activities ?? []);
    this.rebuildIndex(branchId);
    this.statsCache.clear();
  }

  appendSubagent(branchId: string, run: SubagentRun) {
    this.ensureFiles(branchId);
    const existing = this.getOwnSubagentRecords(branchId).find((record) => record.id === run.id);
    if (existing) {
      const existingActivityIds = new Set(
        this.readSubagentActivityRecords(branchId)
          .filter((record) => record.runId === run.id)
          .map((record) => record.activity.id),
      );
      this.appendSubagentActivities(branchId, run.id, (run.activities ?? []).filter((activity) => !existingActivityIds.has(activity.id)));
      this.rebuildIndex(branchId);
      this.statsCache.clear();
      return;
    }
    const records = this.readSubagentRecords(branchId);
    const { activities: _activities, hiddenActivityCount: _hiddenActivityCount, ...base } = run;
    const record: SubagentRecord = {
      v: AGENT_HISTORY_FORMAT_VERSION,
      seq: records.length + 1,
      id: run.id,
      run: base,
      activityCount: run.activities?.length ?? 0,
    };
    fs.appendFileSync(this.files(branchId).subagents, `${JSON.stringify(record)}\n`, 'utf8');
    this.appendSubagentActivities(branchId, run.id, run.activities ?? []);
    this.rebuildIndex(branchId);
    this.statsCache.clear();
  }

  writeLive(branchId: string, message?: PersistedChatMessage, subagentRuns?: SubagentRun[]) {
    this.ensureFiles(branchId);
    const record: LiveRecord = {
      v: AGENT_HISTORY_FORMAT_VERSION,
      timestamp: new Date().toISOString(),
      ...(message ? { message } : {}),
      ...(subagentRuns?.length ? { subagentRuns } : {}),
    };
    this.replaceLiveRecord(branchId, record);
  }

  readLive(branchId: string) {
    const target = this.files(branchId).live;
    if (!fs.existsSync(target)) return null;
    const recovered = readLatestLiveRecord(target);
    if (!recovered) return null;
    if (recovered.needsCompaction) this.replaceLiveRecord(branchId, recovered.record);
    return recovered.record;
  }

  recoverLive(branchId: string) {
    const live = this.readLive(branchId);
    if (!live) return null;

    const persistedMessage = live.message
      ? this.getMessages(branchId).find((message) => message.id === live.message?.id)
      : undefined;
    const message = live.message
      ? persistedMessage ?? { ...live.message, status: 'interrupted' as const }
      : undefined;
    if (message && !persistedMessage) this.appendMessage(branchId, message);

    const persistedRuns = new Map(this.getSubagentRuns(branchId).map((run) => [run.id, run]));
    const subagentRuns = (live.subagentRuns ?? []).map((run) => {
      const persisted = persistedRuns.get(run.id);
      if (persisted) return persisted;
      const recovered = isTerminalSubagentStatus(run.status)
        ? run
        : {
            ...run,
            status: 'interrupted' as const,
            updatedAt: live.timestamp,
            endedAt: live.timestamp,
          };
      this.appendSubagent(branchId, recovered);
      persistedRuns.set(recovered.id, recovered);
      return recovered;
    });

    this.clearLive(branchId);
    return { ...live, ...(message ? { message } : {}), subagentRuns };
  }

  clearLive(branchId: string) {
    const target = this.files(branchId).live;
    if (fs.existsSync(target)) fs.writeFileSync(target, '', 'utf8');
    const temporary = liveTemporaryPath(target);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }

  clear() {
    if (fs.existsSync(this.root)) fs.rmSync(this.root, { recursive: true, force: true });
    this.manifest = this.emptyManifest();
    this.statsCache.clear();
  }

  private appendActivities(branchId: string, messageId: string, activities: PersistedAgentActivity[]) {
    const file = this.files(branchId).activities;
    const existing = this.readActivityRecords(branchId);
    activities.forEach((activity, index) => {
      const record: ActivityRecord = {
        v: AGENT_HISTORY_FORMAT_VERSION,
        seq: existing.length + index + 1,
        messageId,
        activity,
      };
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    });
  }

  private appendSubagentActivities(branchId: string, runId: string, activities: SubagentRun['activities']) {
    const file = this.files(branchId).subagentActivities;
    const existing = this.readSubagentActivityRecords(branchId);
    activities.forEach((activity, index) => {
      const record: SubagentActivityRecord = {
        v: AGENT_HISTORY_FORMAT_VERSION,
        seq: existing.length + index + 1,
        runId,
        activity,
      };
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    });
  }

  private getOwnMessageRecords(branchId: string) {
    return this.readMessageRecords(branchId);
  }

  private getOwnSubagentRecords(branchId: string) {
    return this.readSubagentRecords(branchId);
  }

  private readMessageRecords(branchId: string) {
    return readJsonl<MessageRecord>(this.files(branchId).messages).filter((record) => record?.v === AGENT_HISTORY_FORMAT_VERSION && typeof record.id === 'string');
  }

  private readActivityRecords(branchId: string) {
    return readJsonl<ActivityRecord>(this.files(branchId).activities).filter((record) => record?.v === AGENT_HISTORY_FORMAT_VERSION && typeof record.messageId === 'string');
  }

  private readSubagentRecords(branchId: string) {
    return readJsonl<SubagentRecord>(this.files(branchId).subagents).filter((record) => record?.v === AGENT_HISTORY_FORMAT_VERSION && typeof record.id === 'string');
  }

  private readSubagentActivityRecords(branchId: string) {
    return readJsonl<SubagentActivityRecord>(this.files(branchId).subagentActivities).filter((record) => record?.v === AGENT_HISTORY_FORMAT_VERSION && typeof record.runId === 'string');
  }

  private readActivities(branchId: string) {
    const grouped = new Map<string, PersistedAgentActivity[]>();
    this.readActivityRecords(branchId).forEach((record) => {
      const list = grouped.get(record.messageId) ?? [];
      list.push(record.activity);
      grouped.set(record.messageId, list);
    });
    return grouped;
  }

  private readSubagentActivities(branchId: string) {
    const grouped = new Map<string, SubagentRun['activities']>();
    this.readSubagentActivityRecords(branchId).forEach((record) => {
      const list = grouped.get(record.runId) ?? [];
      list.push(record.activity);
      grouped.set(record.runId, list);
    });
    return grouped;
  }

  private ensureFiles(branchId: string) {
    const files = this.files(branchId);
    fs.mkdirSync(files.directory, { recursive: true });
    for (const file of [files.messages, files.activities, files.subagents, files.subagentActivities, files.live]) {
      if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
    }
    if (!fs.existsSync(files.index)) {
      fs.writeFileSync(files.index, JSON.stringify({ version: AGENT_HISTORY_FORMAT_VERSION }), 'utf8');
    } else {
      try {
        const index = JSON.parse(fs.readFileSync(files.index, 'utf8')) as { version?: number; messages?: unknown; activities?: unknown; subagents?: unknown; subagentActivities?: unknown };
        if (index.version !== AGENT_HISTORY_FORMAT_VERSION || !Array.isArray(index.messages) || !Array.isArray(index.activities) || !Array.isArray(index.subagents) || !Array.isArray(index.subagentActivities)) {
          this.rebuildIndex(branchId);
        }
      } catch {
        this.rebuildIndex(branchId);
      }
    }
  }

  private rebuildIndex(branchId: string) {
    const files = this.files(branchId);
    const messages = readJsonlWithOffsets<MessageRecord>(files.messages)
      .filter(({ value }) => value?.v === AGENT_HISTORY_FORMAT_VERSION && typeof value.id === 'string');
    const activities = readJsonlWithOffsets<ActivityRecord>(files.activities)
      .filter(({ value }) => value?.v === AGENT_HISTORY_FORMAT_VERSION && typeof value.messageId === 'string');
    const subagents = readJsonlWithOffsets<SubagentRecord>(files.subagents)
      .filter(({ value }) => value?.v === AGENT_HISTORY_FORMAT_VERSION && typeof value.id === 'string');
    const subagentActivities = readJsonlWithOffsets<SubagentActivityRecord>(files.subagentActivities)
      .filter(({ value }) => value?.v === AGENT_HISTORY_FORMAT_VERSION && typeof value.runId === 'string');
    const index = {
      version: AGENT_HISTORY_FORMAT_VERSION,
      messages: messages.map(({ value, byteOffset, byteLength }) => ({ id: value.id, seq: value.seq, activityCount: value.activityCount, byteOffset, byteLength })),
      activities: activities.map(({ value, byteOffset, byteLength }) => ({ messageId: value.messageId, seq: value.seq, byteOffset, byteLength })),
      subagents: subagents.map(({ value, byteOffset, byteLength }) => ({ id: value.id, seq: value.seq, activityCount: value.activityCount, byteOffset, byteLength })),
      subagentActivities: subagentActivities.map(({ value, byteOffset, byteLength }) => ({ runId: value.runId, seq: value.seq, byteOffset, byteLength })),
      updatedAt: new Date().toISOString(),
    };
    const temp = `${files.index}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(index, null, 2), 'utf8');
    fs.renameSync(temp, files.index);
  }

  private files(branchId: string): BranchFiles {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(branchId)) {
      throw new Error('Invalid history branch identifier');
    }
    const directory = path.join(this.root, 'branches', branchId);
    return {
      directory,
      messages: path.join(directory, 'messages.jsonl'),
      activities: path.join(directory, 'activities.jsonl'),
      subagents: path.join(directory, 'subagents.jsonl'),
      subagentActivities: path.join(directory, 'subagent-activities.jsonl'),
      live: path.join(directory, 'live.jsonl'),
      index: path.join(directory, 'index.json'),
    };
  }

  private loadManifest(): HistoryManifest {
    try {
      const value = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')) as Partial<HistoryManifest>;
      if (value.version === AGENT_HISTORY_FORMAT_VERSION && value.branches && typeof value.branches === 'object') {
        return { version: AGENT_HISTORY_FORMAT_VERSION, branches: value.branches };
      }
    } catch {
      // A missing or torn manifest is rebuilt from an empty state.
    }
    return this.emptyManifest();
  }

  private emptyManifest(): HistoryManifest {
    return { version: AGENT_HISTORY_FORMAT_VERSION, branches: {} };
  }

  private saveManifest() {
    fs.mkdirSync(this.root, { recursive: true });
    const temp = `${this.manifestPath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.manifest, null, 2), 'utf8');
    fs.renameSync(temp, this.manifestPath);
  }

  private replaceLiveRecord(branchId: string, record: LiveRecord) {
    const target = this.files(branchId).live;
    const temporary = liveTemporaryPath(target);
    try {
      fs.writeFileSync(temporary, serializeLiveRecord(record), 'utf8');
      fs.renameSync(temporary, target);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
      throw error;
    }
  }
}

function readLatestLiveRecord(file: string): { record: LiveRecord; needsCompaction: boolean } | null {
  const descriptor = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    if (size <= 0) return null;
    const tailLength = Math.min(size, LIVE_RECOVERY_TAIL_BYTES);
    const tail = Buffer.allocUnsafe(tailLength);
    const bytesRead = fs.readSync(descriptor, tail, 0, tailLength, size - tailLength);
    const lines = tail.subarray(0, bytesRead).toString('utf8').split(/\r?\n/);
    const firstLineIsPartial = size > tailLength;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line || (firstLineIsPartial && index === 0)) continue;
      try {
        const record = JSON.parse(line) as LiveRecord;
        if (!isLiveRecord(record)) continue;
        return {
          record,
          needsCompaction: size !== Buffer.byteLength(serializeLiveRecord(record), 'utf8'),
        };
      } catch {
        // Continue to the previous complete record when the newest line is torn.
      }
    }
    return null;
  } finally {
    fs.closeSync(descriptor);
  }
}

function isLiveRecord(value: unknown): value is LiveRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<LiveRecord>;
  return record.v === AGENT_HISTORY_FORMAT_VERSION && typeof record.timestamp === 'string';
}

function isTerminalSubagentStatus(status: SubagentRun['status']) {
  return status === 'completed'
    || status === 'failed'
    || status === 'stopped'
    || status === 'killed'
    || status === 'interrupted';
}

function serializeLiveRecord(record: LiveRecord) {
  return `${JSON.stringify(record)}\n`;
}

function liveTemporaryPath(target: string) {
  return `${target}.tmp`;
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const values: T[] = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line) as T);
    } catch {
      // Ignore only the malformed line; valid earlier history remains readable.
    }
  }
  return values;
}

function readJsonlWithOffsets<T>(file: string): Array<{ value: T; byteOffset: number; byteLength: number }> {
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, 'utf8');
  const values: Array<{ value: T; byteOffset: number; byteLength: number }> = [];
  let byteOffset = 0;
  for (const line of source.split(/(?<=\n)/)) {
    const byteLength = Buffer.byteLength(line, 'utf8');
    const text = line.trim();
    if (text) {
      try {
        values.push({ value: JSON.parse(text) as T, byteOffset, byteLength });
      } catch {
        // Ignore only the malformed record; later valid records remain indexed.
      }
    }
    byteOffset += byteLength;
  }
  return values;
}

function cursorToIndex(cursor: string | null | undefined, total: number) {
  if (!cursor) return total;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(total, parsed)) : total;
}
