import type { ManagedRecordKind } from '../contracts/records';
import type {
  EvidenceRecord,
  FindingRecord,
  ReportRecord,
  VulnerabilityRecord,
} from './asset-graph.repository';

export type ManagedRecord = FindingRecord | VulnerabilityRecord | EvidenceRecord | ReportRecord;

export function managedRecordFilename(kind: ManagedRecordKind, title: string) {
  const safeTitle = title.trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return `${safeTitle || kind}.md`;
}

export function managedRecordMarkdown(kind: ManagedRecordKind, record: ManagedRecord) {
  if (kind === 'finding') {
    const finding = record as FindingRecord;
    return join([
      `# ${finding.title}`,
      `- Type: ${finding.kind}`,
      `- Confidence: ${finding.confidence}`,
      `- Status: ${finding.status}`,
      `- Asset: ${finding.assetId ?? 'Project-level'}`,
      `- Updated: ${finding.updatedAt}`,
      '## Description',
      finding.description || 'Not recorded.',
      '## Evidence IDs',
      list(finding.evidenceIds),
    ]);
  }
  if (kind === 'vulnerability') {
    const vulnerability = record as VulnerabilityRecord;
    return join([
      `# ${vulnerability.title}`,
      `- Severity: ${vulnerability.severity}`,
      `- Status: ${vulnerability.status}`,
      `- Asset: ${vulnerability.assetId}`,
      `- CVE: ${vulnerability.cve ?? 'Not assigned'}`,
      `- CWE: ${vulnerability.cwe ?? 'Not assigned'}`,
      `- CVSS: ${vulnerability.cvss ?? 'Not recorded'}`,
      `- Updated: ${vulnerability.updatedAt}`,
      '## Vulnerability Description',
      vulnerability.description || 'Not recorded.',
      '## Reproduction Steps',
      vulnerability.description || 'Reproduction steps were not recorded in this legacy vulnerability record.',
      '## Impact',
      vulnerability.impact || 'Not recorded.',
      '## Remediation',
      vulnerability.remediation || 'Not recorded.',
      '## Finding IDs',
      list(vulnerability.findingIds),
      '## Evidence IDs',
      list(vulnerability.evidenceIds),
    ]);
  }
  if (kind === 'evidence') {
    const evidence = record as EvidenceRecord;
    return join([
      `# ${evidence.title}`,
      `- Tool: ${evidence.tool}`,
      `- Kind: ${evidence.kind}`,
      `- Asset: ${evidence.assetId}`,
      `- Observed: ${evidence.observedAt}`,
      '## Raw Tool Output',
      evidence.content || 'No content recorded.',
      '## Finding IDs',
      list(evidence.findingIds),
      '## Vulnerability IDs',
      list(evidence.vulnerabilityIds),
    ]);
  }
  const report = record as ReportRecord;
  return join([
    `# ${report.title}`,
    `- Status: ${report.status}`,
    `- Updated: ${report.updatedAt}`,
    '## Summary',
    report.summary || 'Not recorded.',
    '## Report',
    report.content || 'Empty report.',
    '## Finding IDs',
    list(report.findingIds),
    '## Vulnerability IDs',
    list(report.vulnerabilityIds),
  ]);
}

function list(values: string[]) {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- None';
}

function join(sections: string[]) {
  return `${sections.join('\n\n')}\n`;
}
