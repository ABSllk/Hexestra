export type AssetChangeKind = 'asset_added' | 'endpoint_added' | 'endpoint_changed' | 'asset_updated';
export type FindingKind = 'observation' | 'lead' | 'hypothesis' | 'behavior' | 'access' | 'note';
export type FindingConfidence = 'low' | 'medium' | 'high';
export type AsmFindingStatus = 'active' | 'used' | 'archived';
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type VulnerabilityStatus = 'confirmed' | 'remediation' | 'resolved' | 'accepted';

export interface ScanRunRecord {
  id: string;
  tool: string;
  sourceAssetId?: string;
  startedAt: string;
  completedAt: string;
  changeCount: number;
}

export interface AssetChangeRecord {
  id: string;
  scanRunId: string;
  assetId?: string;
  kind: AssetChangeKind;
  field?: string;
  label: string;
  before?: string;
  after?: string;
  observedAt: string;
}

export interface AsmFinding {
  id: string;
  assetId?: string;
  title: string;
  kind: FindingKind;
  confidence: FindingConfidence;
  status: AsmFindingStatus;
  description: string;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type AsmFindingInput = Partial<AsmFinding> & Pick<AsmFinding, 'title'>;

export interface VulnerabilityRecord {
  id: string;
  assetId: string;
  title: string;
  severity: VulnerabilitySeverity;
  status: VulnerabilityStatus;
  description: string;
  impact: string;
  remediation: string;
  cve?: string;
  cwe?: string;
  cvss?: number;
  findingIds: string[];
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type VulnerabilityInput = Partial<VulnerabilityRecord>
  & Pick<VulnerabilityRecord, 'assetId' | 'title'>;

export interface EvidenceRecord {
  id: string;
  assetId: string;
  sourceAssetId?: string;
  title: string;
  tool: string;
  kind: string;
  content: string;
  findingIds: string[];
  vulnerabilityIds: string[];
  observedAt: string;
  updatedAt: string;
}

export type EvidenceInput = Partial<EvidenceRecord> & Pick<EvidenceRecord, 'assetId' | 'title' | 'tool' | 'content'>;

export type ReportStatus = 'draft' | 'final';

export interface ReportRecord {
  id: string;
  title: string;
  status: ReportStatus;
  summary: string;
  content: string;
  findingIds: string[];
  vulnerabilityIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type ReportInput = Partial<ReportRecord> & Pick<ReportRecord, 'title' | 'content'>;
