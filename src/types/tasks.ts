export type PentestStage =
  | 'S0'
  | 'S1'
  | 'S2'
  | 'S3'
  | 'S4'
  | 'S5'
  | 'S6'
  | 'S7'
  | 'S8'
  | 'disengage';

export const STAGE_META: Record<PentestStage, { label: string; mitreId: string; description: string }> = {
  S0:  { label: 'Pre-Engagement',       mitreId: '—',      description: 'Scope, RoE, and engagement setup' },
  S1:  { label: 'Passive Reconnaissance', mitreId: 'TA0043', description: 'Passive information gathering and OSINT' },
  S2:  { label: 'Active Scanning',      mitreId: 'TA0043', description: 'Active discovery, enumeration, and fingerprinting' },
  S3:  { label: 'Initial Access',       mitreId: 'TA0001', description: 'Gain foothold on target systems' },
  S4:  { label: 'Execution & Persistence', mitreId: 'TA0002/3', description: 'Execute approved actions and assess persistence' },
  S5:  { label: 'Privilege & Evasion',  mitreId: 'TA0004/5', description: 'Review privilege boundaries and defensive controls' },
  S6:  { label: 'Credential & Discovery', mitreId: 'TA0006/7', description: 'Assess credentials and discover internal assets' },
  S7:  { label: 'Lateral & Collection', mitreId: 'TA0008/9', description: 'Map lateral movement and approved collection paths' },
  S8:  { label: 'Impact & Objectives',  mitreId: 'TA0040', description: 'Validate authorized engagement objectives' },
  disengage: { label: 'Disengagement',   mitreId: '—',      description: 'Cleanup and reporting' },
};

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped' | 'failed';

export interface PentestTask {
  id: string;
  stage: PentestStage;
  title: string;
  description: string;
  status: TaskStatus;
  parentId?: string;
  toolIds: string[];
  commands: string[];
  findingIds: string[];
  chainId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PentestTaskInput {
  id?: string;
  stage: PentestStage;
  title: string;
  description?: string;
  status?: TaskStatus;
  parentId?: string;
}

export interface StageProgress {
  stage: PentestStage;
  label: string;
  mitreId: string;
  totalTasks: number;
  completedTasks: number;
  status: TaskStatus;
}

export interface AttackChain {
  id: string;
  name: string;
  description: string;
  steps: ChainStep[];
}

export interface ChainStep {
  taskId: string;
  targetId: string;
  findingId?: string;
  order: number;
}
