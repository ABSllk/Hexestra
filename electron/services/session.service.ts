import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { installHexestraSkills, resolvePentestSkillSource } from './pentest-skill';
import { resolveGlobalUserPath } from './hexestra-home';
import {
  normalizeOperationalAssetStatus,
  normalizeStoredAsset,
  type AssetRecord,
} from './asset-record';
import {
  AssetGraphRepository,
  type GraphLayoutState,
  type GraphRelation,
  type GraphPerspective,
  type RelationSemantic,
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
  deletePttTask,
  deletePttStep,
  insertPttStep,
  parsePttDocument,
  normalizePttMarkdown,
  parsePttMarkdown,
  planPttTasks,
  planPttSteps,
  updatePttTaskStatus,
  updatePttStep,
  upsertPttTask,
  type PentestTask,
  type PttTaskInput,
  type TaskStatus,
} from './ptt-markdown';
import { ATTACK_CATALOG_VERSION, getTactic, getTechnique } from './attack-catalog';
import { ATTACK_TACTICS } from '../contracts/tasks';
import type { ExecutionStep, PentestObjective, TaskContextPackage, TaskPlanGroupInput, TaskStepInput, TaskStepPlanInput, TaskTraceEntry, TaskTracePackage } from '../contracts/tasks';
import {
  applyRestrictionImport,
  deleteRestriction as deleteRestrictionDocument,
  listRestrictionDocuments,
  previewRestrictionImport,
  globalRestrictionsPath,
  projectRestrictionsPath,
  readRestrictionDocument,
  resolveRestrictions,
  seedGlobalRestrictions,
  serializeRestrictionDocument,
  upsertRestriction as upsertRestrictionDocument,
  type RestrictionImportPreview,
  type RestrictionScope,
  type RestrictionUpsertInput,
} from './restriction.service';
import { createTool, deleteTool, listEnabledToolCatalog, readToolCatalog, resolveToolCatalogCandidates, updateTool } from './tool-catalog.service';
import { TOOL_CATALOG_IPC, type ToolCatalogMutableFields, type ToolCatalogRecord } from '../contracts/tool-catalog';
import { normalizeScopePolicy, scopeAdvisoryForValues, scopeAnnotationForValues } from './scope-policy';
import { isReadOnlyHexestraTool } from './agent-tool-policy';
import { AgentHistoryRepository } from './agent-history.repository';
import { isManagedRecordKind, RECORDS_IPC, type RecordExportResult } from '../contracts/records';
import { managedRecordFilename, managedRecordMarkdown } from './record-export';
import type { ScopeAnnotation, SessionDataChangedEvent } from '../contracts/session';
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
  scopeAnnotation?: ScopeAnnotation;
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
  version: 4;
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
  private readonly userDataPath: string;
  private readonly globalUserPath: string;
  private readonly registry: ProjectRegistry;
  private readonly projectPaths = new Map<string, string>();
  private repositories = new Map<string, AssetGraphRepository>();
  private historyRepositories = new Map<string, AgentHistoryRepository>();
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
    this.userDataPath = userDataPath;
    this.globalUserPath = resolveGlobalUserPath();
    this.registry = new ProjectRegistry(path.join(userDataPath, 'recent-projects.json'));
    this.registerHandlers();
  }

  getUserDataPath() {
    return this.userDataPath;
  }

  getGlobalUserPath() {
    return this.globalUserPath;
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

    ipcMain.handle('netmap:layout:get', async (_event, sessionId: string, perspective?: GraphPerspective) => {
      return this.getNetMapLayout(sessionId, perspective);
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
    ipcMain.handle('tasks:plan', async (_event, sessionId: string, groups: TaskPlanGroupInput[]) => this.planTasks(sessionId, groups));

    ipcMain.handle('tasks:delete', async (_event, sessionId: string, taskId: string) => this.deleteTask(sessionId, taskId));
    ipcMain.handle('tasks:focus', async (_event, sessionId: string, taskId: string | null) => this.focusTask(sessionId, taskId));
    ipcMain.handle('tasks:context', async (_event, sessionId: string, taskId?: string) => this.resolveTaskContext(sessionId, taskId));
    ipcMain.handle('tasks:criterion', async (_event, sessionId: string, taskId: string, criterionId: string, completed: boolean) => this.updateTaskCriterion(sessionId, taskId, criterionId, completed));
    ipcMain.handle('tasks:steps-plan', async (_event, sessionId: string, input: TaskStepPlanInput) => this.planTaskSteps(sessionId, input));
    ipcMain.handle('tasks:step-upsert', async (_event, sessionId: string, input: TaskStepInput) => this.upsertTaskStep(sessionId, input));
    ipcMain.handle('tasks:step-delete', async (_event, sessionId: string, stepId: string) => this.deleteTaskStep(sessionId, stepId));
    ipcMain.handle('tasks:step-reorder', async (_event, sessionId: string, parentId: string, stepIds: string[]) => this.reorderTaskSteps(sessionId, parentId, stepIds));
    ipcMain.handle('tasks:trace', async (_event, sessionId: string, nodeId: string) => this.getTaskTrace(sessionId, nodeId));
    ipcMain.handle('tasks:document-status', async (_event, sessionId: string) => this.getPttDocumentStatus(sessionId));
    ipcMain.handle('tasks:rebuild', async (_event, sessionId: string) => this.rebuildPtt(sessionId));
    ipcMain.handle('restrictions:list', async (_event, sessionId: string) => this.getRestrictions(sessionId));
    ipcMain.handle('restrictions:upsert', async (_event, sessionId: string, scope: RestrictionScope, input: RestrictionUpsertInput) => this.upsertRestriction(sessionId, scope, input, true));
    ipcMain.handle('restrictions:delete', async (_event, sessionId: string, scope: RestrictionScope, id: string) => this.deleteRestriction(sessionId, scope, id, true));
    ipcMain.handle('restrictions:import-preview', async (_event, sessionId: string, scope: RestrictionScope, yamlText: string) => this.previewRestrictionImport(sessionId, scope, yamlText));
    ipcMain.handle('restrictions:import-apply', async (_event, sessionId: string, scope: RestrictionScope, preview: RestrictionImportPreview) => this.applyRestrictionImport(sessionId, scope, preview));
    ipcMain.handle('restrictions:export', async (event, sessionId: string, scope: RestrictionScope) => this.exportRestrictions(event, sessionId, scope));
    ipcMain.handle(TOOL_CATALOG_IPC.LIST, async () => readToolCatalog(this.globalUserPath));
    ipcMain.handle(TOOL_CATALOG_IPC.CREATE, async (_event, tool: ToolCatalogRecord) => createTool(this.globalUserPath, tool));
    ipcMain.handle(TOOL_CATALOG_IPC.UPDATE, async (_event, toolId: string, fields: ToolCatalogMutableFields) => updateTool(this.globalUserPath, toolId, fields));
    ipcMain.handle(TOOL_CATALOG_IPC.DELETE, async (_event, toolId: string) => deleteTool(this.globalUserPath, toolId));

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
    this.getAgentHistory(metadata.id);
    session = {
      ...this.reconcileProjectCounts(metadata.id, metadata),
      basePath: sessionPath,
    };
    if (!fs.existsSync(path.join(projectDataPath(sessionPath), 'project-state.json'))) {
      this.writeProjectState(sessionPath, createDefaultProjectState());
    }
    this.ensureHexestraSkills(sessionPath);
    seedGlobalRestrictions(this.globalUserPath);
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
    this.historyRepositories.delete(id);
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
      this.getAgentHistory(sessionId).ensureBranches(state.agent.branches);
      return state;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as unknown;
    } catch {
      const state = createDefaultProjectState();
      this.getAgentHistory(sessionId).ensureBranches(state.agent.branches);
      return state;
    }
    let normalized: ProjectState;
    try {
      normalized = normalizeProjectState(raw);
    } catch {
      const state = createDefaultProjectState();
      this.getAgentHistory(sessionId).ensureBranches(state.agent.branches);
      return state;
    }
    if (isLegacyProjectState(raw)) {
      // Migration errors intentionally escape: the original v9 file remains intact and
      // the next open can retry after the underlying filesystem issue is fixed.
      const repository = this.getAgentHistory(sessionId);
      const backupPath = path.join(projectDataPath(sessionPath), 'project-state.v9.pre-agent-history.json');
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(statePath, backupPath);
        try { fs.chmodSync(backupPath, 0o444); } catch { /* best effort on filesystems without POSIX modes */ }
      }
      repository.migrateLegacyState(normalized);
      const migrated = stripLegacyHistory(normalized, repository);
      this.writeProjectState(sessionPath, migrated);
      return migrated;
    }
    this.getAgentHistory(sessionId).ensureBranches(normalized.agent.branches);
    return normalized;
  }

  getAgentHistory(sessionId: string) {
    const existing = this.historyRepositories.get(sessionId);
    if (existing) return existing;
    const repository = new AgentHistoryRepository(this.getSessionPath(sessionId));
    this.historyRepositories.set(sessionId, repository);
    return repository;
  }

  clearAgentHistory(sessionId: string) {
    const repository = this.getAgentHistory(sessionId);
    repository.clear();
    const backupPath = path.join(projectDataPath(this.getSessionPath(sessionId)), 'project-state.v9.pre-agent-history.json');
    if (fs.existsSync(backupPath)) {
      try { fs.chmodSync(backupPath, 0o666); } catch { /* best effort */ }
      fs.rmSync(backupPath, { force: true });
    }
  }

  updateProjectState(sessionId: string, patch: ProjectStatePatch): ProjectState {
    const sessionPath = this.getSessionPath(sessionId);
    if (!fs.existsSync(path.join(projectDataPath(sessionPath), 'project.json'))) {
      throw new Error(`Project ${sessionId} not found`);
    }
    const state = mergeProjectState(this.getProjectState(sessionId), patch);
    this.writeProjectState(sessionPath, state);
    this.getAgentHistory(sessionId).ensureBranches(state.agent.branches);
    return state;
  }

  valueIsInScope(sessionId: string, value: string) {
    return this.scopeAnnotation(sessionId, value) === 'authorized';
  }

  scopeAnnotation(sessionId: string, value: string) {
    return scopeAnnotationForValues(readProjectMetadata(this.getSessionPath(sessionId))?.scope, [value]);
  }

  async updateScope(sessionId: string, scope: SessionMeta['scope']) {
    const updated = await this.updateSession(sessionId, { scope: normalizeScopePolicy(scope) });
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
    const repository = this.getRepository(sessionId);
    return projectAssetsScope(
      repository.listAssets(),
      this.listTargets(sessionId),
      repository.listRelations(),
      scope,
    );
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
    return { version: 4, assets: this.listAssets(sessionId), edges: repository.listRelations() };
  }

  getAssetContext(sessionId: string, assetId: string) {
    const host = this.listTargets(sessionId).find((candidate) => candidate.id === assetId);
    const asset = this.listAssets(sessionId).find((candidate) => candidate.id === assetId);
    if (!host && !asset) throw new Error(`Asset ${assetId} not found`);
    const relationships = this.getRepository(sessionId).listRelations()
      .filter((edge) => edge.source === assetId || edge.target === assetId);
    return {
      asset: host ? {
        ...host,
        type: 'host' as const,
        key: `host:${host.ip}`,
        label: host.hostname ?? host.ip,
        properties: {
          ip: host.ip,
          ...(host.hostname ? { hostname: host.hostname } : {}),
          domains: host.domains,
          ...(host.os ? { os: host.os } : {}),
        },
      } : asset!,
      relationships,
    };
  }

  upsertNetMapEdge(
    sessionId: string,
    sourceTargetId: string | undefined,
    targetId: string,
    type: GraphEdgeType,
    metadata: Record<string, string> = {},
    semantic?: RelationSemantic,
  ): { edge: GraphEdge | null; created: boolean } {
    return this.getRepository(sessionId).upsertRelation(sourceTargetId, targetId, type, metadata, semantic);
  }

  withGraphTransaction<T>(sessionId: string, work: () => T): T {
    return this.getRepository(sessionId).transaction(work);
  }

  refreshGraphArtifacts(sessionId: string) {
    this.refreshTargetArtifacts(sessionId);
    this.reconcileProjectCounts(sessionId);
  }

  getNetMapLayout(sessionId: string, perspective?: GraphPerspective) {
    return this.getRepository(sessionId).getLayoutState(perspective);
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
    if (normalized.changed) {
      const backup = path.join(sessionPath, `ptt.pre-technique.${Date.now()}.md`);
      fs.copyFileSync(pttPath, backup);
      try { fs.chmodSync(backup, 0o444); } catch { /* best effort */ }
      try {
        this.writePtt(sessionPath, normalized.markdown);
      } catch (error) {
        // Keep the original source intact if the migration cannot be committed.
        try { fs.copyFileSync(backup, pttPath); } catch { /* preserve diagnostic below */ }
        throw new Error(`PTT migration failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.ensureTaskWatcher(sessionId);
    return normalized.tasks;
  }

  getPttDocumentStatus(sessionId: string) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    if (!fs.existsSync(pttPath)) return { kind: 'missing' as const, tasks: [], diagnostics: [] };
    return parsePttDocument(fs.readFileSync(pttPath, 'utf8'));
  }

  async rebuildPtt(sessionId: string) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    const status = this.getPttDocumentStatus(sessionId);
    if (status.kind !== 'legacy_unsupported') throw new Error('PTT rebuild is only available for retired Stage-format files');
    const backup = path.join(sessionPath, `ptt.legacy.${Date.now()}.md`);
    fs.copyFileSync(pttPath, backup);
    try { fs.chmodSync(backup, 0o444); } catch { /* best-effort on filesystems without POSIX modes */ }
    const session = await this.loadSession(sessionId);
    this.writePttTemplate(sessionPath, session);
    return { rebuilt: true, backup };
  }

  async updateTaskStatus(sessionId: string, taskId: string, status: TaskStatus) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    await this.listTasks(sessionId);
    const result = updatePttTaskStatus(fs.readFileSync(pttPath, 'utf8'), taskId, status);
    this.writePtt(sessionPath, result.markdown);
    return result.task;
  }

  async updateTaskStatusForBranch(sessionId: string, taskId: string, status: TaskStatus, branchId?: string) {
    const tasks = await this.listTasks(sessionId);
    this.assertTaskOrDescendantFocused(sessionId, taskId, tasks, branchId);
    return this.updateTaskStatus(sessionId, taskId, status);
  }

  async planTaskSteps(sessionId: string, input: TaskStepPlanInput, branchId?: string) {
    this.assertObjectiveFocused(sessionId, input.objectiveId, branchId);
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    await this.listTasks(sessionId);
    const result = planPttSteps(fs.readFileSync(pttPath, 'utf8'), input);
    this.writePtt(sessionPath, result.markdown);
    return result.steps;
  }

  async upsertTaskStep(sessionId: string, input: TaskStepInput, branchId?: string) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    const tasks = await this.listTasks(sessionId);
    const markdown = fs.readFileSync(pttPath, 'utf8');
    if (!input.id) {
      this.assertObjectiveFocused(sessionId, input.parentId, branchId);
      const result = insertPttStep(markdown, input);
      this.writePtt(sessionPath, result.markdown);
      return result.step;
    }

    const existing = tasks.find((task): task is ExecutionStep => task.kind === 'step' && task.id === input.id);
    if (!existing) throw new Error(`Step ${input.id} not found`);
    const result = updatePttStep(markdown, input);
    const criterionDefinitionsSame = sameCriterionDefinitions(existing.successCriteria, result.step.successCriteria);
    const definitionChanged = existing.title !== result.step.title
      || existing.description !== result.step.description
      || existing.order !== result.step.order
      || !criterionDefinitionsSame;
    const lifecycleChanged = existing.status !== result.step.status
      || existing.resultSummary !== result.step.resultSummary
      || existing.blockedReason !== result.step.blockedReason
      || (criterionDefinitionsSame && !sameCriterionCompletion(existing.successCriteria, result.step.successCriteria));

    if (definitionChanged && lifecycleChanged) {
      throw new Error('Change Step structure while its Objective is focused, then focus the Step before updating execution state');
    }
    if (definitionChanged) this.assertObjectiveFocused(sessionId, input.parentId, branchId);
    else if (lifecycleChanged) this.assertStepFocused(sessionId, input.id, branchId);
    else this.assertObjectiveOrStepFocused(sessionId, input.parentId, input.id, branchId);
    this.writePtt(sessionPath, result.markdown);
    return result.step;
  }

  async deleteTaskStep(sessionId: string, stepId: string, branchId?: string) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    await this.listTasks(sessionId);
    const step = (await this.listTasks(sessionId)).find((task): task is ExecutionStep => task.kind === 'step' && task.id === stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);
    this.assertObjectiveFocused(sessionId, step.parentId, branchId);
    const state = this.getProjectState(sessionId);
    const hasActivity = state.agent.branches.some((branch) => this.getAgentHistory(sessionId).getMessages(branch.id).some((message) => (message.activities ?? []).some((activity) => activity.pttTaskId === stepId)));
    if (hasActivity) throw new Error('Steps with activity records cannot be deleted');
    this.writePtt(sessionPath, deletePttStep(fs.readFileSync(pttPath, 'utf8'), stepId));
    return { deleted: stepId };
  }

  async reorderTaskSteps(sessionId: string, parentId: string, stepIds: string[], branchId?: string) {
    this.assertObjectiveFocused(sessionId, parentId, branchId);
    const tasks = await this.listTasks(sessionId);
    const siblings = tasks.filter((task): task is ExecutionStep => task.kind === 'step' && task.parentId === parentId);
    if (siblings.some((step) => step.status !== 'pending')) throw new Error('Started Steps cannot be reordered');
    if (siblings.length !== stepIds.length || new Set(stepIds).size !== stepIds.length || stepIds.some((id) => !siblings.some((step) => step.id === id))) {
      throw new Error('Reorder must include every pending Step exactly once');
    }
    let markdown = fs.readFileSync(path.join(this.getSessionPath(sessionId), 'ptt.md'), 'utf8');
    for (const [order, id] of stepIds.entries()) {
      const step = siblings.find((candidate) => candidate.id === id)!;
      markdown = updatePttStep(markdown, { id, parentId, title: step.title, order }).markdown;
    }
    this.writePtt(this.getSessionPath(sessionId), markdown);
    return (await this.listTasks(sessionId)).filter((task): task is ExecutionStep => task.kind === 'step' && task.parentId === parentId).sort((a, b) => a.order - b.order);
  }

  async upsertTask(sessionId: string, task: PttTaskInput) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    const currentTasks = await this.listTasks(sessionId);
    if (task.id && task.primaryTacticId && task.techniqueIds?.length === 1) {
      const existing = currentTasks.find((candidate) => candidate.id === task.id && candidate.kind === 'objective');
      if (existing && (existing.primaryTacticId !== task.primaryTacticId || existing.techniqueIds[0] !== task.techniqueIds[0])) {
        const hasActivity = this.getProjectState(sessionId).agent.branches.some((branch) => this.getAgentHistory(sessionId).getMessages(branch.id).some((message) => (message.activities ?? []).some((activity) => activity.pttTaskId === task.id)));
        if (hasActivity) throw new Error('Agent Tasks with activity records cannot be reclassified');
      }
    }
    const result = upsertPttTask(fs.readFileSync(pttPath, 'utf8'), task);
    this.writePtt(sessionPath, result.markdown);
    return result.task;
  }

  async planTasks(sessionId: string, groups: TaskPlanGroupInput[]) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    await this.listTasks(sessionId);
    const result = planPttTasks(fs.readFileSync(pttPath, 'utf8'), groups);
    this.writePtt(sessionPath, result.markdown);
    return result.tasks;
  }

  async deleteTask(sessionId: string, taskId: string) {
    const sessionPath = this.getSessionPath(sessionId);
    const pttPath = path.join(sessionPath, 'ptt.md');
    await this.listTasks(sessionId);
    const state = this.getProjectState(sessionId);
    const tasks = await this.listTasks(sessionId);
    const focusedIds = new Set(state.agent.branches.map((branch) => branch.focusedTaskId).filter((id): id is string => Boolean(id)));
    if (focusedIds.has(taskId) || tasks.some((task) => task.kind === 'step' && task.parentId === taskId && focusedIds.has(task.id))) throw new Error('Cannot delete a task focused by an active conversation branch');
    const markdown = deletePttTask(fs.readFileSync(pttPath, 'utf8'), taskId);
    this.writePtt(sessionPath, markdown);
    return { deleted: taskId };
  }

  async focusTask(sessionId: string, taskId: string | null, branchId?: string) {
    const state = this.getProjectState(sessionId);
    const targetBranchId = branchId ?? state.agent.activeBranchId;
    const targetBranch = state.agent.branches.find((branch) => branch.id === targetBranchId);
    if (!targetBranch) throw new Error(`Conversation branch ${targetBranchId} not found`);
    const currentTaskId = targetBranch.focusedTaskId ?? null;
    const context = taskId ? await this.resolveTaskContext(sessionId, taskId) : null;
    if (currentTaskId === taskId) return context;
    if (context?.blockers.length) throw new Error(`Task cannot be focused: ${context.blockers.join('; ')}`);
    const branches = state.agent.branches.map((branch) => branch.id === targetBranchId ? { ...branch, focusedTaskId: taskId } : branch);
    this.updateProjectState(sessionId, { agent: { branches } });
    return context;
  }

  async updateTaskCriterion(sessionId: string, taskId: string, criterionId: string, completed: boolean, branchId?: string) {
    const tasks = await this.listTasks(sessionId);
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const criterion = task.successCriteria.find((candidate) => candidate.id === criterionId);
    if (!criterion) throw new Error(`Criterion ${criterionId} not found`);
    const criteria = task.successCriteria.map((candidate) => candidate.id === criterionId ? { ...candidate, completed } : candidate);
    if (task.kind === 'step') return this.upsertTaskStep(sessionId, { id: task.id, parentId: task.parentId, title: task.title, successCriteria: criteria }, branchId);
    return this.upsertTask(sessionId, { ...task, successCriteria: criteria });
  }

  async updateTaskCriterionForBranch(sessionId: string, taskId: string, criterionId: string, completed: boolean, branchId?: string) {
    const tasks = await this.listTasks(sessionId);
    this.assertTaskOrDescendantFocused(sessionId, taskId, tasks, branchId);
    return this.updateTaskCriterion(sessionId, taskId, criterionId, completed, branchId);
  }

  getRestrictions(sessionId: string) {
    const documents = listRestrictionDocuments(
      globalRestrictionsPath(this.globalUserPath),
      projectRestrictionsPath(this.getSessionPath(sessionId)),
    );
    return {
      version: 1 as const,
      global: documents.global,
      project: documents.project,
      diagnostics: [...documents.global.diagnostics, ...documents.project.diagnostics],
    };
  }

  private restrictionFilePath(sessionId: string, scope: RestrictionScope) {
    return scope === 'global'
      ? globalRestrictionsPath(this.globalUserPath)
      : projectRestrictionsPath(this.getSessionPath(sessionId));
  }

  upsertRestriction(sessionId: string, scope: RestrictionScope, input: RestrictionUpsertInput, confirmed = false) {
    if (!confirmed) throw new Error('Restriction changes require explicit operator confirmation');
    const filePath = this.restrictionFilePath(sessionId, scope);
    upsertRestrictionDocument(filePath, scope, input);
    return this.getRestrictions(sessionId);
  }

  deleteRestriction(sessionId: string, scope: RestrictionScope, id: string, confirmed = false) {
    if (!confirmed) throw new Error('Restriction changes require explicit operator confirmation');
    const filePath = this.restrictionFilePath(sessionId, scope);
    deleteRestrictionDocument(filePath, scope, id);
    return this.getRestrictions(sessionId);
  }

  previewRestrictionImport(sessionId: string, scope: RestrictionScope, yamlText: string) {
    const filePath = this.restrictionFilePath(sessionId, scope);
    return previewRestrictionImport(filePath, scope, yamlText);
  }

  applyRestrictionImport(sessionId: string, scope: RestrictionScope, preview: RestrictionImportPreview) {
    const filePath = this.restrictionFilePath(sessionId, scope);
    applyRestrictionImport(filePath, preview);
    return this.getRestrictions(sessionId);
  }

  private async exportRestrictions(event: Electron.IpcMainInvokeEvent, sessionId: string, scope: RestrictionScope) {
    const document = readRestrictionDocument(this.restrictionFilePath(sessionId, scope), scope).document;
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showSaveDialog(owner, { title: 'Export restrictions YAML', defaultPath: 'restrictions.yaml', filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }] })
      : await dialog.showSaveDialog({ title: 'Export restrictions YAML', defaultPath: 'restrictions.yaml', filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, serializeRestrictionDocument(document), 'utf8');
    return { canceled: false, filePath: result.filePath };
  }

  async resolveTaskContext(sessionId: string, taskId?: string, selectedTargetId?: string): Promise<TaskContextPackage> {
    const state = this.getProjectState(sessionId);
    const focusedTaskId = taskId ?? state.agent.branches.find((branch) => branch.id === state.agent.activeBranchId)?.focusedTaskId ?? undefined;
    const tasks = await this.listTasks(sessionId);
    if (!focusedTaskId) return {
      objective: null,
      activeStep: undefined,
      catalogVersion: ATTACK_CATALOG_VERSION,
      tactic: null,
      techniques: [],
      targets: [],
      restrictions: [],
      skills: [],
      tools: [],
      dependencies: [],
      blockers: [],
      notices: [],
      related: { findings: [], vulnerabilities: [], evidence: [] },
    };
    const focused = tasks.find((candidate) => candidate.id === focusedTaskId);
    if (!focused) throw new Error(`Task ${focusedTaskId} not found`);
    const objective = focused.kind === 'objective' ? focused : tasks.find((candidate): candidate is PentestObjective => candidate.kind === 'objective' && candidate.id === focused.parentId);
    if (!objective) throw new Error(`Parent Objective for ${focusedTaskId} not found`);
    const activeStep = focused.kind === 'step' ? focused : undefined;
    const blockers: string[] = [];
    const notices: Array<{ code: string; message: string; severity: 'info' | 'warning'; targetId?: string }> = [];
    if (objective.diagnostics?.length) blockers.push(...objective.diagnostics);
    if (objective.techniqueIds.length !== 1) blockers.push('Agent Task must reference exactly one valid ATT&CK technique');
    if (!objective.successCriteria.length) blockers.push('At least one success criterion is required');
    const scope = normalizeScopePolicy(readProjectMetadata(this.getSessionPath(sessionId))?.scope);
    const allTargets = [...this.listTargets(sessionId), ...this.listAssets(sessionId)];
    const targetById = new Map(allTargets.map((asset) => [asset.id, asset]));
    const contextTargetIds = objective.targetAssetIds.length
      ? [...objective.targetAssetIds]
      : selectedTargetId && targetById.has(selectedTargetId) ? [selectedTargetId] : [];
    const targets = contextTargetIds.flatMap((id) => {
      const asset = targetById.get(id);
      if (!asset) {
        notices.push({ code: 'target_missing', message: `Task target ${id} does not exist in the project.`, severity: 'warning', targetId: id });
        return [];
      }
      const label = 'ip' in asset ? asset.ip : asset.label;
      const values = 'ip' in asset
        ? [asset.id, asset.ip, asset.hostname, ...asset.domains, asset.os]
        : [asset.id, asset.label, ...Object.values(asset.properties).flatMap((value) => Array.isArray(value) ? value : [String(value)])];
      const scopeAdvisory = scopeAdvisoryForValues(scope, values);
      if (scopeAdvisory === 'unlisted' || scopeAdvisory === 'excluded') {
        notices.push({ code: scopeAdvisory === 'unlisted' ? 'target_unlisted' : 'target_excluded', message: `${label} is ${scopeAdvisory} under the current Scope mode; advisory.`, severity: 'warning', targetId: id });
      }
      return [{ id: asset.id, label, status: asset.status, scopeAnnotation: asset.scopeAnnotation, scopeAdvisory }];
    });
    if (!objective.targetAssetIds.length) notices.push({ code: 'task_unbound', message: 'No task target; selection is a context hint.', severity: 'info' });
    if (selectedTargetId && objective.targetAssetIds.length && !objective.targetAssetIds.includes(selectedTargetId)) {
      notices.push({ code: 'selected_target_outside_task', message: 'Selected target is outside this task; selection remains a priority hint.', severity: 'info', targetId: selectedTargetId });
    }
    const dependencies = objective.dependsOnTaskIds.map((id) => tasks.find((candidate) => candidate.id === id)).filter((candidate): candidate is PentestTask => Boolean(candidate));
    if (dependencies.length !== objective.dependsOnTaskIds.length) blockers.push('One or more task dependencies do not exist');
    if (dependencies.some((dependency) => dependency.status !== 'completed' && dependency.status !== 'skipped')) blockers.push('All task dependencies must be completed or skipped');
    if (hasDependencyCycle(objective, tasks)) blockers.push('Task dependency graph contains a cycle');
    if (activeStep?.diagnostics?.length) blockers.push(...activeStep.diagnostics);
    if (activeStep && activeStep.status === 'completed') blockers.push('The focused Step is already completed');
    const restrictionContext = resolveRestrictions(
      globalRestrictionsPath(this.globalUserPath),
      projectRestrictionsPath(this.getSessionPath(sessionId)),
      objective.primaryTacticId,
      objective.techniqueIds,
    );
    const restrictions = restrictionContext.rules;
    blockers.push(...restrictionContext.diagnostics);
    let skills: Array<{ id: string; name: string; match: 'preferred' | 'technique' | 'capability' | 'tactic' | 'other' }> = [];
    try {
      const { claudeCapabilitiesService } = await import('./claude-capabilities.service');
      const skillItems = (await claudeCapabilitiesService.listSkills(sessionId)).items;
      const projectSkillNames = new Set(skillItems.filter((item) => item.scope === 'project').map((item) => item.name));
      const availableSkills = skillItems.filter((item) => item.enabled && (item.scope !== 'global' || !projectSkillNames.has(item.name)));
      skills = availableSkills.map((skill) => {
        const metadata = skill.metadata ?? {};
        const techniques = (metadata['hexestra-techniques'] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
        const tactics = (metadata['hexestra-tactics'] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
        const capabilities = (metadata['hexestra-capabilities'] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
        const match: 'preferred' | 'technique' | 'capability' | 'tactic' | 'other' = objective.preferredSkillIds.includes(skill.id) || objective.preferredSkillIds.includes(skill.name)
          ? 'preferred'
          : techniques.some((id) => objective.techniqueIds.includes(id))
            ? 'technique'
            : capabilities.some((id) => objective.requiredCapabilities.includes(id))
              ? 'capability'
              : tactics.includes(objective.primaryTacticId)
                ? 'tactic'
                : 'other';
        return { id: skill.id, name: skill.name, match };
      }).sort((left, right) => matchPriority(left.match) - matchPriority(right.match));
    } catch {
      skills = [];
    }
    const tools = resolveToolCatalogCandidates(listEnabledToolCatalog(this.globalUserPath), objective);
    return {
      objective,
      activeStep,
      catalogVersion: ATTACK_CATALOG_VERSION,
      tactic: getTactic(objective.primaryTacticId) ?? null,
      techniques: objective.techniqueIds.map((id) => getTechnique(id)).filter((value): value is NonNullable<typeof value> => Boolean(value)),
      targets,
      restrictions,
      skills,
      tools,
      dependencies: dependencies.map((dependency) => ({ id: dependency.id, title: dependency.title, status: dependency.status })),
      blockers,
      notices,
      related: {
        findings: this.listFindings(sessionId).filter((finding) => finding.assetId && contextTargetIds.includes(finding.assetId)).slice(0, 20).map((finding) => ({ ...finding })),
        vulnerabilities: this.listVulnerabilities(sessionId).filter((vulnerability) => contextTargetIds.includes(vulnerability.assetId)).slice(0, 20).map((vulnerability) => ({ ...vulnerability })),
        evidence: this.listEvidence(sessionId).filter((evidence) => contextTargetIds.includes(evidence.assetId)).slice(0, 20).map((evidence) => ({ ...evidence })),
      },
    };
  }

  async assertTaskExecutionReady(sessionId: string, toolName: string, branchId?: string) {
    // Read-only tools do not mutate state and must not require a focused Task.
    if (isReadOnlyHexestraTool(toolName)) return;
    if (/^(task_|restriction_|tool_catalog_)/.test(toolName)) return;
    const state = this.getProjectState(sessionId);
    const targetBranchId = branchId ?? state.agent.activeBranchId;
    const branch = state.agent.branches.find((candidate) => candidate.id === targetBranchId);
    if (!branch?.focusedTaskId) throw new Error('Create and focus an Agent Task before using execution tools');
    const tasks = await this.listTasks(sessionId);
    const focused = tasks.find((task) => task.id === branch.focusedTaskId);
    if (!focused) throw new Error('The focused task no longer exists');
    if (focused.kind === 'objective') {
      const steps = tasks.filter((task) => task.kind === 'step' && task.parentId === focused.id);
      if (steps.length === 0) throw new Error('Plan 3–7 execution Steps with task_steps_plan before using execution tools');
      throw new Error('Focus an execution Step with task_focus before using execution tools');
    }
    const context = await this.resolveTaskContext(sessionId, focused.id);
    if (context.blockers.length) throw new Error(`Task execution blocked: ${context.blockers.join('; ')}`);
  }

  private assertObjectiveFocused(sessionId: string, objectiveId: string, branchId?: string) {
    const focusedTaskId = this.getFocusedTaskId(sessionId, branchId);
    if (focusedTaskId !== objectiveId) throw new Error('Focus the Objective before changing its execution plan');
  }

  private assertStepFocused(sessionId: string, stepId: string, branchId?: string) {
    const focusedTaskId = this.getFocusedTaskId(sessionId, branchId);
    if (focusedTaskId !== stepId) throw new Error('Focus the Step before updating its execution state');
  }

  private assertObjectiveOrStepFocused(sessionId: string, objectiveId: string, stepId: string, branchId?: string) {
    const focusedTaskId = this.getFocusedTaskId(sessionId, branchId);
    if (focusedTaskId !== objectiveId && focusedTaskId !== stepId) {
      throw new Error('Focus the Objective or Step before updating it');
    }
  }

  private assertTaskOrDescendantFocused(sessionId: string, taskId: string, tasks: PentestTask[], branchId?: string) {
    const focusedTaskId = this.getFocusedTaskId(sessionId, branchId);
    if (focusedTaskId === taskId) return;
    const focused = tasks.find((task) => task.id === focusedTaskId);
    if (focused?.kind === 'step' && focused.parentId === taskId) return;
    throw new Error('Focus the Task or one of its Steps before updating execution state');
  }

  private getFocusedTaskId(sessionId: string, branchId?: string) {
    const state = this.getProjectState(sessionId);
    const targetBranchId = branchId ?? state.agent.activeBranchId;
    return state.agent.branches.find((branch) => branch.id === targetBranchId)?.focusedTaskId ?? undefined;
  }

  async getTaskTrace(sessionId: string, nodeId: string): Promise<TaskTracePackage> {
    const tasks = await this.listTasks(sessionId);
    const selected = tasks.find((task) => task.id === nodeId);
    if (!selected) throw new Error(`Task ${nodeId} not found`);
    const nodeIds = selected.kind === 'objective'
      ? new Set([selected.id, ...tasks.filter((task) => task.kind === 'step' && task.parentId === selected.id).map((task) => task.id)])
      : new Set([selected.id]);
    const nodes = tasks.filter((task) => nodeIds.has(task.id));
    const entries: TaskTraceEntry[] = nodes.flatMap((task) => {
      const lifecycle: TaskTraceEntry[] = [{ id: `${task.id}:created`, source: 'task', timestamp: task.createdAt, status: 'pending', label: 'Step created' }];
      if (task.startedAt) lifecycle.push({ id: `${task.id}:started`, source: 'task', timestamp: task.startedAt, status: 'running', label: 'Execution started' });
      if (task.completedAt) lifecycle.push({ id: `${task.id}:completed`, source: 'task', timestamp: task.completedAt, status: 'complete', label: 'Execution completed', detail: task.kind === 'step' ? task.resultSummary : undefined });
      if (task.status === 'blocked' || task.status === 'failed') lifecycle.push({ id: `${task.id}:blocked`, source: 'task', timestamp: task.updatedAt, status: 'blocked', label: task.status === 'failed' ? 'Execution failed' : 'Execution blocked', detail: task.kind === 'step' ? task.blockedReason : undefined });
      return lifecycle;
    });
    const state = this.getProjectState(sessionId);
    const branches = state.agent.branches;
    for (const branch of branches) {
      const messages = this.getAgentHistory(sessionId).getMessages(branch.id);
      for (const message of messages) {
        for (const activity of message.activities ?? []) {
          if (!activity.pttTaskId || !nodeIds.has(activity.pttTaskId)) continue;
          entries.push({ id: `${message.id}:${activity.id}`, source: 'agent', timestamp: message.timestamp, status: activity.status === 'error' ? 'error' : activity.status === 'running' ? 'running' : 'complete', label: activity.label ?? activity.toolName ?? 'Agent activity', detail: activity.outputSummary ?? activity.summary, toolName: activity.toolName, branchId: branch.id, elapsedSeconds: activity.elapsedSeconds });
        }
      }
      for (const run of this.getAgentHistory(sessionId).getSubagentRuns(branch.id)) {
        if (!run.pttTaskId || !nodeIds.has(run.pttTaskId)) continue;
        entries.push({ id: `${branch.id}:${run.id}`, source: 'subagent', timestamp: run.startedAt, status: run.status === 'failed' ? 'error' : run.status === 'running' ? 'running' : 'complete', label: run.description || run.agentType || 'Sub-agent run', detail: run.summary ?? run.error, branchId: branch.id, elapsedSeconds: run.usage?.durationMs ? Math.round(run.usage.durationMs / 1000) : undefined });
      }
    }
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const bounded = entries.slice(0, 120);
    return { taskId: nodeId, generatedAt: new Date().toISOString(), entries: bounded, criteria: selected.kind === 'objective' ? selected.successCriteria : selected.successCriteria, stats: { agentActions: bounded.filter((entry) => entry.source === 'agent').length, subagentRuns: bounded.filter((entry) => entry.source === 'subagent').length, branches: new Set(bounded.map((entry) => entry.branchId).filter(Boolean)).size } };
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
    if (/^restrictions\.(?:md|ya?ml)$/i.test(path.basename(relativePath.replace(/\\/g, '/')))) {
      throw new Error('Restrictions must be changed through the controlled restrictions interface');
    }
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
    const installedSkills = installHexestraSkills(sessionPath, this.globalUserPath);
    if (!installedSkills) {
      console.warn('[Session] Hexestra skill resources were not installed');
    }
  }

  private writePttTemplate(sessionPath: string, session: SessionMeta) {
    const skillSource = resolvePentestSkillSource();
    if (skillSource) {
      const template = fs.readFileSync(path.join(skillSource, 'ptt-template.md'), 'utf8');
      const ptt = template
        .replaceAll('{TARGET}', session.scope?.allowRules[0] ?? session.scope?.excludeRules[0] ?? session.name)
        .replaceAll('{STARTED}', session.createdAt)
        .replaceAll('{UPDATED}', session.updatedAt)
        .replaceAll('{OPSEC_LEVEL}', session.opsecLevel)
        .replaceAll('{AUTONOMY_LEVEL}', session.autonomyLevel);
      fs.writeFileSync(path.join(sessionPath, 'ptt.md'), ptt, 'utf8');
      return;
    }
    const ptt = [
      `# Pentest Task Tree — ${session.name}`,
      '',
      `**Target:** ${session.name} | **Started:** ${session.createdAt} | **Updated:** ${session.updatedAt}`,
      `**Framework:** MITRE ATT&CK Enterprise v${ATTACK_CATALOG_VERSION}`,
      `**OPSEC Level:** ${session.opsecLevel}`,
      `**Autonomy Level:** ${session.autonomyLevel}`,
      '',
      'This file stores ATT&CK Technique-bound technical tasks. Scope, evidence, reporting, and disengagement remain managed elsewhere.',
      '',
      ...ATTACK_TACTICS.flatMap((tactic) => [`## ${tactic.id} ${tactic.name}`, '', `<!-- tactic: ${tactic.id} -->`, '']),
    ].join('\n');
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

function sameCriterionDefinitions(
  left: Array<{ id: string; text: string }>,
  right: Array<{ id: string; text: string }>,
) {
  return left.length === right.length
    && left.every((criterion, index) => criterion.id === right[index]?.id && criterion.text === right[index]?.text);
}

function sameCriterionCompletion(
  left: Array<{ id: string; completed: boolean }>,
  right: Array<{ id: string; completed: boolean }>,
) {
  return left.length === right.length
    && left.every((criterion, index) => criterion.id === right[index]?.id && criterion.completed === right[index]?.completed);
}

function isLegacyProjectState(value: unknown): value is { version: number } {
  return Boolean(value && typeof value === 'object' && 'version' in value && typeof (value as { version?: unknown }).version === 'number' && (value as { version: number }).version < 10);
}

function stripLegacyHistory(state: ProjectState, repository: AgentHistoryRepository): ProjectState {
  return normalizeProjectState({
    ...state,
    version: 10,
    history: { storage: 'jsonl', formatVersion: 1 },
    agent: {
      ...state.agent,
      branches: state.agent.branches.map((branch) => {
        const messages = repository.getMessages(branch.id);
        const subagentRuns = repository.getSubagentRuns(branch.id);
        const { messages: _messages, subagentRuns: _subagentRuns, ...metadata } = branch;
        return {
          ...metadata,
          history: {
            messageCount: messages.length,
            activityCount: messages.reduce((sum, message) => sum + (message.activities?.length ?? 0), 0),
            subagentRunCount: subagentRuns.length,
            lastMessageId: messages.at(-1)?.id,
            lastMessageAt: messages.at(-1)?.timestamp,
          },
        };
      }),
    },
  });
}

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

function hasDependencyCycle(task: PentestTask, tasks: PentestTask[]) {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const candidate = byId.get(id);
    const cycle = Boolean(candidate && candidate.dependsOnTaskIds.some(visit));
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  return visit(task.id);
}

function matchPriority(match: string) {
  return match === 'preferred' ? 0 : match === 'technique' ? 1 : match === 'capability' ? 2 : match === 'tactic' ? 3 : 4;
}

function projectTargetScope(target: Target, scope: SessionMeta['scope']): Target {
  return {
    ...target,
    scopeAnnotation: scopeAnnotationForValues(
      scope,
      [target.id, target.ip, target.hostname, ...target.domains],
    ),
  };
}

function projectAssetScope(asset: AssetRecord, scope: SessionMeta['scope']): AssetRecord {
  const semanticValue = asset.key.slice(asset.key.indexOf(':') + 1);
  return {
    ...asset,
    scopeAnnotation: scopeAnnotationForValues(scope, [asset.id, semanticValue, asset.label, ...Object.values(asset.properties).flatMap((value) => Array.isArray(value) ? value : [String(value)])]),
  };
}

function projectAssetsScope(
  assets: AssetRecord[],
  targets: Target[],
  relations: GraphRelation[],
  scope: SessionMeta['scope'],
) {
  const rawById = new Map(assets.map((asset) => [asset.id, asset]));
  const projected = new Map(assets.map((asset) => [asset.id, projectAssetScope(asset, scope)]));
  const annotatedIds = new Set<string>(
    [...projected.values()].filter((asset) => Boolean(asset.scopeAnnotation)).map((asset) => asset.id),
  );

  for (let pass = 0; pass < assets.length + 1; pass += 1) {
    let changed = false;
    for (const edge of relations) {
      if (edge.type !== 'belongs_to') continue;
      const childId = edge.source;
      const parentId = edge.target;
      {
        const child = rawById.get(childId);
        const parent = projected.get(parentId);
        if (!child || !parent?.scopeAnnotation || annotatedIds.has(childId)) continue;
        projected.set(childId, { ...child, scopeAnnotation: parent.scopeAnnotation });
        annotatedIds.add(childId);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return assets.map((asset) => projected.get(asset.id)!);
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
