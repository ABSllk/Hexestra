import type { RestrictionSelector } from '../services/restriction.service';

export const KNOWLEDGE_REFINERY_IPC = {
  SOURCES_LIST: 'refinery:sources:list',
  SOURCES_READ: 'refinery:sources:read',
  SOURCES_PREVIEW: 'refinery:sources:preview',
  SOURCES_IMPORT: 'refinery:sources:import',
  SOURCES_DELETE: 'refinery:sources:delete',
  JOBS_LIST: 'refinery:jobs:list',
  JOBS_READ: 'refinery:jobs:read',
  JOBS_CREATE_FROM_SOURCE: 'refinery:jobs:create-from-source',
  JOBS_CREATE_FROM_CONVERSATION: 'refinery:jobs:create-from-conversation',
  JOBS_CANCEL: 'refinery:jobs:cancel',
  JOBS_RETRY: 'refinery:jobs:retry',
  JOBS_DELETE: 'refinery:jobs:delete',
  JOBS_DEBUG: 'refinery:jobs:debug',
  CANDIDATES_PAGE: 'refinery:candidates:page',
  CANDIDATES_READ: 'refinery:candidates:read',
  CANDIDATES_UPDATE: 'refinery:candidates:update',
  CANDIDATES_APPLY: 'refinery:candidates:apply',
} as const;

export type RefinerySourceKind = 'document' | 'conversation';
export type RefineryDocumentFormat = 'text' | 'markdown' | 'code' | 'pdf' | 'docx';
export type RefineryOutputKind = 'restriction' | 'skill' | 'workflow';
export type RefineryJobStatus =
  | 'queued'
  | 'extracting'
  | 'analyzing'
  | 'review_required'
  | 'partially_applied'
  | 'applied'
  | 'failed'
  | 'canceled';
export type RefineryCandidateDecision = 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';
export type RefineryDedupeAction = 'create' | 'update' | 'merge' | 'skip';
export type RefineryDebugKind = 'status' | 'stream' | 'result' | 'error';

export interface SourceAnchor {
  kind: 'line' | 'paragraph' | 'page' | 'message';
  label: string;
  excerpt?: string;
  messageId?: string;
}

export interface KnowledgeSource {
  id: string;
  kind: RefinerySourceKind;
  name: string;
  fingerprint: string;
  format?: RefineryDocumentFormat;
  size?: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  branchId?: string;
  messageIds?: string[];
  sourceAvailable: boolean;
  diagnostics: string[];
}

export interface RefineryRestrictionCandidate {
  text: string;
  selector: RestrictionSelector;
  enabled: boolean;
}

export interface RefinerySkillCandidate {
  name: string;
  description: string;
  content: string;
  metadata: Record<string, string>;
}

export interface RefineryWorkflowCandidate {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  body: string;
}

export type RefineryCandidatePayload =
  | RefineryRestrictionCandidate
  | RefinerySkillCandidate
  | RefineryWorkflowCandidate;

export interface RefineryDedupe {
  action: RefineryDedupeAction;
  targetId?: string;
  expectedFingerprint?: string;
  reason: string;
}

export interface RefineryCandidateSummary {
  id: string;
  kind: RefineryOutputKind;
  title: string;
  confidence: number;
  suggestedScope?: 'global' | 'project';
  dedupe: RefineryDedupe;
  decision: RefineryCandidateDecision;
  diagnostic?: string;
}

export interface RefineryCandidate extends RefineryCandidateSummary {
  rationale: string;
  anchors: SourceAnchor[];
  payload: RefineryCandidatePayload;
}

export interface RefineryJobProgress {
  phase: string;
  completed: number;
  total: number;
}

export interface RefineryJobSummary {
  id: string;
  source: KnowledgeSource;
  requestedOutputs: RefineryOutputKind[];
  status: RefineryJobStatus;
  progress: RefineryJobProgress;
  modelSnapshot: string;
  candidateCounts: Record<RefineryOutputKind | 'pending' | 'applied' | 'failed', number>;
  diagnostics: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RefineryJob extends RefineryJobSummary {
  ignoredSummary: string[];
}

export interface RefineryPage<T> {
  items: T[];
  beforeCursor: string | null;
  hasEarlier: boolean;
  total: number;
}

export interface RefinerySourcePreviewPage extends RefineryPage<{ anchor: SourceAnchor; text: string }> {}

export interface RefineryInvocation {
  jobId: string;
  sourceKind: RefinerySourceKind;
  sourceName: string;
}

export interface RefineryCandidateUpdateInput {
  title?: string;
  rationale?: string;
  suggestedScope?: 'global' | 'project';
  decision?: Exclude<RefineryCandidateDecision, 'applied' | 'failed'>;
  payload?: RefineryCandidatePayload;
}

export interface RefineryApplyResult {
  applied: Array<{ candidateId: string; kind: RefineryOutputKind; artifactId: string }>;
  failed: Array<{ candidateId: string; message: string }>;
}

export interface RefineryAnalysisRequest {
  cwd: string;
  projectId: string;
  sourceName: string;
  chunks: Array<{ anchor: SourceAnchor; text: string }>;
  existing: {
    restrictions: Array<{ id: string; scope: 'global' | 'project'; text: string; selector: RestrictionSelector; fingerprint: string }>;
    skills: Array<{ name: string; scope: 'global' | 'project'; description: string; metadata: Record<string, string>; fingerprint: string }>;
    workflows: Array<{ id: string; name: string; description: string; fingerprint: string }>;
  };
  signal?: AbortSignal;
  attempt?: number;
  onDebug?: (entry: RefineryDebugEntry) => void;
}

export interface RefineryAnalysisResult {
  candidates: RefineryCandidate[];
  ignoredSummary: string[];
}

/**
 * A bounded, task-local trace of the provider's visible text. It deliberately
 * excludes source prompts, tool output, and private thinking blocks.
 */
export interface RefineryDebugEntry {
  at: string;
  attempt: number;
  chunkIndex: number;
  anchor: SourceAnchor;
  kind: RefineryDebugKind;
  text: string;
}

export interface RefineryDebugLog {
  items: RefineryDebugEntry[];
  total: number;
  truncated: boolean;
}
