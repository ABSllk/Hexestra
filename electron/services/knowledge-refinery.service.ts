import { BrowserWindow, dialog, ipcMain } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { claudeCapabilitiesService } from './claude-capabilities.service';
import { sessionService } from './session.service';
import { workflowService } from './workflow.service';
import { resolveGlobalUserPath } from './hexestra-home';
import type { PersistedChatMessage } from './project-state';
import type { SubagentRun } from '../agent-subagent-contract';
import type {
  KnowledgeSource,
  RefineryAnalysisRequest,
  RefineryAnalysisResult,
  RefineryApplyResult,
  RefineryCandidate,
  RefineryCandidatePayload,
  RefineryCandidateSummary,
  RefineryCandidateUpdateInput,
  RefineryDocumentFormat,
  RefineryDebugEntry,
  RefineryDebugLog,
  RefineryInvocation,
  RefineryJob,
  RefineryJobProgress,
  RefineryJobStatus,
  RefineryOutputKind,
  RefineryPage,
  RefinerySourcePreviewPage,
  SourceAnchor,
} from '../contracts/knowledge-refinery';
import { KNOWLEDGE_REFINERY_IPC } from '../contracts/knowledge-refinery';
import type { RestrictionRule } from './restriction.service';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 8 * 1024 * 1024;
const CANDIDATE_PAGE_SIZE = 50;
const SOURCE_PREVIEW_PAGE_SIZE = 60;
const REFINERY_DEBUG_MAX_ENTRIES = 400;
const REFINERY_DEBUG_MAX_TEXT_LENGTH = 64 * 1024;
const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.csv', '.json', '.yaml', '.yml', '.xml', '.ini', '.conf', '.cfg']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);
const CODE_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cc', '.cpp', '.h', '.sh', '.ps1', '.sql', '.rb', '.php']);

interface KnowledgeRefineryDependencies {
  analyze(input: RefineryAnalysisRequest): Promise<RefineryAnalysisResult>;
  isMainAgentBusy(): boolean;
  modelSnapshot(): string;
}

interface StoredJob extends RefineryJob {
  sessionId: string;
  attempt: number;
}

interface SourceChunk {
  anchor: SourceAnchor;
  text: string;
}

/**
 * Owns the extraction/review lifecycle. It deliberately has no Agent tool
 * surface: the only durable writes happen after an explicit renderer IPC call.
 */
export class KnowledgeRefineryService {
  private readonly sourceRoot: string;
  private readonly queued = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly deleting = new Set<string>();
  private running = false;

  constructor(private readonly dependencies: KnowledgeRefineryDependencies, registerHandlers = true) {
    this.sourceRoot = path.join(resolveGlobalUserPath(), 'knowledge-refinery', 'sources');
    if (registerHandlers) this.registerHandlers();
  }

  private registerHandlers() {
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.SOURCES_LIST, () => this.listSources());
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.SOURCES_READ, (_event, sourceId: string) => this.readSource(sourceId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.SOURCES_PREVIEW, (_event, sourceId: string, beforeCursor?: string | null) => this.previewSource(sourceId, beforeCursor));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.SOURCES_IMPORT, async (event, sourcePaths?: string[]) => this.importSources(event.sender, sourcePaths));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.SOURCES_DELETE, (_event, sourceId: string, confirm = false) => this.deleteSource(sourceId, confirm));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.JOBS_LIST, (_event, sessionId: string) => this.listJobs(sessionId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.JOBS_READ, (_event, sessionId: string, jobId: string) => this.readJob(sessionId, jobId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.JOBS_CREATE_FROM_SOURCE, (_event, sessionId: string, sourceId: string) => this.createJobFromSource(sessionId, sourceId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.JOBS_CANCEL, (_event, sessionId: string, jobId: string) => this.cancelJob(sessionId, jobId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.JOBS_RETRY, (_event, sessionId: string, jobId: string) => this.retryJob(sessionId, jobId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.JOBS_DELETE, (_event, sessionId: string, jobId: string) => this.deleteJob(sessionId, jobId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.JOBS_DEBUG, (_event, sessionId: string, jobId: string) => this.readJobDebug(sessionId, jobId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.CANDIDATES_PAGE, (_event, sessionId: string, jobId: string, beforeCursor?: string | null, kind?: RefineryOutputKind) => this.listCandidates(sessionId, jobId, beforeCursor, kind));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.CANDIDATES_READ, (_event, sessionId: string, jobId: string, candidateId: string) => this.readCandidate(sessionId, jobId, candidateId));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.CANDIDATES_UPDATE, (_event, sessionId: string, jobId: string, candidateId: string, patch: RefineryCandidateUpdateInput) => this.updateCandidate(sessionId, jobId, candidateId, patch));
    ipcMain.handle(KNOWLEDGE_REFINERY_IPC.CANDIDATES_APPLY, (_event, sessionId: string, jobId: string, candidateIds: string[]) => this.applyCandidates(sessionId, jobId, candidateIds));
  }

  async importSources(ownerContents: Electron.WebContents, sourcePaths?: string[]) {
    let paths = sourcePaths?.filter((value): value is string => typeof value === 'string') ?? [];
    if (paths.length === 0) {
      const owner = BrowserWindow.fromWebContents(ownerContents);
      const result = owner
        ? await dialog.showOpenDialog(owner, documentDialogOptions())
        : await dialog.showOpenDialog(documentDialogOptions());
      if (result.canceled) return [];
      paths = result.filePaths;
    }
    return Promise.all(paths.slice(0, 20).map((sourcePath) => this.importOneSource(sourcePath)));
  }

  private async importOneSource(sourcePath: string): Promise<KnowledgeSource> {
    const resolved = path.resolve(sourcePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('Knowledge source must be a file');
    if (stat.size > MAX_SOURCE_BYTES) throw new Error('Knowledge source exceeds the 25 MiB limit');
    const format = formatKnowledgeRefinerySource(resolved);
    if (!format) throw new Error('Only text, Markdown, code, PDF, and DOCX sources are supported');
    const fingerprint = hashFile(resolved);
    const existing = this.listSources().find((source) => source.fingerprint === fingerprint);
    if (existing) return existing;
    const id = `source-${crypto.randomUUID()}`;
    const directory = this.sourceDirectory(id);
    const originalName = safeBasename(path.basename(resolved));
    const target = path.join(directory, `original${path.extname(originalName).toLowerCase()}`);
    fs.mkdirSync(directory, { recursive: true });
    copyAtomic(resolved, target);
    const chunks = await extractKnowledgeRefinerySource(target, format);
    writeJsonlAtomic(path.join(directory, 'extracted.jsonl'), chunks);
    const now = new Date().toISOString();
    const source: KnowledgeSource = {
      id,
      kind: 'document',
      name: originalName,
      fingerprint,
      format,
      size: stat.size,
      createdAt: now,
      updatedAt: now,
      sourceAvailable: true,
      diagnostics: chunks.length ? [] : ['No reliable text could be extracted from this document.'],
    };
    writeJsonAtomic(path.join(directory, 'metadata.json'), source);
    return source;
  }

  listSources(): KnowledgeSource[] {
    if (!fs.existsSync(this.sourceRoot)) return [];
    return fs.readdirSync(this.sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        try { return [this.readSource(entry.name)].filter((value): value is KnowledgeSource => value !== null); } catch { return []; }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  readSource(sourceId: string): KnowledgeSource | null {
    const file = path.join(this.sourceDirectory(sourceId), 'metadata.json');
    if (!fs.existsSync(file)) return null;
    const source = parseKnowledgeSource(readJson(file));
    if (!source) return null;
    return { ...source, sourceAvailable: Boolean(this.originalFilePath(sourceId)) };
  }

  previewSource(sourceId: string, beforeCursor?: string | null): RefinerySourcePreviewPage {
    const source = this.readSource(sourceId);
    if (!source) throw new Error('Knowledge source not found');
    const chunks = readJsonl<SourceChunk>(path.join(this.sourceDirectory(sourceId), 'extracted.jsonl'));
    return pageFromEnd(chunks, beforeCursor, SOURCE_PREVIEW_PAGE_SIZE, (item) => ({ anchor: item.anchor, text: item.text }));
  }

  async readSourceForAgent(sourceId: string) {
    const source = this.readSource(sourceId);
    if (!source) throw new Error('Knowledge source not found');
    if (!source.sourceAvailable) throw new Error('Retained source file is missing');
    const chunks = await this.readDocumentChunks(source);
    if (chunks.length === 0) throw new Error('No reliable text could be extracted from this source');
    return {
      name: source.name,
      content: chunks.map((chunk) => `[${chunk.anchor.label}]\n${chunk.text}`).join('\n\n'),
    };
  }

  async deleteSource(sourceId: string, confirm: boolean) {
    const source = this.readSource(sourceId);
    if (!source) return false;
    const references = (await sessionService.listSessions())
      .flatMap((session) => this.listJobs(session.id).map((job) => ({ sessionId: session.id, job })))
      .filter(({ job }) => job.source.kind === 'document' && job.source.id === sourceId);
    if (!confirm && references.length > 0) {
      throw new Error(`This source is retained by ${references.length} refinement job(s). Confirm deletion to keep their review records but disable reruns.`);
    }
    if (!confirm) throw new Error('Confirm deletion of this retained source before continuing');
    fs.rmSync(this.sourceDirectory(sourceId), { recursive: true, force: false });
    references.forEach(({ sessionId, job }) => this.emitChanged(sessionId, job.id));
    return true;
  }

  createJobFromSource(sessionId: string, sourceId: string) {
    const source = this.readSource(sourceId);
    if (!source) throw new Error('Knowledge source not found');
    if (!source.sourceAvailable) throw new Error('Retained source file is missing');
    return this.createJob(sessionId, source);
  }

  createJobFromConversation(sessionId: string, branchId: string) {
    const source = this.conversationSource(sessionId, branchId);
    return this.createJob(sessionId, source);
  }

  private createJob(sessionId: string, source: KnowledgeSource): RefineryJob {
    sessionService.getSessionPath(sessionId);
    const now = new Date().toISOString();
    const job: StoredJob = {
      id: `refinery-job-${crypto.randomUUID()}`,
      sessionId,
      source,
      requestedOutputs: ['restriction', 'skill', 'workflow'],
      status: 'queued',
      progress: { phase: this.dependencies.isMainAgentBusy() ? 'Waiting for the current Agent turn' : 'Queued', completed: 0, total: 1 },
      modelSnapshot: this.dependencies.modelSnapshot(),
      candidateCounts: emptyCounts(),
      diagnostics: [],
      ignoredSummary: [],
      attempt: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.writeJob(job);
    this.enqueue(job);
    return job;
  }

  listJobs(sessionId: string): RefineryJob[] {
    const root = this.jobsRoot(sessionId);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        try { const job = this.readStoredJob(sessionId, entry.name); return job ? [job] : []; } catch { return []; }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  readJob(sessionId: string, jobId: string): RefineryJob | null {
    return this.readStoredJob(sessionId, jobId);
  }

  readJobDebug(sessionId: string, jobId: string): RefineryDebugLog {
    this.requireJob(sessionId, jobId);
    const entries = readJsonl<unknown>(this.debugPath(sessionId, jobId))
      .flatMap((value) => normalizeDebugEntry(value));
    const items = entries.slice(-REFINERY_DEBUG_MAX_ENTRIES);
    return { items, total: entries.length, truncated: items.length !== entries.length };
  }

  listCandidates(sessionId: string, jobId: string, beforeCursor?: string | null, kind?: RefineryOutputKind): RefineryPage<RefineryCandidateSummary> {
    const job = this.requireJob(sessionId, jobId);
    const candidates = this.candidateIds(job)
      .map((id) => this.readCandidate(sessionId, job.id, id))
      .filter((candidate): candidate is RefineryCandidate => Boolean(candidate))
      .filter((candidate) => !kind || candidate.kind === kind)
      .map(candidateSummary);
    return pageFromEnd(candidates, beforeCursor, CANDIDATE_PAGE_SIZE, (value) => value);
  }

  readCandidate(sessionId: string, jobId: string, candidateId: string): RefineryCandidate | null {
    this.requireJob(sessionId, jobId);
    const candidate = parseCandidate(readJsonIfExists(this.candidatePath(sessionId, jobId, candidateId)));
    return candidate;
  }

  updateCandidate(sessionId: string, jobId: string, candidateId: string, patch: RefineryCandidateUpdateInput): RefineryCandidate {
    const job = this.requireJob(sessionId, jobId);
    const candidate = this.readCandidate(sessionId, jobId, candidateId);
    if (!candidate) throw new Error('Refinery candidate not found');
    if (candidate.decision === 'applied') throw new Error('Applied candidates cannot be edited');
    const next: RefineryCandidate = {
      ...candidate,
      ...(typeof patch.title === 'string' ? { title: patch.title.trim().slice(0, 160) } : {}),
      ...(typeof patch.rationale === 'string' ? { rationale: patch.rationale.trim().slice(0, 1_000) } : {}),
      ...(patch.suggestedScope === 'global' || patch.suggestedScope === 'project' ? { suggestedScope: patch.suggestedScope } : {}),
      ...(patch.decision === 'pending' || patch.decision === 'accepted' || patch.decision === 'rejected' ? { decision: patch.decision } : {}),
      ...(patch.payload ? { payload: validateCandidatePayload(candidate.kind, patch.payload) } : {}),
    };
    if (next.kind === 'workflow') next.suggestedScope = 'global';
    const scopeDiagnostic = globalScopeDiagnostic(sessionId, next);
    next.diagnostic = scopeDiagnostic ?? next.diagnostic;
    this.writeCandidate(sessionId, jobId, next);
    this.refreshJobCounts(job);
    return next;
  }

  async applyCandidates(sessionId: string, jobId: string, candidateIds: string[]): Promise<RefineryApplyResult> {
    const job = this.requireJob(sessionId, jobId);
    const requested = [...new Set(candidateIds.filter((id) => typeof id === 'string'))];
    const result: RefineryApplyResult = { applied: [], failed: [] };
    for (const candidateId of requested) {
      const candidate = this.readCandidate(sessionId, jobId, candidateId);
      if (!candidate) { result.failed.push({ candidateId, message: 'Candidate not found' }); continue; }
      if (candidate.decision !== 'accepted') { result.failed.push({ candidateId, message: 'Accept the candidate before applying it' }); continue; }
      const advisory = globalScopeDiagnostic(sessionId, candidate);
      if (advisory) { result.failed.push({ candidateId, message: advisory }); continue; }
      try {
        const artifactId = await this.applyCandidate(sessionId, candidate);
        const applied = { ...candidate, decision: 'applied' as const, diagnostic: undefined };
        this.writeCandidate(sessionId, jobId, applied);
        this.appendReceipt(sessionId, jobId, { candidateId, artifactId, kind: candidate.kind, at: new Date().toISOString() });
        result.applied.push({ candidateId, kind: candidate.kind, artifactId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.writeCandidate(sessionId, jobId, { ...candidate, decision: 'failed', diagnostic: message });
        result.failed.push({ candidateId, message });
      }
    }
    this.refreshJobCounts(job);
    return result;
  }

  private async applyCandidate(sessionId: string, candidate: RefineryCandidate) {
    if (candidate.dedupe.action === 'skip' || candidate.dedupe.action === 'merge') throw new Error('Skipped or merge-only candidates cannot be applied directly');
    if (candidate.kind === 'restriction') {
      const payload = candidate.payload as Extract<RefineryCandidatePayload, { text: string; selector: unknown }>;
      const scope = candidate.suggestedScope === 'project' ? 'project' : 'global';
      const restrictions = sessionService.getRestrictions(sessionId);
      const document = scope === 'global' ? restrictions.global : restrictions.project;
      if (candidate.dedupe.expectedFingerprint && document.fingerprint !== candidate.dedupe.expectedFingerprint) {
        throw new Error('Restrictions changed on disk. Re-run or refresh this candidate before applying.');
      }
      const id = candidate.dedupe.action === 'update' ? candidate.dedupe.targetId : undefined;
      sessionService.upsertRestriction(sessionId, scope, { id, text: payload.text, selector: payload.selector as never, enabled: payload.enabled }, true);
      return id ?? `restriction:${hashText(`${scope}|${payload.text}`).slice(0, 16)}`;
    }
    if (candidate.kind === 'skill') {
      const payload = candidate.payload as Extract<RefineryCandidatePayload, { content: string; name: string }>;
      const scope = candidate.suggestedScope === 'project' ? 'project' : 'global';
      if (candidate.dedupe.action === 'update' && candidate.dedupe.targetId) {
        const existing = await claudeCapabilitiesService.readSkill({ sessionId, scope, name: candidate.dedupe.targetId, enabled: true });
        if (candidate.dedupe.expectedFingerprint && hashText(existing.content) !== candidate.dedupe.expectedFingerprint) throw new Error('Skill changed on disk. Reload before applying.');
      }
      await claudeCapabilitiesService.saveSkill({ sessionId, scope, name: payload.name, content: renderRefinerySkillMarkdown(payload), enabled: true, ...(candidate.dedupe.action === 'update' && candidate.dedupe.targetId ? { originalName: candidate.dedupe.targetId } : {}) });
      return payload.name;
    }
    const payload = candidate.payload as Extract<RefineryCandidatePayload, { body: string; id: string }>;
    const existingId = candidate.dedupe.action === 'update' ? candidate.dedupe.targetId : undefined;
    const existing = existingId ? workflowService.read(existingId) : null;
    if (candidate.dedupe.expectedFingerprint && existing?.fingerprint !== candidate.dedupe.expectedFingerprint) throw new Error('Workflow changed on disk. Reload before applying.');
    const saved = workflowService.save({
      id: existingId ?? payload.id,
      name: payload.name,
      description: payload.description,
      version: payload.version,
      tags: payload.tags,
      body: payload.body,
      ...(existing ? { expectedFingerprint: existing.fingerprint } : {}),
    });
    return saved.id;
  }

  cancelJob(sessionId: string, jobId: string) {
    const job = this.requireJob(sessionId, jobId);
    this.queued.delete(queueKey(sessionId, jobId));
    this.controllers.get(queueKey(sessionId, jobId))?.abort();
    const next = updateJob(job, 'canceled', { phase: 'Canceled', completed: job.progress.completed, total: job.progress.total });
    this.writeJob(next);
    return next;
  }

  retryJob(sessionId: string, jobId: string) {
    const job = this.requireJob(sessionId, jobId);
    if (job.status === 'analyzing') throw new Error('Refinery job is already running');
    if (job.source.kind === 'document' && !job.source.sourceAvailable) throw new Error('This job cannot be retried because its retained source was deleted');
    const next: StoredJob = { ...job, status: 'queued', progress: { phase: 'Queued for retry', completed: 0, total: 1 }, diagnostics: [], attempt: job.attempt + 1, updatedAt: new Date().toISOString() };
    this.writeJob(next);
    this.enqueue(next);
    return next;
  }

  deleteJob(sessionId: string, jobId: string) {
    const key = queueKey(sessionId, jobId);
    this.deleting.add(key);
    this.cancelJob(sessionId, jobId);
    const directory = this.jobDirectory(sessionId, jobId);
    if (!fs.existsSync(directory)) { this.deleting.delete(key); return false; }
    fs.rmSync(directory, { recursive: true, force: false });
    if (!this.controllers.has(key)) this.deleting.delete(key);
    this.emitChanged(sessionId, jobId);
    return true;
  }

  clearConversationJobs(sessionId: string) {
    this.listJobs(sessionId)
      .filter((job) => job.source.kind === 'conversation')
      .forEach((job) => this.deleteJob(sessionId, job.id));
  }

  resumeQueued() { void this.pump(); }

  private enqueue(job: StoredJob) {
    this.queued.add(queueKey(job.sessionId, job.id));
    this.emitChanged(job.sessionId, job.id);
    void this.pump();
  }

  private async pump() {
    if (this.running || this.dependencies.isMainAgentBusy()) return;
    const nextKey = [...this.queued][0];
    if (!nextKey) return;
    const [sessionId, jobId] = splitQueueKey(nextKey);
    const job = this.readStoredJob(sessionId, jobId);
    this.queued.delete(nextKey);
    if (!job || job.status !== 'queued') return void this.pump();
    this.running = true;
    const controller = new AbortController();
    this.controllers.set(nextKey, controller);
    try {
      await this.runJob(job, controller.signal);
    } finally {
      this.controllers.delete(nextKey);
      this.deleting.delete(nextKey);
      this.running = false;
      void this.pump();
    }
  }

  private async runJob(initial: StoredJob, signal: AbortSignal) {
    let job = updateJob(initial, 'extracting', { phase: 'Preparing source', completed: 0, total: 1 });
    this.writeJob(job);
    try {
      const chunks = await this.resolveJobChunks(job);
      if (signal.aborted) throw new Error('Knowledge refinement was cancelled');
      if (chunks.length === 0) throw new Error('No reliable text is available for refinement');
      job = updateJob(job, 'analyzing', { phase: 'Analyzing reusable knowledge', completed: 0, total: chunks.length });
      this.writeJob(job);
      const existing = await this.existingLibrary(job.sessionId);
      const result = await this.dependencies.analyze({
        cwd: sessionService.getSessionPath(job.sessionId),
        projectId: job.sessionId,
        sourceName: job.source.name,
        chunks,
        existing,
        signal,
        attempt: job.attempt,
        onDebug: (entry) => this.appendDebug(job.sessionId, job.id, entry),
      });
      if (signal.aborted) throw new Error('Knowledge refinement was cancelled');
      const candidates = result.candidates.map((candidate) => this.finalizeCandidate(job.sessionId, candidate, existing));
      candidates.forEach((candidate) => this.writeCandidate(job.sessionId, job.id, candidate));
      const ready: StoredJob = {
        ...job,
        status: 'review_required',
        progress: { phase: 'Ready for review', completed: chunks.length, total: chunks.length },
        ignoredSummary: result.ignoredSummary.slice(0, 20),
        diagnostics: candidates.length ? [] : ['No reusable Restrictions, Skills, or Workflows were found.'],
        updatedAt: new Date().toISOString(),
      };
      this.refreshJobCounts(ready);
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof Error && /cancelled/i.test(error.message));
      const failed = updateJob(job, cancelled ? 'canceled' : 'failed', { phase: cancelled ? 'Canceled' : 'Failed', completed: job.progress.completed, total: job.progress.total }, error instanceof Error ? error.message : String(error));
      this.writeJob(failed);
    }
  }

  private async resolveJobChunks(job: StoredJob): Promise<SourceChunk[]> {
    if (job.source.kind === 'document') {
      const source = this.readSource(job.source.id);
      if (!source?.sourceAvailable) throw new Error('Retained source file is missing');
      return chunkText(await this.readDocumentChunks(source));
    }
    return chunkText(this.conversationChunks(job.sessionId, job.source.branchId ?? 'main', job.source.messageIds ?? []));
  }

  private async readDocumentChunks(source: KnowledgeSource): Promise<SourceChunk[]> {
    // Older imports already have a line-by-line JSON cache. Re-extract JSON
    // from the retained original so the Agent receives the structured
    // header/body split without requiring users to re-import the source.
    const original = this.originalFilePath(source.id);
    if (original && path.extname(original).toLowerCase() === '.json' && source.format === 'text') {
      return extractKnowledgeRefinerySource(original, 'text');
    }
    return readJsonl<SourceChunk>(path.join(this.sourceDirectory(source.id), 'extracted.jsonl'));
  }

  private conversationSource(sessionId: string, branchId: string): KnowledgeSource {
    const chunks = this.conversationChunks(sessionId, branchId);
    const text = chunks.map((chunk) => `${chunk.anchor.label}\n${chunk.text}`).join('\n');
    const now = new Date().toISOString();
    return {
      id: `conversation-${sessionId}-${branchId}`,
      kind: 'conversation',
      name: `Conversation ${branchId}`,
      fingerprint: hashText(text),
      createdAt: now,
      updatedAt: now,
      sessionId,
      branchId,
      messageIds: chunks.map((chunk) => chunk.anchor.messageId).filter((value): value is string => Boolean(value)),
      sourceAvailable: chunks.length > 0,
      diagnostics: chunks.length ? [] : ['No eligible messages are available in this conversation.'],
    };
  }

  private conversationChunks(sessionId: string, branchId: string, messageIds?: readonly string[]): SourceChunk[] {
    const included = messageIds ? new Set(messageIds) : null;
    const history = sessionService.getAgentHistory(sessionId);
    const messages = history.getMessages(branchId)
      .filter((message) => !message.refineryInvocation)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .filter((message) => !included || included.has(message.id))
      .filter((message) => Boolean(message.content.trim()));
    const messageChunks = messages.map((message) => ({
      anchor: { kind: 'message' as const, label: `${message.role} · ${message.timestamp}`, messageId: message.id, excerpt: message.content.slice(0, 500) },
      text: `${message.role.toUpperCase()}: ${message.content}\n${activitySummary(message)}`.trim(),
    }));
    const subagentChunks = history.getSubagentRuns(branchId)
      .filter((run) => !included || Boolean(run.messageId && included.has(run.messageId)))
      .filter((run) => Boolean(run.output?.trim()))
      .map((run) => ({
        anchor: { kind: 'message' as const, label: `Sub-agent · ${run.description ?? run.taskId}`, messageId: run.messageId, excerpt: run.output?.slice(0, 500) },
        text: `SUB-AGENT FINAL SUMMARY: ${run.output}`,
      }));
    return [...messageChunks, ...subagentChunks];
  }

  private async existingLibrary(sessionId: string): Promise<RefineryAnalysisRequest['existing']> {
    const restrictions = sessionService.getRestrictions(sessionId);
    const restrictionItems = [
      ...restrictionItemsFromDocument(restrictions.global.document.rules, 'global', restrictions.global.fingerprint),
      ...restrictionItemsFromDocument(restrictions.project.document.rules, 'project', restrictions.project.fingerprint),
    ];
    const skillsResult = await claudeCapabilitiesService.listSkills(sessionId);
    const skills = [] as RefineryAnalysisRequest['existing']['skills'];
    for (const descriptor of skillsResult.items.filter((item) => item.scope !== 'core' && item.enabled).slice(0, 80)) {
      try {
        const document = await claudeCapabilitiesService.readSkill({ sessionId, scope: descriptor.scope, name: descriptor.name, enabled: descriptor.enabled });
        skills.push({ name: descriptor.name, scope: descriptor.scope === 'project' ? 'project' : 'global', description: descriptor.description, metadata: descriptor.metadata ?? {}, fingerprint: hashText(document.content) });
      } catch { /* Ignore an externally deleted skill while building the comparison index. */ }
    }
    return {
      restrictions: restrictionItems,
      skills,
      workflows: workflowService.list().map((workflow) => ({ id: workflow.id, name: workflow.name, description: workflow.description, fingerprint: workflow.fingerprint })),
    };
  }

  private finalizeCandidate(sessionId: string, candidate: RefineryCandidate, existing: RefineryAnalysisRequest['existing']): RefineryCandidate {
    const next = { ...candidate, dedupe: { ...candidate.dedupe } };
    const exact = findExactDuplicate(next, existing);
    if (exact) {
      next.dedupe = exact;
      if (exact.action === 'skip') next.decision = 'rejected';
    }
    const diagnostic = globalScopeDiagnostic(sessionId, next);
    if (diagnostic) next.diagnostic = diagnostic;
    return next;
  }

  private jobsRoot(sessionId: string) {
    return path.join(sessionService.getSessionPath(sessionId), '.hexestra', 'knowledge-refinery', 'jobs');
  }

  private jobDirectory(sessionId: string, jobId: string) {
    assertId(jobId, 'job');
    const root = path.resolve(this.jobsRoot(sessionId));
    const target = path.resolve(root, jobId);
    if (path.dirname(target) !== root) throw new Error('Knowledge refinery path escaped the project');
    return target;
  }

  private sourceDirectory(sourceId: string) {
    assertId(sourceId, 'source');
    const root = path.resolve(this.sourceRoot);
    const target = path.resolve(root, sourceId);
    if (path.dirname(target) !== root) throw new Error('Knowledge source path escaped the library');
    return target;
  }

  private originalFilePath(sourceId: string) {
    const directory = this.sourceDirectory(sourceId);
    if (!fs.existsSync(directory)) return null;
    const original = fs.readdirSync(directory, { withFileTypes: true })
      .find((entry) => entry.isFile() && /^original\.[a-z0-9]{1,12}$/i.test(entry.name));
    return original ? path.join(directory, original.name) : null;
  }

  private candidatePath(sessionId: string, jobId: string, candidateId: string) {
    assertId(candidateId, 'candidate');
    const root = path.resolve(this.jobDirectory(sessionId, jobId), 'candidates');
    const target = path.resolve(root, `${candidateId}.json`);
    if (path.dirname(target) !== root) throw new Error('Candidate path escaped the refinery job');
    return target;
  }

  private debugPath(sessionId: string, jobId: string) {
    return path.join(this.jobDirectory(sessionId, jobId), 'debug.jsonl');
  }

  private readStoredJob(sessionId: string, jobId: string): StoredJob | null {
    const raw = readJsonIfExists(path.join(this.jobDirectory(sessionId, jobId), 'job.json'));
    const job = parseJob(raw, sessionId);
    if (!job || job.source.kind !== 'document') return job;
    const source = this.readSource(job.source.id);
    job.source = source ?? {
      ...job.source,
      sourceAvailable: false,
      diagnostics: [...job.source.diagnostics, 'Retained source was deleted; this job can still be reviewed but cannot be retried.'],
    };
    return job;
  }

  private requireJob(sessionId: string, jobId: string): StoredJob {
    const job = this.readStoredJob(sessionId, jobId);
    if (!job) throw new Error('Knowledge refinery job not found');
    return job;
  }

  private writeJob(job: StoredJob) {
    if (this.deleting.has(queueKey(job.sessionId, job.id))) return;
    fs.mkdirSync(this.jobDirectory(job.sessionId, job.id), { recursive: true });
    writeJsonAtomic(path.join(this.jobDirectory(job.sessionId, job.id), 'job.json'), job);
    this.emitChanged(job.sessionId, job.id);
  }

  private candidateIds(job: StoredJob) {
    const directory = path.join(this.jobDirectory(job.sessionId, job.id), 'candidates');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .sort();
  }

  private writeCandidate(sessionId: string, jobId: string, candidate: RefineryCandidate) {
    if (this.deleting.has(queueKey(sessionId, jobId))) return;
    writeJsonAtomic(this.candidatePath(sessionId, jobId, candidate.id), candidate);
  }

  private refreshJobCounts(job: StoredJob) {
    const candidates = this.candidateIds(job).map((id) => this.readCandidate(job.sessionId, job.id, id)).filter((item): item is RefineryCandidate => Boolean(item));
    const counts = emptyCounts();
    candidates.forEach((candidate) => {
      counts[candidate.kind] += 1;
      if (candidate.decision === 'pending' || candidate.decision === 'accepted') counts.pending += 1;
      if (candidate.decision === 'applied') counts.applied += 1;
      if (candidate.decision === 'failed') counts.failed += 1;
    });
    const status: RefineryJobStatus = candidates.length > 0 && counts.applied > 0 && counts.pending > 0
      ? 'partially_applied'
      : candidates.length > 0 && counts.applied === candidates.length
        ? 'applied'
        : job.status;
    this.writeJob({ ...job, status, candidateCounts: counts, updatedAt: new Date().toISOString() });
  }

  private appendReceipt(sessionId: string, jobId: string, value: Record<string, unknown>) {
    const file = path.join(this.jobDirectory(sessionId, jobId), 'receipts.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
  }

  private appendDebug(sessionId: string, jobId: string, entry: RefineryDebugEntry) {
    if (this.deleting.has(queueKey(sessionId, jobId))) return;
    const normalized = normalizeDebugEntry(entry)[0];
    if (!normalized) return;
    const file = this.debugPath(sessionId, jobId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(normalized)}\n`, 'utf8');
    this.emitChanged(sessionId, jobId);
  }

  private emitChanged(sessionId: string, jobId?: string) {
    const payload = { sessionId, ...(jobId ? { jobId } : {}) };
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.webContents.send('refinery:changed', payload);
    });
  }
}

function documentDialogOptions() {
  return {
    title: 'Import knowledge sources',
    buttonLabel: 'Import and refine',
    properties: ['openFile', 'multiSelections'] as Electron.OpenDialogOptions['properties'],
    filters: [
      { name: 'Supported documents', extensions: ['md', 'mdx', 'txt', 'pdf', 'docx', 'csv', 'json', 'yaml', 'yml', 'xml', 'log', 'js', 'ts', 'tsx', 'py', 'sh', 'ps1', 'sql'] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
}

export function formatKnowledgeRefinerySource(filePath: string): RefineryDocumentFormat | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.docx') return 'docx';
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  return null;
}

export async function extractKnowledgeRefinerySource(filePath: string, format: RefineryDocumentFormat): Promise<SourceChunk[]> {
  if (format === 'pdf') return extractPdf(filePath);
  if (format === 'docx') return extractDocx(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_EXTRACTED_BYTES || text.includes('\0')) throw new Error('Text source is binary or exceeds the extracted-text limit');
  const importedSkill = path.extname(filePath).toLowerCase() === '.json' ? parseImportedSkillExport(text) : null;
  if (importedSkill) return extractImportedSkillExport(importedSkill);
  return text.split(/\r?\n/).map((line, index): SourceChunk => ({ anchor: { kind: 'line', label: `Line ${index + 1}`, excerpt: line.slice(0, 500) }, text: line })).filter((chunk) => Boolean(chunk.text.trim()));
}

interface ImportedSkillExport {
  name: string;
  description: string;
  content: string;
  metadata: Record<string, string>;
}

function parseImportedSkillExport(text: string): ImportedSkillExport | null {
  try {
    const value = JSON.parse(text);
    if (!isRecord(value) || typeof value.name !== 'string' || typeof value.description !== 'string' || typeof value.content !== 'string') return null;
    const name = value.name.trim();
    const description = value.description.trim();
    const content = value.content.trim();
    if (!name || !description || !content) return null;
    const metadata = isRecord(value.metadata)
      ? Object.fromEntries(Object.entries(value.metadata).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
    return { name, description, content, metadata };
  } catch {
    return null;
  }
}

function extractImportedSkillExport(skill: ImportedSkillExport): SourceChunk[] {
  const body = stripSkillFrontmatter(skill.content);
  const metadata = Object.keys(skill.metadata).length ? JSON.stringify(skill.metadata) : '{}';
  const context = [
    '[Imported Hexestra Skill metadata]',
    `Name: ${skill.name}`,
    `Description: ${skill.description}`,
    `Metadata: ${metadata}`,
    '[Skill body]',
  ].join('\n');
  const bodyLines = body.split(/\r?\n/).filter((line) => Boolean(line.trim()));
  return [
    { anchor: { kind: 'line', label: 'Skill metadata', excerpt: `${skill.name} · ${skill.description}`.slice(0, 500) }, text: context },
    ...bodyLines.map((line, index): SourceChunk => ({ anchor: { kind: 'line', label: `Skill body line ${index + 1}`, excerpt: line.slice(0, 500) }, text: line })),
  ];
}

function stripSkillFrontmatter(content: string) {
  return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/u, '').trim();
}

async function extractPdf(filePath: string): Promise<SourceChunk[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const task = pdfjs.getDocument({ data, disableWorker: true, useWorkerFetch: false } as never);
  const document = await task.promise;
  const chunks: SourceChunk[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim();
    if (text) chunks.push({ anchor: { kind: 'page', label: `Page ${pageNumber}`, excerpt: text.slice(0, 500) }, text });
  }
  await document.destroy();
  if (Buffer.byteLength(chunks.map((chunk) => chunk.text).join('\n'), 'utf8') > MAX_EXTRACTED_BYTES) throw new Error('Extracted PDF text exceeds the 8 MiB limit');
  return chunks;
}

async function extractDocx(filePath: string): Promise<SourceChunk[]> {
  const result = await mammoth.extractRawText({ path: filePath });
  const paragraphs = result.value.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  if (Buffer.byteLength(result.value, 'utf8') > MAX_EXTRACTED_BYTES) throw new Error('Extracted DOCX text exceeds the 8 MiB limit');
  return paragraphs.map((text, index) => ({ anchor: { kind: 'paragraph', label: `Paragraph ${index + 1}`, excerpt: text.slice(0, 500) }, text }));
}

function chunkText(chunks: SourceChunk[], maximum = 24_000): SourceChunk[] {
  const output: SourceChunk[] = [];
  let current: SourceChunk | null = null;
  for (const chunk of chunks) {
    if (!current || Buffer.byteLength(`${current.text}\n${chunk.text}`, 'utf8') > maximum) {
      if (current) output.push(current);
      current = { anchor: chunk.anchor, text: chunk.text };
    } else {
      current = { anchor: current.anchor, text: `${current.text}\n${chunk.text}` };
    }
  }
  if (current) output.push(current);
  return output;
}

function activitySummary(message: PersistedChatMessage) {
  const parts = (message.activities ?? []).map((activity) => {
    if (activity.kind !== 'tool') return '';
    return [activity.toolName ?? activity.label ?? 'Tool', activity.status, activity.outputSummary ?? activity.summary ?? ''].filter(Boolean).join(' · ');
  }).filter(Boolean);
  return parts.length ? `ACTIVITY SUMMARY:\n${parts.join('\n')}` : '';
}

function restrictionItemsFromDocument(rules: RestrictionRule[], scope: 'global' | 'project', fingerprint: string) {
  return rules.map((rule) => ({ id: rule.id, scope, text: rule.text, selector: rule.selector, fingerprint }));
}

function findExactDuplicate(candidate: RefineryCandidate, existing: RefineryAnalysisRequest['existing']) {
  if (candidate.kind === 'restriction') {
    const payload = candidate.payload as Extract<RefineryCandidatePayload, { text: string; selector: unknown }>;
    const match = existing.restrictions.find((item) => normalizeText(item.text) === normalizeText(payload.text) && JSON.stringify(item.selector) === JSON.stringify(payload.selector));
    return match ? { action: 'skip' as const, targetId: match.id, expectedFingerprint: match.fingerprint, reason: '已有完全相同的限制规则。' } : null;
  }
  if (candidate.kind === 'skill') {
    const payload = candidate.payload as Extract<RefineryCandidatePayload, { name: string }>;
    const match = existing.skills.find((item) => item.name === payload.name && item.scope === candidate.suggestedScope);
    return match ? { action: 'update' as const, targetId: match.name, expectedFingerprint: match.fingerprint, reason: '同名 Skill 已存在，需要确认更新。' } : null;
  }
  const payload = candidate.payload as Extract<RefineryCandidatePayload, { id: string }>;
  const match = existing.workflows.find((item) => item.id === payload.id);
  return match ? { action: 'update' as const, targetId: match.id, expectedFingerprint: match.fingerprint, reason: '同 ID 工作流已存在，需要确认更新。' } : null;
}

function globalScopeDiagnostic(sessionId: string, candidate: RefineryCandidate) {
  if (candidate.suggestedScope !== 'global') return undefined;
  const text = candidateText(candidate);
  const targets = sessionService.listTargets(sessionId).flatMap((target) => [target.ip, target.hostname, ...target.domains]).filter((value): value is string => Boolean(value && value.length >= 3));
  const projectPath = sessionService.getSessionPath(sessionId);
  const matched = [...new Set([...targets, projectPath].filter((value) => text.toLowerCase().includes(value.toLowerCase())))];
  const genericSensitiveValue = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[a-z]:\\|\/)[^\s"']+/i)?.[0];
  if (!matched.length && !genericSensitiveValue) return undefined;
  const value = matched[0] ?? genericSensitiveValue!;
  return candidate.kind === 'workflow'
    ? `Workflow contains project-specific value: ${value}. Generalize it before applying.`
    : `Global candidate contains project-specific value: ${value}. Change it to project scope or generalize it.`;
}

function candidateText(candidate: RefineryCandidate) {
  const payload = candidate.payload as unknown as Record<string, unknown>;
  return [candidate.title, candidate.rationale, ...Object.values(payload).filter((value): value is string => typeof value === 'string')].join('\n');
}

function validateCandidatePayload(kind: RefineryOutputKind, payload: RefineryCandidatePayload) {
  if (!payload || typeof payload !== 'object') throw new Error('Candidate payload is invalid');
  if (kind === 'restriction' && 'text' in payload && typeof payload.text === 'string' && payload.text.trim()) return payload;
  if (kind === 'skill' && 'content' in payload && typeof payload.content === 'string' && typeof payload.name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(payload.name) && typeof payload.description === 'string' && isRecord(payload.metadata) && payload.content.split(/\r?\n/).length <= 500) return payload;
  if (kind === 'workflow' && 'body' in payload && typeof payload.body === 'string' && payload.body.trim() && typeof payload.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(payload.id)) return payload;
  throw new Error('Candidate payload does not match its type');
}

function renderRefinerySkillMarkdown(payload: Extract<RefineryCandidatePayload, { content: string; name: string }>) {
  const body = payload.content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/u, '').trim();
  const metadata = Object.entries(payload.metadata)
    .filter(([key, value]) => key.startsWith('hexestra-') && typeof value === 'string')
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join('\n');
  return [
    '---',
    `name: ${JSON.stringify(payload.name)}`,
    `description: ${JSON.stringify(payload.description)}`,
    ...(metadata ? ['metadata:', metadata] : []),
    '---',
    '',
    body,
    '',
  ].join('\n');
}

function parseKnowledgeSource(value: unknown): KnowledgeSource | null {
  if (!isRecord(value) || value.kind !== 'document' || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.fingerprint !== 'string') return null;
  const format = value.format === 'text' || value.format === 'markdown' || value.format === 'code' || value.format === 'pdf' || value.format === 'docx' ? value.format : undefined;
  return {
    id: value.id,
    kind: 'document',
    name: value.name,
    fingerprint: value.fingerprint,
    ...(format ? { format } : {}),
    ...(typeof value.size === 'number' ? { size: value.size } : {}),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    sourceAvailable: value.sourceAvailable !== false,
    diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics.filter((item): item is string => typeof item === 'string') : [],
  };
}

function parseJob(value: unknown, sessionId: string): StoredJob | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.sessionId !== 'string' || value.sessionId !== sessionId || !isRecord(value.source)) return null;
  const source = value.source.kind === 'document' ? parseKnowledgeSource(value.source) : parseConversationSource(value.source);
  if (!source) return null;
  const status = isJobStatus(value.status) ? value.status : 'failed';
  const requestedOutputs = Array.isArray(value.requestedOutputs) ? value.requestedOutputs.filter(isOutputKind) : [];
  return {
    id: value.id,
    sessionId,
    source,
    requestedOutputs: requestedOutputs.length ? requestedOutputs : ['restriction', 'skill', 'workflow'],
    status,
    progress: normalizeProgress(value.progress),
    modelSnapshot: typeof value.modelSnapshot === 'string' ? value.modelSnapshot : 'Current Agent',
    candidateCounts: normalizeCounts(value.candidateCounts),
    diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics.filter((item): item is string => typeof item === 'string').slice(0, 50) : [],
    ignoredSummary: Array.isArray(value.ignoredSummary) ? value.ignoredSummary.filter((item): item is string => typeof item === 'string').slice(0, 20) : [],
    attempt: typeof value.attempt === 'number' ? Math.max(1, Math.floor(value.attempt)) : 1,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
  };
}

function parseConversationSource(value: Record<string, unknown>): KnowledgeSource | null {
  if (value.kind !== 'conversation' || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.fingerprint !== 'string' || typeof value.sessionId !== 'string' || typeof value.branchId !== 'string') return null;
  return {
    id: value.id, kind: 'conversation', name: value.name, fingerprint: value.fingerprint,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    sessionId: value.sessionId, branchId: value.branchId,
    messageIds: Array.isArray(value.messageIds) ? value.messageIds.filter((item): item is string => typeof item === 'string') : [],
    sourceAvailable: value.sourceAvailable !== false,
    diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics.filter((item): item is string => typeof item === 'string') : [],
  };
}

function parseCandidate(value: unknown): RefineryCandidate | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isOutputKind(value.kind) || typeof value.title !== 'string' || !isRecord(value.payload)) return null;
  const payload = value.payload as unknown as RefineryCandidatePayload;
  const decision = value.decision === 'accepted' || value.decision === 'rejected' || value.decision === 'applied' || value.decision === 'failed' ? value.decision : 'pending';
  return {
    id: value.id,
    kind: value.kind,
    title: value.title.slice(0, 160),
    confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    rationale: typeof value.rationale === 'string' ? value.rationale.slice(0, 1_000) : '',
    anchors: Array.isArray(value.anchors) ? value.anchors.filter(isAnchor).slice(0, 20) : [],
    payload,
    ...(value.suggestedScope === 'global' || value.suggestedScope === 'project' ? { suggestedScope: value.suggestedScope } : {}),
    dedupe: isRecord(value.dedupe) ? {
      action: value.dedupe.action === 'update' || value.dedupe.action === 'merge' || value.dedupe.action === 'skip' ? value.dedupe.action : 'create',
      ...(typeof value.dedupe.targetId === 'string' ? { targetId: value.dedupe.targetId } : {}),
      ...(typeof value.dedupe.expectedFingerprint === 'string' ? { expectedFingerprint: value.dedupe.expectedFingerprint } : {}),
      reason: typeof value.dedupe.reason === 'string' ? value.dedupe.reason : '',
    } : { action: 'create', reason: '' },
    decision,
    ...(typeof value.diagnostic === 'string' ? { diagnostic: value.diagnostic } : {}),
  };
}

function normalizeDebugEntry(value: unknown): RefineryDebugEntry[] {
  if (!isRecord(value) || !isAnchor(value.anchor)) return [];
  const kind = value.kind === 'stream' || value.kind === 'result' || value.kind === 'error' ? value.kind : 'status';
  const text = typeof value.text === 'string' ? value.text.slice(0, REFINERY_DEBUG_MAX_TEXT_LENGTH) : '';
  if (!text.trim()) return [];
  return [{
    at: typeof value.at === 'string' ? value.at : new Date().toISOString(),
    attempt: typeof value.attempt === 'number' ? Math.max(1, Math.floor(value.attempt)) : 1,
    chunkIndex: typeof value.chunkIndex === 'number' ? Math.max(1, Math.floor(value.chunkIndex)) : 1,
    anchor: value.anchor,
    kind,
    text,
  }];
}

function candidateSummary(candidate: RefineryCandidate): RefineryCandidateSummary {
  const { rationale: _rationale, anchors: _anchors, payload: _payload, ...summary } = candidate;
  return summary;
}

function isAnchor(value: unknown): value is SourceAnchor {
  return isRecord(value) && (value.kind === 'line' || value.kind === 'paragraph' || value.kind === 'page' || value.kind === 'message') && typeof value.label === 'string';
}

function isOutputKind(value: unknown): value is RefineryOutputKind {
  return value === 'restriction' || value === 'skill' || value === 'workflow';
}

function isJobStatus(value: unknown): value is RefineryJobStatus {
  return value === 'queued' || value === 'extracting' || value === 'analyzing' || value === 'review_required' || value === 'partially_applied' || value === 'applied' || value === 'failed' || value === 'canceled';
}

function normalizeProgress(value: unknown): RefineryJobProgress {
  if (!isRecord(value)) return { phase: 'Unknown', completed: 0, total: 0 };
  return { phase: typeof value.phase === 'string' ? value.phase.slice(0, 200) : 'Unknown', completed: typeof value.completed === 'number' ? Math.max(0, Math.floor(value.completed)) : 0, total: typeof value.total === 'number' ? Math.max(0, Math.floor(value.total)) : 0 };
}

function emptyCounts(): Record<RefineryOutputKind | 'pending' | 'applied' | 'failed', number> {
  return { restriction: 0, skill: 0, workflow: 0, pending: 0, applied: 0, failed: 0 };
}

function normalizeCounts(value: unknown) {
  const empty = emptyCounts();
  if (!isRecord(value)) return empty;
  (Object.keys(empty) as Array<keyof typeof empty>).forEach((key) => { if (typeof value[key] === 'number') empty[key] = Math.max(0, Math.floor(value[key] as number)); });
  return empty;
}

function updateJob(job: StoredJob, status: RefineryJobStatus, progress: RefineryJobProgress, diagnostic?: string): StoredJob {
  return { ...job, status, progress, diagnostics: diagnostic ? [diagnostic] : job.diagnostics, updatedAt: new Date().toISOString() };
}

function pageFromEnd<T, R>(items: T[], beforeCursor: string | null | undefined, limit: number, map: (item: T) => R): RefineryPage<R> {
  const end = beforeCursor && /^\d+$/.test(beforeCursor) ? Math.max(0, Math.min(items.length, Number(beforeCursor))) : items.length;
  const start = Math.max(0, end - limit);
  return { items: items.slice(start, end).map(map), beforeCursor: start > 0 ? String(start) : null, hasEarlier: start > 0, total: items.length };
}

function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; }
function readJsonIfExists(file: string): unknown { return fs.existsSync(file) ? readJson(file) : null; }
function writeJsonAtomic(file: string, value: unknown) { writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonlAtomic(file: string, values: unknown[]) { writeTextAtomic(file, values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : '')); }
function writeTextAtomic(file: string, text: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(temporary, text, 'utf8'); fs.renameSync(temporary, file); }
function readJsonl<T>(file: string): T[] { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line) => { if (!line.trim()) return []; try { return [JSON.parse(line) as T]; } catch { return []; } }); }
function hashFile(file: string) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function hashText(value: string) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function copyAtomic(source: string, target: string) { const temporary = `${target}.tmp-${process.pid}-${Date.now()}`; fs.copyFileSync(source, temporary); fs.renameSync(temporary, target); }
function safeBasename(value: string) { const name = path.basename(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim(); return name || 'source'; }
function normalizeText(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function assertId(value: string, label: string) { if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(value)) throw new Error(`Invalid ${label} identifier`); }
function queueKey(sessionId: string, jobId: string) { return `${sessionId}:${jobId}`; }
function splitQueueKey(value: string): [string, string] { const separator = value.indexOf(':'); return [value.slice(0, separator), value.slice(separator + 1)]; }

export function refineryInvocation(job: RefineryJob): RefineryInvocation {
  return { jobId: job.id, sourceKind: job.source.kind, sourceName: job.source.name };
}
