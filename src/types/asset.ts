import type { TargetStatus } from './target';

export type AssetType =
  | 'domain'
  | 'subnet'
  | 'port'
  | 'service'
  | 'webapp'
  | 'api'
  | 'endpoint'
  | 'parameter'
  | 'certificate'
  | 'identity';

export interface AssetRecord {
  id: string;
  key: string;
  type: AssetType;
  label: string;
  status: TargetStatus;
  properties: Record<string, string | number | boolean | string[]>;
  tags: string[];
  vulnCount: number;
  aiSummary?: string;
  firstSeen: string;
  lastUpdated: string;
}
