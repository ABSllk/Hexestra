export { ATTACK_CATALOG_VERSION, ATTACK_TACTICS, ATTACK_TECHNIQUES } from './attack-catalog-data';
import { ATTACK_TACTICS } from './attack-catalog-data';
import type { ScopeAdvisory } from './session';
import type { ToolCatalogCandidate } from './tool-catalog';

export type AttackTacticId = typeof ATTACK_TACTICS[number]['id'];
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped' | 'failed';
export type TaskNodeKind = 'objective' | 'step';

export interface SuccessCriterion {
  id: string;
  text: string;
  completed: boolean;
}

interface TaskNodeBase {
  id: string;
  kind: TaskNodeKind;
  title: string;
  description: string;
  status: TaskStatus;
  successCriteria: SuccessCriterion[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  diagnostics?: string[];
}

/** ATT&CK-bound user/agent objective. This is the only node that owns scope context. */
export interface PentestObjective extends TaskNodeBase {
  kind: 'objective';
  parentId?: never;
  /** Displayed as an Agent Task under exactly one Technique in the PTT tree. */
  primaryTacticId: string;
  tacticIds: string[];
  /** New tasks must contain exactly one item; the array remains for wire compatibility. */
  techniqueIds: string[];
  /** Canonical v3 metadata stores the single parent relationship explicitly. */
  techniqueId?: string;
  targetAssetIds: string[];
  requiredCapabilities: string[];
  preferredToolIds: string[];
  preferredSkillIds: string[];
  dependsOnTaskIds: string[];
}

/** Agent-authored execution step. Context fields are resolved projections, not persisted metadata. */
export interface ExecutionStep extends TaskNodeBase {
  kind: 'step';
  parentId: string;
  order: number;
  resultSummary?: string;
  blockedReason?: string;
  /** Resolved from the parent objective for renderer/knowledge compatibility. */
  primaryTacticId: string;
  tacticIds: string[];
  techniqueIds: string[];
  targetAssetIds: string[];
  requiredCapabilities: string[];
  preferredToolIds: string[];
  preferredSkillIds: string[];
  dependsOnTaskIds: string[];
}

export type PentestTask = PentestObjective | ExecutionStep;

export interface PentestTaskInput {
  id?: string;
  kind?: 'objective';
  title: string;
  description?: string;
  status?: TaskStatus;
  primaryTacticId?: string;
  /** New tasks must provide exactly one Technique ID. */
  techniqueIds?: [string, ...string[]] | string[];
  targetAssetIds?: string[];
  requiredCapabilities?: string[];
  preferredToolIds?: string[];
  preferredSkillIds?: string[];
  dependsOnTaskIds?: string[];
  /** Deprecated compatibility input; Objective nodes cannot have a parent. */
  parentId?: string;
  successCriteria?: Array<Partial<SuccessCriterion> & Pick<SuccessCriterion, 'text'>>;
}

export interface TaskStepInput {
  id?: string;
  parentId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  order?: number;
  resultSummary?: string;
  blockedReason?: string;
  successCriteria?: Array<Partial<SuccessCriterion> & Pick<SuccessCriterion, 'text'>>;
}

export interface TaskStepPlanInput {
  objectiveId: string;
  steps: Array<Pick<TaskStepInput, 'title' | 'description' | 'order'>>;
}

export interface TaskPlanGroupInput {
  tacticId: string;
  techniqueId: string;
  tasks: Array<Omit<PentestTaskInput, 'primaryTacticId' | 'techniqueIds'> & { title: string; successCriteria: Array<Partial<SuccessCriterion> & Pick<SuccessCriterion, 'text'>> }>;
}

export interface PttParseResult {
  kind: 'ok' | 'legacy_unsupported' | 'invalid';
  tasks: PentestTask[];
  diagnostics: string[];
  catalogVersion?: string;
  metadataVersion?: number;
}

export interface TacticProgress {
  tacticId: string;
  label: string;
  totalTasks: number;
  completedTasks: number;
  status: TaskStatus;
}

export interface TaskContextPackage {
  objective: PentestObjective | null;
  activeStep?: ExecutionStep;
  catalogVersion: string;
  tactic: { id: string; name: string } | null;
  techniques: Array<{ id: string; name: string; tacticIds: string[] }>;
  targets: Array<{ id: string; label: string; status: string; scopeAnnotation?: 'authorized' | 'excluded'; scopeAdvisory?: ScopeAdvisory }>;
  restrictions: Array<{
    id: string;
    ruleIds: string[];
    text: string;
    sources: Array<'global' | 'project'>;
    matchedBy: string[];
  }>;
  skills: Array<{ id: string; name: string; match: 'preferred' | 'technique' | 'capability' | 'tactic' | 'other' }>;
  tools: ToolCatalogCandidate[];
  dependencies: Array<{ id: string; title: string; status: TaskStatus }>;
  blockers: string[];
  notices: Array<{ code: string; message: string; severity: 'info' | 'warning'; targetId?: string }>;
  related: {
    findings: Array<Record<string, unknown>>;
    vulnerabilities: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
  };
}

export type TaskTraceSource = 'task' | 'agent' | 'subagent';
export type TaskTraceStatus = 'pending' | 'running' | 'complete' | 'error' | 'blocked' | 'skipped';

export interface TaskTraceEntry {
  id: string;
  source: TaskTraceSource;
  timestamp: string;
  status: TaskTraceStatus;
  label: string;
  detail?: string;
  toolName?: string;
  branchId?: string;
  branchTitle?: string;
  elapsedSeconds?: number;
}

export interface TaskTracePackage {
  taskId: string;
  generatedAt: string;
  entries: TaskTraceEntry[];
  criteria: SuccessCriterion[];
  stats: { agentActions: number; subagentRuns: number; branches: number };
}
