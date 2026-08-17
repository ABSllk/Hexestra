import { isManagedRecordKind } from '@/types';
import type {
  AsmFinding,
  ContextTab,
  EvidenceRecord,
  ReportRecord,
  VulnerabilityRecord,
} from '@/types';

interface RecordContextTab {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface ManagedRecordContextSource {
  findings: AsmFinding[];
  vulnerabilities: VulnerabilityRecord[];
  evidenceRecords: EvidenceRecord[];
  reports: ReportRecord[];
}

export function buildSelectedRecordContextTab(
  activeTab: RecordContextTab | null | undefined,
  source: ManagedRecordContextSource,
): Omit<ContextTab, 'isShared'> | null {
  if (activeTab?.type !== 'record') return null;

  const recordKind = activeTab.data?.recordKind;
  const recordId = activeTab.data?.recordId;
  if (!isManagedRecordKind(recordKind) || typeof recordId !== 'string') return null;

  const records = recordKind === 'finding'
    ? source.findings
    : recordKind === 'vulnerability'
      ? source.vulnerabilities
      : recordKind === 'evidence'
        ? source.evidenceRecords
        : source.reports;
  const record = records.find((candidate) => candidate.id === recordId);
  if (!record) return null;

  return {
    tabId: activeTab.id,
    title: record.title,
    type: 'record',
    contentPreview: `${JSON.stringify({ recordKind, ...record }, null, 2)}\nRecord locator: ${recordKind}:${record.id}`,
  };
}
