import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { installHexestraSkills, resolvePentestSkillSource } from './pentest-skill';
import {
  normalizeOperationalAssetStatus,
  normalizeStoredAsset,
  type AssetRecord,
} from './asset-record';
import {
  AssetGraphRepository,
  type GraphLayoutState,
  type GraphRelation,
  type RelationType,
  type AssetChangeRecord,
  type FindingRecord,
  type VulnerabilityRecord,
  type EvidenceRecord,
  type ReportRecord,
} from './asset-graph.repository';
import {
  createDefaultProjectState,
  mergeProjectState,
  normalizeProjectState,
  type ProjectState,
  type ProjectStatePatch,
} from './project-state';
import {
  normalizePttMarkdown,
  parsePttMarkdown,
  updatePttTaskStatus,
  upsertPttTask,
  type PentestTask,
  type PttTaskInput,
  type TaskStatus,
} from './ptt-markdown';
import { deriveScopedAssetStatus, isValueInScope } from './scope-policy';
import { isManagedRecordKind, RECORDS_IPC, type RecordExportResult } from '../contracts/records';
import { managedRecordFilename, managedRecordMarkdown } from './record-export';
import type { SessionDataChangedEvent } from '../contracts/session';
import {
  createProjectMetadata,
  normalizeProjectPath,
  projectDataPath,
  ProjectRegistry,
  readProjectMetadata,
  writeProjectMetadata,
  type ProjectMetadata,
} from './project-registry';

interface SessionMeta extends ProjectMetadata {
  basePath: string;
}

interface Target {
  id: string;
  ip: string;
  hostname?: string;
  domains: string[];
  os?: string;
  status: string;
  tags: string[];
  ports: Array<{
    id: string;
    port: number;
    protocol: string;
    state: string;
    service?: string;
    version?: string;
    firstSeen: string;
    lastSeen: string;
  }>; 
  services: Array<{
    port: number;
    protocol: string;
    name: string;
    version?: string;
    product?: string;
    extra?: string;
  }>;
  vulnCount: number;
  aiSummary?: string;
  firstSeen: string;
  lastUpdated: string;
}

type GraphEdgeType = RelationType;
type GraphEdge = GraphRelation;

interface SessionNetMap {
  version: 3;
  assets: AssetRecord[];
  edges: GraphEdge[];
}

interface SessionFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

class SessionService {
  private readonly registry: ProjectRegistry;
  private readonly projectPaths = new Map<string, string>();
  private repositories = new Map<string, AssetGraphRepository>();
  private taskWatchers = new Map<string, fs.FSWatcher>();
  private taskWatchTimers = new Map<string, NodeJS.Timeout>();
  private fileWatchers = new Map<string, fs.FSWatcher>();
  private fileWatchTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    const userDataPath = process.env.HEXESTRA_USER_DATA
      || path.join(
        process.env.APPDATA || path.join(process.env.HOME || '~', '.config'),
        'hexestra',
      );
    this.registry = new ProjectRegistry(path.join(userDataPath, 'recent-projects.json'));
    this.registerHandlers();
  }

  private registerHandlers() {
    ipcMain.handle('project:open-folder', async () => {
      return this.pickAndOpenProject('open');
    });

    ipcMain.handle('project:create-folder', async () => {
      return this.pickAndOpenProject('create');
    });

    ipcMain.handle('project:list-recent', async () => {
      return this.listSessions();
    });

    ipcMain.handle('project:open-recent', async (_event, id: string) => {
      return this.loadSession(id);
    });

    ipcMain.handle('project:remove-recent', async (_event, id: string) => {
      return this.deleteSession(id);
    });

    ipcMain.handle('project:state', async (_event, sessionId: string) => {
      return this.getProjectState(sessionId);
    });

    ipcMain.handle('project:update', async (_event, sessionId: string, patch: ProjectStatePatch) => {
      return this.updateProjectState(sessionId, patch);
    });

    // Target operations
    ipcMain.handle('targets:list', async (_event, sessionId: string) => {
      return this.listTargets(sessionId);
    });

    ipcMain.handle('targets:get', async (_event, sessionId: string, targetId: string) => {
      return this.getTarget(sessionId, targetId);
    });

    ipcMain.handle('targets:add', async (_event, sessionId: string, target: Target) => {
      return this.addTarget(sessionId, target);
    });

    ipcMain.handle('targets:update', async (_event, sessionId: string, targetId: string, changes: Partial<Target>) => {
      return this.updateTarget(sessionId, targetId, changes);
    });

    ipcMain.handle('netmap:get', async (_event, sessionId: string) => {
      return this.getNetMap(sessionId);
    });

    ipcMain.handle('netmap:layout:get', async (_event, sessionId: string) => {
      return this.getNetMapLayout(sessionId);
    });

    ipcMain.handle('netmap:layout:update', async (
      _event,
      sessionId: string,
      state: Partial<GraphLayoutState>,
    ) => this.updateNetMapLayout(sessionId, state));

    ipcMain.handle('tasks:list', async (_event, sessionId: string) => {
      return this.listTasks(sessionId);
    });

    ipcMain.handle('tasks:update', async (_event, sessionId: string, taskId: string, status: TaskStatus) => {
      return this.updateTaskStatus(sessionId, taskId, status);
    });

    ipcMain.handle('tasks:upsert', async (_event, sessionId: string, task: PttTaskInput) => {
      return this.upsertTask(sessionId, task);
    });

    ipcMain.handle('asm:scan-runs', async (_event, sessionId: string) => {
      return this.listScanRuns(sessionId);
    });

    ipcMain.handle('asm:changes', async (_event, sessionId: string) => {
      return this.listAssetChanges(sessionId);
    });

    ipcMain.handle('findings:list', async (_event, sessionId: string) => {
      return this.listFindings(sessionId);
    });

    ipcMain.handle('findings:upsert', async (
      event,
      sessionId: string,
      finding: Partial<FindingRecord> & Pick<FindingRecord, 'title'>,
    ) => {
      const result = this.upsertFinding(sessionId, finding);
      event.sender.send('session:data-changed', { sessionId, findings: true });
      return result;
    });

    ipcMain.handle('vulnerabilities:list', async (_event, sessionId: string) => {
      return this.listVulnerabilities(sessionId);
    });

    ipcMain.handle('vulnerabilities:upsert', async (
      event,
      sessionId: string,
      vulnerability: Partial<VulnerabilityRecord> & Pick<VulnerabilityRecord, 'assetId' | 'title'>,
    ) => {
      const result = this.upsertVulnerability(sessionId, vulnerability);
      event.sender.send('session:data-changed', {
        sessionId, targets: true, netmap: true, vulnerabilities: true,
      });
      return result;
    });

    ipcMain.handle('evidence:list', async (_event, sessionId: string) => {
      return this.listEvidence(sessionId);
    });

    ipcMain.handle('evidence:upsert', async (
      event,
      sessionId: string,
      evidence: Partial<EvidenceRecord> & Pick<EvidenceRecord, 'assetId' | 'title' | 'content'>,
    ) => {
      const result = this.upsertEvidence(sessionId, evidence);
      event.sender.send('session:data-changed', { sessionId, evidence: true, findings: true, vulnerabilities: true });
      return result;
    });

    ipcMain.handle('reports:list', async (_event, sessionId: string) => {
      return this.listReports(sessionId);
    });

    ipcMain.handle('reports:upsert', async (
      event,
      sessionId: string,
      report: Partial<ReportRecord> & Pick<ReportRecord, 'title' | 'content'>,
    ) => {
      const result = this.upsertReport(sessionId, report);
      event.sender.send('session:data-changed', { sessionId, reports: true });
      return result;
    });

    ipcMain.handle(RECORDS_IPC.DELETE, async (event, sessionId: string, kind: unknown, recordId: string) => {
      if (!isManagedRecordKind(kind)) throw new Error('Unsupported managed record kind');
      const deleted = this.deleteManagedRecord(sessionId, kind, recordId);
      if (deleted) {
        event.sender.send('session:data-changed', {
          sessionId,
          findings: true,
          vulnerabilities: true,
          evidence: true,
          reports: true,
          targets: kind === 'vulnerability',
          netmap: kind === 'vulnerability',
        });
      }
      return deleted;
    });

    ipcMain.handle(RECORDS_IPC.EXPORT, async (event, sessionId: string, kind: unknown, recordId: string): Promise<RecordExportResult> => {
      if (!isManagedRecordKind(kind)) throw new Error('Unsupported managed record kind');
      const record = this.getRepository(sessionId).getManagedRecord(kind, recordId);
      if (!record) throw new Error('Managed record not found');
      const options = {
        title: 'Export managed record',
        defaultPath: managedRecordFilename(kind, record.title),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      };
      const owner = BrowserWindow.fromWebContents(event.sender);
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { canceled: true };
      fs.writeFileSync(result.filePath, managedRecordMarkdown(kind, record), 'utf8');
      return { canceled: false, filePath: result.filePath };
    });

    ipcMain.handle('scope:update', async (event, sessionId: string, scope: SessionMeta['scope']) => {
      const result = await this.updateScope(sessionId, scope);
      event.sender.send('session:data-changed', { sessionId, targets: true, netmap: true, scope: result.scope });
      return result;
    });

    ipcMain.handle('files:list', async (_event, sessionId: string, relativePath = '') => {
      return this.listFiles(sessionId, relativePath);
    });

    ipcMain.handle('files:read', async (_event, sessionId: string, relativePath: string) => {
      return this.readFile(sessionId, relativePath);
    });

    ipcMain.handle('files:write', async (_event, sessionId: string, relativePath: string, content: string) => {
      return this.writeFile(sessionId, relativePath, content);
    });
  }

  // ============================================================
  // Session CRUD
  // ============================================================

  private async pickAndOpenProject(mode: 'open' | 'create') {
    const result = await dialog.showOpenDialog({
      title: mode === 'create' ? 'Create or select a Hexestra project folder' : 'Open Hexestra project',
      buttonLabel: mode === 'create' ? 'Use Project Folder' : 'Open Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.openProjectPath(result.filePaths[0]);
  }

  private assertProjectIdentity(projectId: string, projectPath: string) {
    const cachedConflict = [...this.projectPaths.entries()].find(
      ([candidateId, candidatePath]) =>
        candidateId === projectId && path.resolve(candidatePath) !== path.resolve(projectPath),
    );
    if (cachedConflict) throw new Error(`Project ${projectId} is already open at another path`);
  }

  async openProjectPath(
    requestedPath: string,
    options: { name?: string; scope?: string } = {},
  ): Promise<SessionMeta> {
    const sessionPath = normalizeProjectPath(requestedPath);
    let metadata = readProjectMetadata(sessionPath);
    const isNew = !metadata;
    if (!metadata) {
      metadata = createProjectMetadata(sessionPath, options.scope);
      if (options.name?.trim()) metadata.name = options.name.trim().slice(0, 200);
      writeProjectMetadata(sessionPath, metadata);
    }

    this.assertProjectIdentity(metadata.id, sessionPath);
    this.projectPaths.set(metadata.id, sessionPath);

    // Create only missing standard artifacts; reopening never overwrites user work.
    fs.mkdirSync(path.join(sessionPath, 'targets'), { recursive: true });
    fs.mkdirSync(projectDataPath(sessionPath), { recursive: true });

    let session = { ...metadata, basePath: sessionPath };
    if (!fs.existsSync(path.join(sessionPath, 'ptt.md'))) this.writePttTemplate(sessionPath, session);
    if (!fs.existsSync(path.join(sessionPath, 'targets.md'))) this.writeTargetsManifest(sessionPath, []);
    this.getRepository(metadata.id);
    session = {
      ...this.reconcileProjectCounts(metadata.id, metadata),
      basePath: sessionPath,
    };
    if (!fs.existsSync(path.join(projectDataPath(sessionPath), 'project-state.json'))) {
      this.writeProjectState(sessionPath, createDefaultProjectState());
    }
    if (isNew) this.ensureHexestraSkills(sessionPath);
    this.registry.remember(session, sessionPath);
    console.log(`[Project] ${isNew ? 'Initialized' : 'Opened'}:`, metadata.id, sessionPath);
    return session;
  }

  async loadSession(id: string): Promise<SessionMeta> {
    const sessionPath = this.getSessionPath(id);
    const metadata = readProjectMetadata(sessionPath);
    if (!metadata || metadata.id !== id) throw new Error(`Project ${id} not found`);
    const reconciled = this.reconcileProjectCounts(id, metadata);
    this.registry.remember(reconciled, sessionPath);
    return { ...reconciled, basePath: sessionPath };
  }

  async listSessions(): Promise<SessionMeta[]> {
    const projects: SessionMeta[] = [];
    for (const recent of this.registry.list()) {
      const metadata = readProjectMetadata(recent.path);
      if (metadata?.id === recent.id) {
        this.projectPaths.set(metadata.id, recent.path);
        const reconciled = this.reconcileProjectCounts(metadata.id, metadata);
        projects.push({ ...reconciled, basePath: recent.path });
      }
    }
    return projects;
  }

  async deleteSession(id: string): Promise<void> {
    this.stopTaskWatcher(id);
    this.stopFileWatcher(id);
    this.repositories.get(id)?.close();
    this.repositories.delete(id);
    this.projectPaths.delete(id);
    this.registry.remove(id);
    console.log('[Project] Removed from recent:', id);
  }

  async updateSession(id: string, updates: Partial<SessionMeta>): Promise<SessionMeta> {
    const session = await this.loadSession(id);
    if (typeof updates.name === 'string' && updates.name.trim()) {
      session.name = updates.name.trim().slice(0, 200);
    }
    if (updates.status === 'active' || updates.status === 'paused' || updates.status === 'completed') {
      session.status = updates.status;
    }
    if (updates.opsecLevel === 'stealth' || updates.opsecLevel === 'balanced' || updates.opsecLevel === 'loud') {
      session.opsecLevel = updates.opsecLevel;
    }
    if (updates.autonomyLevel === 'low' || updates.autonomyLevel === 'medium' || updates.autonomyLevel === 'high') {
      session.autonomyLevel = updates.autonomyLevel;
    }
    if (updates.scope) session.scope = updates.scope;
    session.updatedAt = new Date().toISOString();
    this.writeSessionMeta(session);
    this.registry.remember(session, session.basePath);
    return session;
  }

  getSessionPath(id: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      throw new Error('Invalid project identifier');
    }
    const cached = this.projectPaths.get(id);
    if (cached && readProjectMetadata(cached)?.id === id) return cached;
    const registered = this.registry.resolve(id);
    if (!registered) throw new Error(`Project ${id} not found`);
    this.projectPaths.set(id, registered);
    return registered;
  }

  getProjectState(sessionId: string): ProjectState {
    const sessionPath = this.getSessionPath(sessionId);
    const statePath = path.join(projectDataPath(sessionPath), 'project-state.json');
    if (!fs.existsSync(statePath)) {
      const state = createDefaultProjectState();
      if (fs.existsSync(sessionPath)) this.writeProjectState(sessionPath, state);
      return state;
    }
    try {
      return normalizeProjectState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
    } catch {
      return createDefaultProjectState();
    }
  }

  updateProjectState(sessionId: string, patch: ProjectStatePatch): ProjectState {
    const sessionPath = this.getSessionPath(sessionId);
    if (!fs.existsSync(path.join(projectDataPath(sessionPath), 'project.json'))) {
      throw new Error(`Project ${sessionId} not found`);
    }
    const state = mergeProjectState(this.getProjectState(sessionId), patch);
    this.writeProjectState(sessionPath, state);
    return state;
  }

  valueIsInScope(sessionId: string, value: string) {
    return isValueInScope(readProjectMetadata(this.getSessionPath(sessionId))?.scope, value);
  }

  async updateScope(sessionId: string, scope: SessionMeta['scope']) {
    const updated = await this.updateSession(sessionId, { scope });
    this.refreshGraphArtifacts(sessionId);
    return updated;
  }

  // ============================================================
  // Target Operations
  // ============================================================

  listTargets(sessionId: string): Target[] {
    const scope = readProjectMetadata(this.getSessionPath(sessionId))?.scope;
    return this.getRepository(sessionId).listTargets()
      .map(cleanTarget)
      .map((target) => projectTargetScope(target, scope));
  }

  getTarget(sessionId: string, targetId: string): Target | null {
    const target = this.getRepository(sessionId).getTarget(targetId);
    if (!target) return null;
    const scope = readProjectMetadata(this.getSessionPath(sessionId))?.scope;
    return projectTargetScope(cleanTarget(target), scope);
  }

  addTarget(sessionId: string, target: Target, deferArtifacts = false): Target {
    const stored = cleanTarget(this.getRepository(sessionId).upsertTarget({
      ...target,
      status: normalizeOperationalAssetStatus(target.status),
    }));
    if (!deferArtifacts) this.refreshTargetArtifacts(sessionId);
    const scope = readProjectMetadata(this.getSessionPath(sessionId))?.scope;
    return projectTargetScope(stored, scope);
  }

  updateTarget(sessionId: string, targetId: string, changes: Partial<Target>): Target {
    const stored = cleanTarget(this.getRepository(sessionId).updateTarget(targetId, {
      ...changes,
      ...(changes.status ? { status: normalizeOperationalAssetStatus(changes.status) } : {}),
    }));
    this.refreshTargetArtifacts(sessionId);
    const scope = readProjectMetadata(this.getSessionPath(sessionId))?.scope;
    return projectTargetScope(stored, scope);
  }

  listAssets(sessionId: string): AssetRecord[] {
    const scope = readProjectMetadata(this.getSessionPath(sessionId))?.scope;
    return this.getRepository(sessionId).listAssets()
      .map((asset) => projectAssetScope(asset, scope));
  }

  upsertAsset(sessionId: string, candidate: AssetRecord): AssetRecord {
    const normalized = normalizeStoredAsset(candidate);
    if (!normalized) throw new Error('Invalid asset record');
    const stored = this.getRepository(sessionId).upsertAsset(normalized);
    const scope = readProjectMetadata(this.getSessionPath(sessionId))?.scope;
    return projectAssetScope(stored, scope);
  }

  updateAsset(sessionId: string, assetId: string, changes: Partial<AssetRecord>) {
    const stored = this.getRepository(sessionId).updateAsset(assetId, {
      ...changes,
      ...(changes.status ? { status: normalizeOperationalAssetStatus(changes.status) } : {}),
    });
    const scope = readProjectMetadata(this.getSessionPath(sessionId))?.scope;
    return projectAssetScope(stored, scope);
  }

  async getNetMap(sessionId: string): Promise<SessionNetMap> {
    const repository = this.getRepository(sessionId);
    return { version: 3, assets: this.listAssets(sessionId), edges: repository.listRelations() };
  }

  upsertNetMapEdge(
    sessionId: string,
    sourceTargetId: string | undefined,
    targetId: string,
    type: GraphEdgeType,
    metadata: Record<string, string> = {},
  ): { edge: GraphEdge | null; created: boolean } {
    return this.getRepository(sessionId).upsertRelation(sourceTargetId, targetId, type, metadata);
  }

  withGraphTransaction<T>(sessionId: string, work: () => T): T {
    return this.getRepository(sessionId).transaction(work);
  }

  refreshGraphArtifacts(sessionId: string) {
    this.refreshTargetArtifacts(sessionId);
    this.reconcileProjectCounts(sessionId);
  }

  getNetMapLayout(sessionId: string) {
    return this.getRepository(sessionId).getLayoutState();
  }

  updateNetMapLayout(
    sessionId: string,
    state: Partial<GraphLayoutState>,
  ) {
    return this.getRepository(sessionId).updateLayoutState(state);
  }

  recordScanRun(sessionId: string, tool: string, sourceAssetId?: string) {
    return this.getRepository(sessionId).recordScanRun(tool, sourceAssetId);
  }

  listScanRuns(sessionId: string) {
    return this.getRepository(sessionId).listScanRuns();
  }

  recordAssetChange(
    sessionId: string,
    scanRunId: string,
    change: Omit<AssetChangeRecord, 'id' | 'scanRunId' | 'observedAt'>,
  ) {
    return this.getRepository(sessionId).recordAssetChange(scanRunId, change);
  }

  listAssetChanges(sessionId: string) {
    return this.getRepository(sessionId).listAssetChanges();
  }

  listFindings(sessionId: string) {
    return this.getRepository(sessionId).listFindings();
  }

  upsertFinding(
    sessionId: string,
    finding: Partial<FindingRecord> & Pick<FindingRecord, 'title'>,
  ) {
    const result = this.getRepository(sessionId).upsertFinding(finding);
    this.reconcileProjectCounts(sessionId, undefined, true);
    return result;
  }

  listVulnerabilities(sessionId: string) {
    return this.getRepository(sessionId).listVulnerabilities();
  }

  upsertVulnerability(
    sessionId: string,
    vulnerability: Partial<VulnerabilityRecord> & Pick<VulnerabilityRecord, 'assetId' | 'title'>,
  ) {
    const result = this.getRepository(sessionId).upsertVulnerability(vulnerability);
    this.reconcileProjectCounts(sessionId, undefined, true);
    return result;
  }

  listEvidence(sessionId: string) {
    return this.getRepository(sessionId).listEvidence();
  }

  upsertEvidence(
    sessionId: string,
    evidence: Partial<EvidenceRecord> & Pick<EvidenceRecord, 'assetId' | 'title' | 'content'>,
  ) {
    return this.getRepository(sessionId).upsertEvidence(evidence);
  }

  listReports(sessionId: string) {
    return this.getRepository(sessionId).listReports();
  }

  upsertReport(
    sessionId: string,
    report: Partial<ReportRecord> & Pick<ReportRecord, 'title' | 'content'>,
  ) {
    return this.getRepository(sessionId).upsertReport(report);
  }

  deleteManagedRecord(sessionId: string, kind: Parameters<AssetGraphRepository['deleteManagedRecord']>[0], recordId: string) {
    const deleted = this.getRepository(sessionId).deleteManagedRecord(kind, recordId);
    if (deleted && (kind === 'finding' || kind === 'vulnerability')) {
      this.reconcileProjectCounts(sessionId, undefined, true);
    }
    return deleted;
  }

  private reconcileProjectCounts(
    sessionId: string,
    current?: ProjectMetadata,
    touchUpdatedAt = false,
  ) {
    const metadata = current ?? readProjectMetadata(this.getSessionPath(sessionId));
    if (!metadata) throw new Error(`Project ${sessionId} not found`);
    const targetCount = this.listTargets(sessionId).length;
    const findingCount = this.listFindings(sessionId)
      .filter((item) => item.status !== 'archived').length;
    const vulnerabilityCount = this.listVulnerabilities(sessionId)
      .filter((item) => item.status !== 'resolved').length;
    if (
      targetCount !== metadata.targetCount
      || findingCount !== metadata.findingCount
      || vulnerabilityCount !== metadata.vulnerabilityCount
      || touchUpdatedAt
    ) {
      const updated = {
        ...metadata,
        targetCount,
        findingCount,
        vulnerabilityCount,
        updatedAt: new Date().toISOString(),
      };
      writeProjectMetadata(this.getSessionPath(sessionId), updated);
      return updated;
    }
    return metadata;
  }

  close() {
    for (const sessionId of this.taskWatchers.keys()) this.stopTaskWatcher(sessionId);
    for (const sessionId of this.fileWatchers.keys()) this.stopFileWatcher(sessionId);
    for (const repository of this.repositories.values()) repository.close();
    this.repositories.clear();
  }

  suspendTaskWatcher(sessionId: string) {
    this.stopTaskWatcher(sessionId);
  }

  private getRepository(sessionId: string) {
    const existing = this.repositories.get(sessionId);
    if (existing) return existing;
    const sessionPath = this.getSessionPath(sessionId);
    if (!fs.existsSync(path.join(projectDataPath(sessionPath), 'project.json'))) {
      throw new Error(`Project ${sessionId} not found`);
    }
    const repository = new AssetGraphRepository(sessionPath);
    this.repositories.set(sessionId, repository);
    return repository;
  }

  private refreshTargetArtifacts(sessionId: string) {
    const sessionPath = this.getSessionPath(sessionId);
    const targets = this.listTargets(sessionId);
    this.writeTargetsManifest(sessionPath, targets);
    for (const target of targets) this.writeTargetDocument(sessionPath, target);
    const metadata = readProjectMetadata(sessionPath);
    if (!metadata) throw new Error(`Project ${sessionId} not found`);
    const session = { ...metadata, basePath: sessionPath };
    session.targetCount = targets.length;
    session.updatedAt = new Date().toISOString();
    this.writeSessionMeta(session);
  }

  async listTasks(sessionId: string): Promise<PentestTask[]> {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    if (!fs.existsSync(pttPath)) {
      const session = await this.loadSession(sessionId);
      this.writePttTemplate(sessionPath, session);
    }
    const source = fs.readFileSync(pttPath, 'utf8');
    const normalized = normalizePttMarkdown(source);
    if (normalized.changed) this.writePtt(sessionPath, normalized.markdown);
    this.ensureTaskWatcher(sessionId);
    return normalized.tasks;
  }

  async updateTaskStatus(sessionId: string, taskId: string, status: TaskStatus) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    await this.listTasks(sessionId);
    const result = updatePttTaskStatus(fs.readFileSync(pttPath, 'utf8'), taskId, status);
    this.writePtt(sessionPath, result.markdown);
    return result.task;
  }

  async upsertTask(sessionId: string, task: PttTaskInput) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    await this.listTasks(sessionId);
    const result = upsertPttTask(fs.readFileSync(pttPath, 'utf8'), task);
    this.writePtt(sessionPath, result.markdown);
    return result.task;
  }

  listFiles(sessionId: string, relativePath = ''): SessionFileEntry[] {
    const directory = this.resolveSessionFile(sessionId, relativePath);
    this.ensureFileWatcher(sessionId);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => {
        const fullPath = path.join(directory, entry.name);
        const stat = fs.statSync(fullPath);
        const childRelative = path.relative(this.getSessionPath(sessionId), fullPath).replace(/\\/g, '/');
        return {
          name: entry.name,
          path: childRelative,
          type: entry.isDirectory() ? 'directory' as const : 'file' as const,
          size: entry.isFile() ? stat.size : 0,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((left, right) =>
        left.type === right.type
          ? left.name.localeCompare(right.name)
          : left.type === 'directory' ? -1 : 1,
      );
  }

  readFile(sessionId: string, relativePath: string) {
    const filePath = this.resolveSessionFile(sessionId, relativePath);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('Requested path is not a file');
    if (stat.size > 2 * 1024 * 1024) throw new Error('File exceeds the 2 MB editor limit');
    return {
      path: relativePath.replace(/\\/g, '/'),
      content: fs.readFileSync(filePath, 'utf8'),
      modifiedAt: stat.mtime.toISOString(),
    };
  }

  writeFile(sessionId: string, relativePath: string, content: string) {
    if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
      throw new Error('File exceeds the 2 MB editor limit');
    }
    const filePath = this.resolveSessionFile(sessionId, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return this.readFile(sessionId, relativePath);
  }

  private resolveSessionFile(sessionId: string, relativePath: string) {
    const root = this.getSessionPath(sessionId);
    const candidate = path.resolve(root, relativePath || '.');
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      throw new Error('File path escaped the active session');
    }
    return candidate;
  }

  private writePtt(sessionPath: string, markdown: string) {
    const target = path.join(sessionPath, 'ptt.md');
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, markdown, 'utf8');
    fs.renameSync(temporary, target);
  }

  private ensureTaskWatcher(sessionId: string) {
    if (this.taskWatchers.has(sessionId)) return;
    const sessionPath = this.getSessionPath(sessionId);
    const watcher = fs.watch(resolveProjectWatchPath(sessionPath), { persistent: false }, (_event, filename) => {
      if (filename?.toString().toLowerCase() !== 'ptt.md') return;
      const existing = this.taskWatchTimers.get(sessionId);
      if (existing) clearTimeout(existing);
      this.taskWatchTimers.set(sessionId, setTimeout(() => {
        this.taskWatchTimers.delete(sessionId);
        try {
          const pttPath = path.join(sessionPath, 'ptt.md');
          if (!fs.existsSync(pttPath)) return;
          const source = fs.readFileSync(pttPath, 'utf8');
          if (parsePttMarkdown(source).length === 0) return;
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send('session:data-changed', { sessionId, tasks: true });
          }
        } catch (error) {
          console.error('[PTT] Failed to refresh task tree:', error);
        }
      }, 180));
    });
    this.taskWatchers.set(sessionId, watcher);
  }

  private stopTaskWatcher(sessionId: string) {
    this.taskWatchers.get(sessionId)?.close();
    this.taskWatchers.delete(sessionId);
    const timer = this.taskWatchTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.taskWatchTimers.delete(sessionId);
  }

  private ensureFileWatcher(sessionId: string) {
    if (this.fileWatchers.has(sessionId)) return;
    const sessionPath = this.getSessionPath(sessionId);
    const watchPath = resolveProjectWatchPath(sessionPath);
    try {
      const watcher = fs.watch(
        watchPath,
        { persistent: false, recursive: true },
        (_event, filename) => {
          if (!isVisibleSessionFileChange(filename)) return;
          const existing = this.fileWatchTimers.get(sessionId);
          if (existing) clearTimeout(existing);
          this.fileWatchTimers.set(sessionId, setTimeout(() => {
            this.fileWatchTimers.delete(sessionId);
            const change = { sessionId, files: true } satisfies SessionDataChangedEvent;
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed()) window.webContents.send('session:data-changed', change);
            }
          }, 160));
        },
      );
      watcher.on('error', (error) => {
        console.error('[Files] Project watcher failed:', error);
        if (this.fileWatchers.get(sessionId) === watcher) this.stopFileWatcher(sessionId);
      });
      this.fileWatchers.set(sessionId, watcher);
    } catch (error) {
      console.error('[Files] Could not watch project directory:', error);
    }
  }

  private stopFileWatcher(sessionId: string) {
    this.fileWatchers.get(sessionId)?.close();
    this.fileWatchers.delete(sessionId);
    const timer = this.fileWatchTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.fileWatchTimers.delete(sessionId);
  }

  private writeProjectState(sessionPath: string, state: ProjectState) {
    const stateDirectory = projectDataPath(sessionPath);
    fs.mkdirSync(stateDirectory, { recursive: true });
    const target = path.join(stateDirectory, 'project-state.json');
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temporary, target);
  }

  // ============================================================
  // File I/O Helpers
  // ============================================================

  private writeSessionMeta(session: SessionMeta) {
    const { basePath: _basePath, ...metadata } = session;
    writeProjectMetadata(this.getSessionPath(session.id), metadata);
  }

  private ensureHexestraSkills(sessionPath: string) {
    const installedSkills = installHexestraSkills(sessionPath);
    if (!installedSkills) {
      console.warn('[Session] Hexestra skill resources were not installed');
    }
  }

  private writePttTemplate(sessionPath: string, session: SessionMeta) {
    const skillSource = resolvePentestSkillSource();
    if (skillSource) {
      const template = fs.readFileSync(path.join(skillSource, 'ptt-template.md'), 'utf8');
      const ptt = template
        .replaceAll('{TARGET}', session.scope?.inScope[0] ?? session.name)
        .replaceAll('{STARTED}', session.createdAt)
        .replaceAll('{UPDATED}', session.updatedAt)
        .replaceAll('{OPSEC_LEVEL}', session.opsecLevel)
        .replaceAll('{AUTONOMY_LEVEL}', session.autonomyLevel);
      fs.writeFileSync(path.join(sessionPath, 'ptt.md'), ptt, 'utf8');
      return;
    }
    const ptt = `# Pentest Task Tree — ${session.name}

**Target:** ${session.name} | **Started:** ${session.createdAt} | **Updated:** ${session.updatedAt}
**Framework:** MITRE ATT&CK Enterprise v15
**OPSEC Level:** ${session.opsecLevel}
**Autonomy Level:** ${session.autonomyLevel}

---

## Stage 0: Pre-Engagement
- [ ] Define scope and rules of engagement
- [ ] Set OPSEC and autonomy levels
- [ ] Gather credentials (if provided)

## Stage 1: Reconnaissance (TA0043)
- [ ] Passive recon — WHOIS, DNS enumeration
- [ ] OSINT — theHarvester, Shodan discovery
- [ ] Subdomain enumeration — subfinder, amass

## Stage 2: Resource Development (TA0042)
- [ ] Port scanning — nmap service discovery
- [ ] Web probing — httpx, whatweb fingerprinting
- [ ] Vulnerability scanning — nuclei, nikto
- [ ] Directory fuzzing — ffuf, dirsearch

## Stage 3: Initial Access (TA0001)
- [ ] Identify attack vectors
- [ ] Exploit identified vulnerabilities
- [ ] Document successful access methods

## Stage 4: Execution (TA0002)
- [ ] Execute payloads (if in scope)
- [ ] Document execution paths

## Stage 5: Persistence (TA0003)
- [ ] Establish persistence mechanisms (if in scope)
- [ ] Document persistence methods

## Stage 6: Privilege Escalation (TA0004)
- [ ] Enumerate privilege escalation paths
- [ ] Exploit escalation vectors (if in scope)

## Stage 7: Lateral Movement (TA0008)
- [ ] Discover internal network topology
- [ ] Move laterally to other targets

## Stage 8: Impact (TA0040)
- [ ] Achieve engagement objectives
- [ ] Document impact achieved

## Disengagement
- [ ] Cleanup — remove shells, accounts, persistence
- [ ] Invoke hexestra-report Skill to generate and review the final report
- [ ] Close engagement
`;
    fs.writeFileSync(path.join(sessionPath, 'ptt.md'), ptt, 'utf-8');
  }

  private writeTargetsManifest(sessionPath: string, targets: Target[]) {
    const lines = [
      '# Target Inventory',
      '',
      `**Updated:** ${new Date().toISOString()}`,
      '',
      '| ID | Target | Status | Info Doc |',
      '|----|--------|--------|----------|',
    ];

    for (const t of targets) {
      lines.push(`| ${t.id} | ${t.ip}${t.hostname ? ' (' + t.hostname + ')' : ''} | ${t.status} | targets/${t.id}.md |`);
    }

    lines.push('');
    lines.push('## Discovery Log');
    lines.push('');
    lines.push('| Timestamp | Target ID | Source | Notes |');
    lines.push('|-----------|-----------|--------|-------|');

    fs.writeFileSync(path.join(sessionPath, 'targets.md'), lines.join('\n'), 'utf-8');
  }

  private writeTargetDocument(sessionPath: string, target: Target) {
    const lines = [
      `# ${target.hostname ? `${target.hostname} (${target.ip})` : target.ip}`,
      '',
      `- Status: ${target.status}`,
      `- First seen: ${target.firstSeen}`,
      `- Last updated: ${target.lastUpdated}`,
      `- Tags: ${(target.tags ?? []).join(', ') || 'none'}`,
      '',
      '## Services',
      '',
      '| Port | State | Service | Version |',
      '|------|-------|---------|---------|',
      ...target.ports.map((port) => `| ${port.port}/${port.protocol} | ${port.state} | ${port.service ?? ''} | ${port.version ?? ''} |`),
      '',
      '## AI summary',
      '',
      target.aiSummary ?? 'No summary recorded yet.',
      '',
    ];
    fs.writeFileSync(path.join(sessionPath, 'targets', `${target.id}.md`), lines.join('\n'), 'utf8');
  }
}

export function isVisibleSessionFileChange(filename: string | Buffer | null) {
  if (filename === null) return true;
  const segments = filename.toString().replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.every((segment) => !segment.startsWith('.'));
}

export function resolveProjectWatchPath(
  sessionPath: string,
  platform: NodeJS.Platform = process.platform,
  resolveRealPath: (value: string) => string = (value) => fs.realpathSync.native(value),
) {
  if (platform !== 'win32') return sessionPath;
  try {
    return resolveRealPath(sessionPath);
  } catch {
    return sessionPath;
  }
}

export const sessionService = new SessionService();

function cleanTarget<T extends Target>(target: T): Target {
  return {
    ...target,
    domains: target.domains ?? [],
    tags: target.tags ?? [],
    ports: (target.ports ?? []).map((port) => ({
      ...port,
      service: cleanTerminalField(port.service),
      version: cleanTerminalField(port.version),
    })),
    services: (target.services ?? []).map((service) => ({
      ...service,
      name: cleanTerminalField(service.name) ?? 'unknown',
      version: cleanTerminalField(service.version),
      product: cleanTerminalField(service.product),
      extra: cleanTerminalField(service.extra),
    })),
  };
}

function projectTargetScope(target: Target, scope: SessionMeta['scope']): Target {
  return {
    ...target,
    status: deriveScopedAssetStatus(
      scope,
      [target.id, target.ip, target.hostname, ...target.domains],
      target.status,
    ),
  };
}

function projectAssetScope(asset: AssetRecord, scope: SessionMeta['scope']): AssetRecord {
  const semanticValue = asset.key.slice(asset.key.indexOf(':') + 1);
  return {
    ...asset,
    status: deriveScopedAssetStatus(scope, [asset.id, semanticValue], asset.status),
  };
}

function cleanTerminalField(value?: string) {
  if (!value) return value;
  const cut = value.search(/&echo|\x1b|\d+\/(?:tcp|udp)\s+(?:open|filtered|closed)/i);
  const clean = (cut >= 0 ? value.slice(0, cut) : value)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\)+\s*$/, '')
    .trim();
  return clean || undefined;
}
