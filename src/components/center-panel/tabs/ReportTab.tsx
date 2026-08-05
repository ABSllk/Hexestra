import { useEffect, useMemo } from 'react';
import { Icon } from '@/components/shared';
import { useChatStore, usePentestTreeStore, useSessionStore, useTabStore } from '@/stores';
import type { AsmFinding, VulnerabilityRecord } from '@/types';

export function ReportTab({ tabId }: { tabId: string }) {
  const session = useSessionStore((state) => state.currentSession);
  const targets = useSessionStore((state) => state.targets);
  const findings = useSessionStore((state) => state.findings);
  const vulnerabilities = useSessionStore((state) => state.vulnerabilities);
  const tasks = usePentestTreeStore((state) => state.tasks);
  const updateTabData = useTabStore((state) => state.updateTabData);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const isProcessing = useChatStore((state) => state.isProcessing);
  const report = useMemo(
    () => buildReport(session?.name ?? 'Untitled Engagement', targets, tasks, findings, vulnerabilities),
    [session?.name, targets, tasks, findings, vulnerabilities],
  );

  useEffect(() => {
    updateTabData(tabId, { contentPreview: report });
  }, [report, tabId, updateTabData]);

  const generateFormalReport = async () => {
    if (!session) return;
    await sendMessage(
      `Use $hexestra-report to create or update the formal final report for "${session.name}" `
      + 'from the current Hexestra managed records. Do not save or finalize it if required '
      + 'vulnerability reproduction information is missing.',
    );
  };

  return <div className="flex h-full min-h-0 flex-col bg-bg-primary">
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-surface bg-bg-tertiary/70 px-3">
      <span className="text-xs font-medium text-text-secondary">Live engagement preview</span>
      <button disabled={!session || isProcessing} onClick={() => void generateFormalReport()} className="flex items-center gap-1 rounded border border-surface px-2 py-1 text-2xs text-text-muted hover:border-accent-blue hover:text-accent-blue disabled:opacity-40"><Icon name="report" size={12} />{isProcessing ? 'Agent working…' : 'Generate with AI'}</button>
    </div>
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-6 font-sans text-xs leading-6 text-text-secondary">{report}</pre>
  </div>;
}

export function buildReport(
  name: string,
  targets: Array<{ ip: string; hostname?: string; status: string; ports: Array<{ port: number; protocol: string; state: string; service?: string; version?: string }>; aiSummary?: string }>,
  tasks: Array<{ title: string; status: string }>,
  findings: AsmFinding[],
  vulnerabilities: VulnerabilityRecord[],
) {
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const lines = [`# ${name}`, '', `Generated: ${new Date().toLocaleString()}`, '', '## Executive summary', '', `${targets.length} assets are tracked. ${completed} of ${tasks.length} planned tasks are complete.`, '', '## Asset inventory', ''];
  for (const target of targets) {
    lines.push(`### ${target.hostname ? `${target.hostname} (${target.ip})` : target.ip}`, '', `Status: ${target.status}`);
    const ports = target.ports.filter((port) => port.state === 'open');
    lines.push(ports.length ? `Open services: ${ports.map((port) => `${port.port}/${port.protocol} ${port.service ?? ''} ${port.version ?? ''}`.trim()).join(', ')}` : 'Open services: none recorded');
    if (target.aiSummary) lines.push('', target.aiSummary);
    lines.push('');
  }
  lines.push('## Task progress', '');
  for (const task of tasks) lines.push(`- [${task.status === 'completed' ? 'x' : ' '}] ${task.title} — ${task.status}`);
  lines.push('', '## Findings', '');
  if (findings.length === 0) lines.push('No reusable findings have been recorded yet.');
  else for (const finding of findings) lines.push(`- **${finding.title}** (${finding.kind}, ${finding.confidence}, ${finding.status})${finding.description ? ` — ${finding.description}` : ''}`);
  lines.push('', '## Vulnerabilities', '');
  if (vulnerabilities.length === 0) lines.push('No validated vulnerabilities have been recorded yet.');
  else for (const vulnerability of vulnerabilities) lines.push(
    `### ${vulnerability.title}`,
    '',
    `Severity: ${vulnerability.severity} · Status: ${vulnerability.status}`,
    '',
    '#### Vulnerability Description',
    '',
    vulnerability.description || 'No description recorded.',
    '',
    '#### Reproduction Steps',
    '',
    reproductionSteps(vulnerability.description),
    '',
    `Impact: ${vulnerability.impact || 'Not recorded.'}`,
    '',
    `Remediation: ${vulnerability.remediation || 'Not recorded.'}`,
    '',
  );
  return lines.join('\n');
}

function reproductionSteps(description: string) {
  const value = description.trim();
  if (!value) return '1. Reproduction steps are missing from this legacy Vulnerability record and must be completed before finalizing the report.';
  return /^\s*\d+[.)]\s/m.test(value) ? value : `1. ${value}`;
}
