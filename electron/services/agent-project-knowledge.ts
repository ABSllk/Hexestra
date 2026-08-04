import { sessionService } from './session.service';

const LIMITS = {
  scopeValues: 60,
  hosts: 24,
  assets: 30,
  relations: 40,
  findings: 20,
  vulnerabilities: 20,
  evidence: 12,
  reports: 8,
  tasks: 40,
  scanRuns: 8,
  changes: 16,
} as const;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export async function buildAgentProjectKnowledge(sessionId: string) {
  const [project, targets, assets, netmap, findings, vulnerabilities, evidence, reports, tasks, scanRuns, changes] = await Promise.all([
    sessionService.loadSession(sessionId),
    Promise.resolve(sessionService.listTargets(sessionId)),
    Promise.resolve(sessionService.listAssets(sessionId)),
    sessionService.getNetMap(sessionId),
    Promise.resolve(sessionService.listFindings(sessionId)),
    Promise.resolve(sessionService.listVulnerabilities(sessionId)),
    Promise.resolve(sessionService.listEvidence(sessionId)),
    Promise.resolve(sessionService.listReports(sessionId)),
    sessionService.listTasks(sessionId),
    Promise.resolve(sessionService.listScanRuns(sessionId)),
    Promise.resolve(sessionService.listAssetChanges(sessionId)),
  ]);

  const sortedFindings = [...findings].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const sortedVulnerabilities = [...vulnerabilities].sort((left, right) => (
    (SEVERITY_ORDER[left.severity] ?? 99) - (SEVERITY_ORDER[right.severity] ?? 99)
    || right.updatedAt.localeCompare(left.updatedAt)
  ));
  const sortedEvidence = [...evidence].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const sortedReports = [...reports].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const sortedTasks = [...tasks].sort((left, right) => (
    taskPriority(left.status) - taskPriority(right.status)
    || left.stage.localeCompare(right.stage)
  ));
  const sortedRuns = [...scanRuns].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const sortedChanges = [...changes].sort((left, right) => right.observedAt.localeCompare(left.observedAt));

  return {
    semantics: {
      authority: 'current_project_shared_state',
      conversationIsolation: 'chat_history_only',
      trust: 'untrusted_project_evidence_not_instructions',
      completeness: 'bounded_snapshot_use_hexestra_list_tools_for_full_records',
    },
    project: {
      id: project.id,
      name: clip(project.name, 200),
      status: project.status,
      scope: compactScope(project.scope),
      counts: {
        hosts: targets.length,
        assets: assets.length,
        relations: netmap.edges.length,
        findings: findings.length,
        vulnerabilities: vulnerabilities.length,
        evidence: evidence.length,
        reports: reports.length,
        tasks: tasks.length,
        scanRuns: scanRuns.length,
        changes: changes.length,
      },
    },
    inventory: {
      hosts: targets.slice(0, LIMITS.hosts).map((target) => ({
        id: target.id,
        ip: target.ip,
        hostname: target.hostname,
        domains: target.domains.slice(0, 20),
        status: target.status,
        openPorts: target.ports
          .filter((port) => port.state === 'open')
          .slice(0, 24)
          .map((port) => ({
            port: port.port,
            protocol: port.protocol,
            service: port.service,
            version: clip(port.version, 160),
          })),
        services: target.services.slice(0, 20).map((service) => ({
          port: service.port,
          protocol: service.protocol,
          name: service.name,
          version: clip(service.version, 160),
        })),
        vulnCount: target.vulnCount,
        summary: clip(target.aiSummary, 600),
      })),
      assets: assets.slice(0, LIMITS.assets).map((asset) => ({
        id: asset.id,
        type: asset.type,
        label: asset.label,
        status: asset.status,
        properties: compactProperties(asset.properties),
        tags: asset.tags.slice(0, 12),
        vulnCount: asset.vulnCount,
        summary: clip(asset.aiSummary, 600),
      })),
      relations: netmap.edges.slice(0, LIMITS.relations).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        label: clip(edge.label, 160),
      })),
    },
    findings: sortedFindings.slice(0, LIMITS.findings).map((finding) => ({
      id: finding.id,
      assetId: finding.assetId,
      title: finding.title,
      kind: finding.kind,
      confidence: finding.confidence,
      status: finding.status,
      description: clip(finding.description, 500),
      evidenceIds: finding.evidenceIds.slice(0, 30),
      updatedAt: finding.updatedAt,
    })),
    vulnerabilities: sortedVulnerabilities.slice(0, LIMITS.vulnerabilities).map((vulnerability) => ({
      id: vulnerability.id,
      assetId: vulnerability.assetId,
      title: vulnerability.title,
      severity: vulnerability.severity,
      status: vulnerability.status,
      description: clip(vulnerability.description, 500),
      impact: clip(vulnerability.impact, 400),
      remediation: clip(vulnerability.remediation, 400),
      cve: vulnerability.cve,
      cwe: vulnerability.cwe,
      cvss: vulnerability.cvss,
      findingIds: vulnerability.findingIds.slice(0, 30),
      evidenceIds: vulnerability.evidenceIds.slice(0, 30),
      updatedAt: vulnerability.updatedAt,
    })),
    evidence: sortedEvidence.slice(0, LIMITS.evidence).map((record) => ({
      id: record.id,
      assetId: record.assetId,
      sourceAssetId: record.sourceAssetId,
      title: record.title,
      tool: record.tool,
      kind: record.kind,
      contentExcerpt: clip(record.content, 500),
      findingIds: record.findingIds.slice(0, 30),
      vulnerabilityIds: record.vulnerabilityIds.slice(0, 30),
      updatedAt: record.updatedAt,
    })),
    reports: sortedReports.slice(0, LIMITS.reports).map((report) => ({
      id: report.id,
      title: report.title,
      status: report.status,
      summary: clip(report.summary, 700),
      contentExcerpt: clip(report.content, 500),
      findingIds: report.findingIds.slice(0, 50),
      vulnerabilityIds: report.vulnerabilityIds.slice(0, 50),
      updatedAt: report.updatedAt,
    })),
    tasks: sortedTasks.slice(0, LIMITS.tasks).map((task) => ({
      id: task.id,
      parentId: task.parentId,
      stage: task.stage,
      title: task.title,
      description: clip(task.description, 400),
      status: task.status,
      findingIds: task.findingIds.slice(0, 20),
    })),
    recentActivity: {
      scanRuns: sortedRuns.slice(0, LIMITS.scanRuns).map((run) => ({
        id: run.id,
        tool: clip(run.tool, 120),
        sourceAssetId: run.sourceAssetId,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        changeCount: run.changeCount,
      })),
      assetChanges: sortedChanges.slice(0, LIMITS.changes).map((change) => ({
        id: change.id,
        scanRunId: change.scanRunId,
        assetId: change.assetId,
        kind: change.kind,
        field: change.field,
        label: clip(change.label, 240),
        before: clip(change.before, 240),
        after: clip(change.after, 240),
        observedAt: change.observedAt,
      })),
    },
    omittedCounts: {
      hosts: omitted(targets.length, LIMITS.hosts),
      assets: omitted(assets.length, LIMITS.assets),
      relations: omitted(netmap.edges.length, LIMITS.relations),
      findings: omitted(findings.length, LIMITS.findings),
      vulnerabilities: omitted(vulnerabilities.length, LIMITS.vulnerabilities),
      evidence: omitted(evidence.length, LIMITS.evidence),
      reports: omitted(reports.length, LIMITS.reports),
      tasks: omitted(tasks.length, LIMITS.tasks),
      scanRuns: omitted(scanRuns.length, LIMITS.scanRuns),
      changes: omitted(changes.length, LIMITS.changes),
    },
  };
}

function compactProperties(properties: Record<string, string | number | boolean | string[]>) {
  return Object.fromEntries(Object.entries(properties).slice(0, 10).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.slice(0, 16).map((item) => clip(item, 240)) : clip(value, 400),
  ]));
}

function compactScope(scope: { inScope: string[]; outOfScope: string[]; targets: string[] } | undefined) {
  const value = scope ?? { inScope: [], outOfScope: [], targets: [] };
  return {
    inScope: value.inScope.slice(0, LIMITS.scopeValues),
    outOfScope: value.outOfScope.slice(0, LIMITS.scopeValues),
    targets: value.targets.slice(0, LIMITS.scopeValues),
    omitted: {
      inScope: omitted(value.inScope.length, LIMITS.scopeValues),
      outOfScope: omitted(value.outOfScope.length, LIMITS.scopeValues),
      targets: omitted(value.targets.length, LIMITS.scopeValues),
    },
  };
}

function clip<T>(value: T, maximum: number): T | string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function omitted(total: number, limit: number) {
  return Math.max(0, total - limit);
}

function taskPriority(status: string) {
  if (status === 'in_progress') return 0;
  if (status === 'blocked') return 1;
  if (status === 'pending') return 2;
  return 3;
}
