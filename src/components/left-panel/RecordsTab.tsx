import { useMemo, useState } from 'react';
import { ContextMenu, useConfirmDialog, type ContextMenuItem } from '@/components/shared';
import { useNetMapStore, useSessionStore, useTabStore } from '@/stores';
import { openRecordTab } from '@/stores/useTabStore';
import { RECORDS_IPC, type RecordExportResult } from '@electron/contracts/records';
import type { AsmFinding, EvidenceRecord, ManagedRecordKind, ReportRecord, VulnerabilityRecord } from '@/types';
import { FindingsTab } from './FindingsTab';
import { VulnerabilitiesTab } from './VulnerabilitiesTab';

type RecordView = 'findings' | 'vulnerabilities' | 'evidence' | 'reports';
type ManagedRecord = AsmFinding | VulnerabilityRecord | EvidenceRecord | ReportRecord;
type RecordMenuState = { kind: ManagedRecordKind; recordId: string; x: number; y: number; target: HTMLButtonElement };

export function RecordsTab() {
  const [view, setView] = useState<RecordView>('findings');
  const findings = useSessionStore((state) => state.findings);
  const vulnerabilities = useSessionStore((state) => state.vulnerabilities);
  const evidence = useSessionStore((state) => state.evidenceRecords);
  const reports = useSessionStore((state) => state.reports);
  const deleteManagedRecord = useSessionStore((state) => state.deleteManagedRecord);
  const confirm = useConfirmDialog();
  const [menu, setMenu] = useState<RecordMenuState | null>(null);
  const items: Array<{ id: RecordView; label: string; count: number }> = [
    { id: 'evidence', label: 'Evidence', count: evidence.length },
    { id: 'findings', label: 'Findings', count: findings.length },
    { id: 'vulnerabilities', label: 'Vulns', count: vulnerabilities.length },
    { id: 'reports', label: 'Reports', count: reports.length },
  ];
  const selectedRecord = menu ? findManagedRecord(menu.kind, menu.recordId, findings, vulnerabilities, evidence, reports) : null;
  const openSelectedRecord = () => {
    if (menu && selectedRecord) openManagedRecord(menu.kind, selectedRecord);
  };
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu || !selectedRecord) return [];
    return [
      { id: 'open', label: 'Open details', onSelect: openSelectedRecord },
      {
        id: 'copy-json',
        label: 'Copy as JSON',
        separatorBefore: true,
        onSelect: () => window.hexestra.invoke('clipboard:write-text', JSON.stringify(selectedRecord, null, 2)),
      },
      {
        id: 'export',
        label: 'Export Markdown…',
        onSelect: () => {
          const projectId = useSessionStore.getState().currentSession?.id;
          if (!projectId) return;
          return window.hexestra.invoke<RecordExportResult>(RECORDS_IPC.EXPORT, projectId, menu.kind, menu.recordId);
        },
      },
      {
        id: 'delete',
        label: `Delete ${recordKindLabel(menu.kind)}`,
        separatorBefore: true,
        danger: true,
        onSelect: async () => {
          const approved = await confirm(deleteConfirmation(menu.kind, selectedRecord.title));
          if (!approved) return;
          if (await deleteManagedRecord(menu.kind, menu.recordId)) closeManagedRecordTabs(menu.kind, menu.recordId);
        },
      },
    ];
  }, [confirm, deleteManagedRecord, menu, selectedRecord]);
  const showMenu = (kind: ManagedRecordKind) => (event: React.MouseEvent<HTMLButtonElement>, recordId: string) => {
    event.preventDefault();
    setMenu({ kind, recordId, x: event.clientX, y: event.clientY, target: event.currentTarget });
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className="grid shrink-0 grid-cols-4 gap-0.5 border-b border-surface bg-bg-tertiary/50 p-1.5">
      {items.map((item) => <button key={item.id} aria-label={`${item.label} ${item.count}`} onClick={() => setView(item.id)} className={`ui-segmented-item flex items-center justify-center gap-1 whitespace-nowrap px-1 py-1.5 text-[9px] ${view === item.id ? 'ui-segmented-item-active' : ''}`}><span>{item.label}</span><span className="font-mono opacity-65">{item.count}</span></button>)}
    </div>
    <div className="min-h-0 flex-1">
      {view === 'findings' && <FindingsTab showHeader={false} onRecordContextMenu={showMenu('finding')} />}
      {view === 'vulnerabilities' && <VulnerabilitiesTab onRecordContextMenu={showMenu('vulnerability')} />}
      {view === 'evidence' && <EvidenceRecords records={evidence} onRecordContextMenu={showMenu('evidence')} />}
      {view === 'reports' && <ReportRecords records={reports} onRecordContextMenu={showMenu('report')} />}
    </div>
    <ContextMenu open={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} items={menuItems} returnFocus={menu?.target} onClose={() => setMenu(null)} />
  </div>;
}

function EvidenceRecords({ records, onRecordContextMenu }: { records: EvidenceRecord[]; onRecordContextMenu: (event: React.MouseEvent<HTMLButtonElement>, recordId: string) => void }) {
  const nodes = useNetMapStore((state) => state.nodes);
  const selectNode = useNetMapStore((state) => state.selectNode);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node.label])), [nodes]);
  return <RecordList empty="No evidence records yet." rows={records.map((record) => ({ id: record.id, title: record.title, meta: `${nodeById.get(record.assetId) ?? record.assetId} / ${record.tool}`, badge: record.kind }))} onSelect={(id) => { const record = records.find((candidate) => candidate.id === id); if (record) { selectNode(record.assetId); openRecordTab('evidence', record.id, record.title); } }} onRecordContextMenu={onRecordContextMenu} />;
}

function ReportRecords({ records, onRecordContextMenu }: { records: ReportRecord[]; onRecordContextMenu: (event: React.MouseEvent<HTMLButtonElement>, recordId: string) => void }) {
  return <RecordList empty="No reports yet." rows={records.map((record) => ({ id: record.id, title: record.title, meta: record.summary || formatTime(record.updatedAt), badge: record.status }))} onSelect={(id) => { const record = records.find((candidate) => candidate.id === id); if (record) openRecordTab('report', record.id, record.title); }} onRecordContextMenu={onRecordContextMenu} />;
}

function RecordList({ rows, empty, onSelect, onRecordContextMenu }: { rows: Array<{ id: string; title: string; meta: string; badge: string }>; empty: string; onSelect: (id: string) => void; onRecordContextMenu: (event: React.MouseEvent<HTMLButtonElement>, recordId: string) => void }) {
  return <div className="h-full overflow-y-auto p-1.5">{rows.length === 0 ? <div className="p-4 text-center text-2xs text-text-muted">{empty}</div> : rows.map((row) => <button key={row.id} onClick={() => onSelect(row.id)} onContextMenu={(event) => onRecordContextMenu(event, row.id)} className="ui-hover-row mb-1 w-full px-2.5 py-2 text-left"><div className="mb-1 flex items-start justify-between gap-2"><span className="text-2xs font-medium leading-relaxed text-text-primary">{row.title}</span><span className="rounded-md bg-accent-teal/5 px-1 font-mono text-[8px] uppercase text-accent-teal">{row.badge}</span></div><div className="truncate font-mono text-[8px] text-text-muted">{row.meta}</div></button>)}</div>;
}

function findManagedRecord(kind: ManagedRecordKind, id: string, findings: AsmFinding[], vulnerabilities: VulnerabilityRecord[], evidence: EvidenceRecord[], reports: ReportRecord[]): ManagedRecord | null {
  const records = kind === 'finding' ? findings : kind === 'vulnerability' ? vulnerabilities : kind === 'evidence' ? evidence : reports;
  return records.find((record) => record.id === id) ?? null;
}

function openManagedRecord(kind: ManagedRecordKind, record: ManagedRecord) {
  if ('assetId' in record && record.assetId) useNetMapStore.getState().selectNode(record.assetId);
  openRecordTab(kind, record.id, record.title);
}

function closeManagedRecordTabs(kind: ManagedRecordKind, recordId: string) {
  const store = useTabStore.getState();
  store.tabs.filter((tab) => tab.type === 'record' && tab.data?.recordKind === kind && tab.data?.recordId === recordId)
    .forEach((tab) => store.closeTab(tab.id));
}

function recordKindLabel(kind: ManagedRecordKind) {
  return kind === 'finding' ? 'Finding' : kind === 'vulnerability' ? 'Vulnerability' : kind === 'evidence' ? 'Evidence' : 'Report';
}

function deleteConfirmation(kind: ManagedRecordKind, title: string) {
  const label = recordKindLabel(kind);
  const details = kind === 'finding'
    ? 'Links from Vulnerabilities and Reports will be removed. Linked Evidence and Vulnerabilities will be retained.'
    : kind === 'vulnerability'
      ? 'Links from Reports will be removed. Linked Findings and Evidence will be retained.'
      : kind === 'evidence'
        ? 'Links from Findings and Vulnerabilities will be removed. Those records will be retained.'
        : 'Only this Report will be removed. Linked Findings and Vulnerabilities will be retained.';
  return { title: `Delete ${label}?`, description: `Hexestra will permanently delete “${title}”.`, details, confirmLabel: `Delete ${label}`, tone: 'danger' as const };
}

function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
