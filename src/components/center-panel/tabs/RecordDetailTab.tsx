import { MarkdownContent } from '@/components/right-panel/AgentTimelineMessage';
import { useNetMapStore, useSessionStore, useTabStore } from '@/stores';
import { openRecordTab } from '@/stores/useTabStore';
import { isManagedRecordKind } from '@/types';
import type {
  AsmFinding,
  AsmFindingStatus,
  FindingConfidence,
  FindingKind,
  ManagedRecordKind,
  VulnerabilityRecord,
  VulnerabilitySeverity,
  VulnerabilityStatus,
} from '@/types';

const FINDING_KINDS: FindingKind[] = ['observation', 'lead', 'hypothesis', 'behavior', 'access', 'note'];
const FINDING_CONFIDENCES: FindingConfidence[] = ['low', 'medium', 'high'];
const FINDING_STATUSES: AsmFindingStatus[] = ['active', 'used', 'archived'];
const VULNERABILITY_SEVERITIES: VulnerabilitySeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const VULNERABILITY_STATUSES: VulnerabilityStatus[] = ['confirmed', 'remediation', 'resolved', 'accepted'];

export function RecordDetailTab({ tabId }: { tabId: string }) {
  const tab = useTabStore((state) => state.tabs.find((candidate) => candidate.id === tabId));
  const kind = tab?.data?.recordKind;
  const recordId = tab?.data?.recordId;
  if (!isRecordKind(kind) || typeof recordId !== 'string') return <MissingRecord />;
  return <RecordDetail kind={kind} recordId={recordId} />;
}

function RecordDetail({ kind, recordId }: { kind: ManagedRecordKind; recordId: string }) {
  const findings = useSessionStore((state) => state.findings);
  const vulnerabilities = useSessionStore((state) => state.vulnerabilities);
  const evidence = useSessionStore((state) => state.evidenceRecords);
  const reports = useSessionStore((state) => state.reports);
  const upsertFinding = useSessionStore((state) => state.upsertFinding);
  const upsertVulnerability = useSessionStore((state) => state.upsertVulnerability);
  const nodes = useNetMapStore((state) => state.nodes);
  const labels = new Map(nodes.map((node) => [node.id, node.label]));

  if (kind === 'finding') {
    const record = findings.find((item) => item.id === recordId);
    return record
      ? <FindingDetail record={record} assetLabel={record.assetId ? labels.get(record.assetId) ?? record.assetId : 'Project-level'} onUpdate={(update) => void upsertFinding({ ...record, ...update })} />
      : <MissingRecord />;
  }
  if (kind === 'vulnerability') {
    const record = vulnerabilities.find((item) => item.id === recordId);
    return record
      ? <VulnerabilityDetail record={record} assetLabel={labels.get(record.assetId) ?? record.assetId} onUpdate={(update) => void upsertVulnerability({ ...record, ...update })} />
      : <MissingRecord />;
  }
  if (kind === 'evidence') {
    const record = evidence.find((item) => item.id === recordId);
    return record ? <Page title={record.title} eyebrow="Evidence" subtitle={`${labels.get(record.assetId) ?? record.assetId} / ${record.tool} / ${record.kind}`}>
      <Section title="Raw tool output"><pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded border border-surface bg-bg-primary p-4 font-mono text-[11px] leading-5 text-text-secondary">{record.content || 'No raw output.'}</pre></Section>
      <References findingIds={record.findingIds} vulnerabilityIds={record.vulnerabilityIds} />
    </Page> : <MissingRecord />;
  }
  const record = reports.find((item) => item.id === recordId);
  return record ? <Page title={record.title} eyebrow="Report" subtitle={`${record.status} / ${formatTime(record.updatedAt)}`}>
    {record.summary && <Section title="Summary"><p className="text-sm leading-6 text-text-secondary">{record.summary}</p></Section>}
    <Section title="Content"><div className="rounded border border-surface bg-bg-primary/50 p-4 text-sm leading-6 text-text-secondary"><MarkdownContent content={record.content || '_Empty report_'} /></div></Section>
    <References findingIds={record.findingIds} vulnerabilityIds={record.vulnerabilityIds} />
  </Page> : <MissingRecord />;
}

function FindingDetail({ record, assetLabel, onUpdate }: { record: AsmFinding; assetLabel: string; onUpdate: (update: Partial<AsmFinding>) => void }) {
  return <Page title={record.title} eyebrow="Finding" subtitle={assetLabel}>
    <div className="grid max-w-3xl grid-cols-2 gap-3">
      <Select label="Finding kind" value={record.kind} values={FINDING_KINDS} onChange={(value) => onUpdate({ kind: value as FindingKind })} />
      <Select label="Finding confidence" value={record.confidence} values={FINDING_CONFIDENCES} onChange={(value) => onUpdate({ confidence: value as FindingConfidence })} />
    </div>
    <StatusButtons values={FINDING_STATUSES} value={record.status} onChange={(value) => onUpdate({ status: value as AsmFindingStatus })} />
    <TextArea label="Description" value={record.description} onChange={(description) => onUpdate({ description })} />
    <References evidenceIds={record.evidenceIds} />
  </Page>;
}

function VulnerabilityDetail({ record, assetLabel, onUpdate }: { record: VulnerabilityRecord; assetLabel: string; onUpdate: (update: Partial<VulnerabilityRecord>) => void }) {
  return <Page title={record.title} eyebrow="Vulnerability" subtitle={assetLabel}>
    <div className="grid max-w-3xl grid-cols-2 gap-3">
      <Select label="Vulnerability severity" value={record.severity} values={VULNERABILITY_SEVERITIES} onChange={(value) => onUpdate({ severity: value as VulnerabilitySeverity })} />
      <Select label="Vulnerability status" value={record.status} values={VULNERABILITY_STATUSES} onChange={(value) => onUpdate({ status: value as VulnerabilityStatus })} />
    </div>
    <div className="grid max-w-3xl grid-cols-3 gap-3 text-xs text-text-muted">
      <Meta label="CVE" value={record.cve} /><Meta label="CWE" value={record.cwe} /><Meta label="CVSS" value={record.cvss?.toString()} />
    </div>
    <TextArea label="Description" value={record.description} onChange={(description) => onUpdate({ description })} />
    <TextArea label="Impact" value={record.impact} onChange={(impact) => onUpdate({ impact })} />
    <TextArea label="Remediation" value={record.remediation} onChange={(remediation) => onUpdate({ remediation })} />
    <References findingIds={record.findingIds} evidenceIds={record.evidenceIds} />
  </Page>;
}

function Page({ title, eyebrow, subtitle, children }: { title: string; eyebrow: string; subtitle: string; children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto bg-bg-secondary px-8 py-7">
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="border-b border-surface pb-5"><div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-teal">{eyebrow}</div><h1 className="text-xl font-semibold text-text-primary">{title}</h1><div className="mt-2 font-mono text-[10px] text-text-muted">{subtitle}</div></header>
      {children}
    </div>
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section><h2 className="mb-2 text-[10px] uppercase tracking-widest text-text-muted">{title}</h2>{children}</section>; }
function Select({ label, value, values, onChange }: { label: string; value: string; values: readonly string[]; onChange: (value: string) => void }) { return <label><span className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded border border-surface bg-bg-primary px-2 text-xs text-text-secondary">{values.map((item) => <option key={item}>{item}</option>)}</select></label>; }
function StatusButtons({ values, value, onChange }: { values: readonly string[]; value: string; onChange: (value: string) => void }) { return <div className="flex flex-wrap gap-2">{values.map((item) => <button key={item} onClick={() => onChange(item)} className={`rounded border px-3 py-1.5 text-[10px] uppercase ${item === value ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-surface text-text-muted hover:text-text-secondary'}`}>{item}</button>)}</div>; }
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block max-w-4xl"><span className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">{label}</span><textarea aria-label={label} defaultValue={value} onBlur={(event) => { if (event.target.value !== value) onChange(event.target.value); }} rows={5} className="w-full resize-y rounded border border-surface bg-bg-primary p-3 text-sm leading-6 text-text-secondary outline-none focus:border-accent-blue/50" /></label>; }
function Meta({ label, value }: { label: string; value?: string }) { return <div className="rounded border border-surface bg-bg-primary/50 p-3"><div className="mb-1 text-[9px] uppercase">{label}</div><div className="font-mono text-text-secondary">{value || '—'}</div></div>; }
function References({ findingIds = [], vulnerabilityIds = [], evidenceIds = [] }: { findingIds?: string[]; vulnerabilityIds?: string[]; evidenceIds?: string[] }) {
  const findings = useSessionStore((state) => state.findings);
  const vulnerabilities = useSessionStore((state) => state.vulnerabilities);
  const evidence = useSessionStore((state) => state.evidenceRecords);
  const groups = [
    { label: 'Findings', kind: 'finding' as const, ids: findingIds, titles: new Map(findings.map((record) => [record.id, record.title])) },
    { label: 'Vulnerabilities', kind: 'vulnerability' as const, ids: vulnerabilityIds, titles: new Map(vulnerabilities.map((record) => [record.id, record.title])) },
    { label: 'Evidence', kind: 'evidence' as const, ids: evidenceIds, titles: new Map(evidence.map((record) => [record.id, record.title])) },
  ];
  return <div className="space-y-2">{groups.filter(({ ids }) => ids.length > 0).map(({ label, kind, ids, titles }) => <div key={label}>
    <div className="mb-1 text-[9px] uppercase tracking-wide text-text-muted">Linked {label}</div>
    <div className="flex flex-wrap gap-1">{ids.map((id) => {
      const title = titles.get(id);
      return title
        ? <button key={id} onClick={() => openRecordTab(kind, id, title)} className="rounded border border-surface bg-bg-primary px-2 py-1 text-left text-[10px] text-accent-blue hover:border-accent-blue/40 hover:bg-accent-blue/10">{title}</button>
        : <span key={id} className="rounded border border-surface bg-bg-primary px-2 py-1 text-[10px] text-text-muted">Unavailable record</span>;
    })}</div>
  </div>)}</div>;
}
function MissingRecord() { return <div className="flex h-full items-center justify-center text-sm text-text-muted">This record is no longer available in the current project.</div>; }
const isRecordKind = isManagedRecordKind;
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
