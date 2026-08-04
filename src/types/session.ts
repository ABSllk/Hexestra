export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived';
export type OpsecLevel = 'stealth' | 'balanced' | 'loud';
export type AutonomyLevel = 'low' | 'medium' | 'high';

import type { SessionScopePayload } from '@electron/contracts/session';

export type SessionScope = SessionScopePayload;

export interface RulesOfEngagement {
  testingWindow: { start: string; end: string };
  threatModel: string;
  dataHandling: string;
  contactInfo: string;
  prohibitedActions: string[];
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  scope?: SessionScope;
  roe?: RulesOfEngagement;
  opsecLevel: OpsecLevel;
  autonomyLevel: AutonomyLevel;
  basePath: string;
  targetCount: number;
  findingCount: number;
  vulnerabilityCount: number;
}

export interface SessionSummary {
  id: string;
  name: string;
  basePath: string;
  status: SessionStatus;
  targetCount: number;
  findingCount: number;
  vulnerabilityCount: number;
  updatedAt: string;
}

export interface SessionFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

export interface SessionFileContent {
  path: string;
  content: string;
  modifiedAt: string;
}
