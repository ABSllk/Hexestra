import { z } from 'zod';
import { sessionService } from '../session.service';
import { syncTargetsService } from '../sync-targets.service';
import type { AgentToolContext } from './context';

const assetRegistrationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('host'),
    ip: z.string().min(7).max(45),
    hostname: z.string().min(1).max(253).optional(),
    domains: z.array(z.string().min(3).max(253)).max(100).optional(),
    ports: z.array(z.object({
      port: z.number().int().min(1).max(65_535),
      protocol: z.enum(['tcp', 'udp']).optional(),
      state: z.enum(['open', 'filtered', 'closed']).optional(),
      service: z.string().min(1).max(200).optional(),
      version: z.string().min(1).max(500).optional(),
    })).max(1_000).optional(),
    summary: z.string().max(4_000).optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  }),
  z.object({
    type: z.literal('domain'),
    domain: z.string().min(3).max(253),
    summary: z.string().max(4_000).optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  }),
  z.object({
    type: z.literal('webapp'),
    url: z.url().max(2_000),
    ip: z.string().min(7).max(45).optional(),
    domain: z.string().min(3).max(253).optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    title: z.string().max(500).optional(),
    technologies: z.array(z.string().min(1).max(200)).max(100).optional(),
    summary: z.string().max(4_000).optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  }),
]);

export function createProjectAgentTools({ sdk, sender, sessionId, selectedTargetId }: AgentToolContext) {
  return [
    sdk.tool(
      'target_list',
      'Read the persisted host and non-host asset inventory for the active engagement.',
      {},
      async () => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify({
          hosts: await sessionService.listTargets(sessionId),
          assets: sessionService.listAssets(sessionId),
        }, null, 2) }] };
      },
    ),
    sdk.tool(
      'scope_update',
      'Define or refine the active engagement scope from operator-provided root targets and verified asset relationships. Subdomains of an authorized root and hosts directly resolved from them may be included. Never add unrelated third-party, CDN, or ambiguous infrastructure without operator confirmation.',
      {
        inScope: z.array(z.string().min(1).max(500)).max(500),
        outOfScope: z.array(z.string().min(1).max(500)).max(500).optional(),
        targets: z.array(z.string().min(1).max(500)).max(500).optional(),
        rationale: z.string().min(1).max(4_000),
      },
      async ({ inScope, outOfScope, targets, rationale }) => {
        if (!sessionId) throw new Error('No active engagement');
        const updated = await sessionService.updateScope(sessionId, {
          inScope,
          outOfScope: outOfScope ?? [],
          targets: targets ?? [],
        });
        sender.send('session:data-changed', {
          sessionId,
          targets: true,
          netmap: true,
          scope: updated.scope,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ scope: updated.scope, rationale }, null, 2) }] };
      },
    ),
    sdk.tool(
      'asset_register',
      'Register discovered Hosts, Domains, and Web Apps in the active engagement. '
        + 'Use this after interpreting tool evidence; it atomically upserts stable identities, '
        + 'ports/services and graph relations, then returns persisted IDs. Never invent IDs or '
        + 'use summary-update tools to create assets.',
      { assets: z.array(assetRegistrationSchema).min(1).max(100) },
      async ({ assets }) => {
        if (!sessionId) throw new Error('No active engagement');
        const registered = await syncTargetsService.registerAssets(sessionId, assets, selectedTargetId);
        if (!sender.isDestroyed()) {
          sender.send('session:data-changed', {
            sessionId,
            targets: true,
            netmap: true,
            changes: true,
          });
        }
        return { content: [{
          type: 'text',
          text: JSON.stringify({
            registeredHosts: registered.hosts,
            registeredAssets: registered.assets,
            relationsUpdated: registered.edgesUpdated,
            changesRecorded: registered.changesRecorded,
            scanRunId: registered.scanRunId,
          }, null, 2),
        }] };
      },
    ),
    sdk.tool(
      'target_update_summary',
      'Persist a concise evidence-based AI summary for a target.',
      { targetId: z.string(), summary: z.string().max(4000) },
      async ({ targetId, summary }) => {
        if (!sessionId) throw new Error('No active engagement');
        await sessionService.updateTarget(sessionId, targetId, { aiSummary: summary });
        sender.send('session:data-changed', { sessionId, targets: true });
        return { content: [{ type: 'text', text: `Updated summary for ${targetId}` }] };
      },
    ),
    sdk.tool(
      'asset_update_summary',
      'Persist a concise evidence-based AI summary for a non-host asset.',
      { assetId: z.string(), summary: z.string().max(4000) },
      async ({ assetId, summary }) => {
        if (!sessionId) throw new Error('No active engagement');
        sessionService.updateAsset(sessionId, assetId, { aiSummary: summary });
        sender.send('session:data-changed', { sessionId, netmap: true });
        return { content: [{ type: 'text', text: `Updated summary for ${assetId}` }] };
      },
    ),
    sdk.tool(
      'evidence_list',
      'Read Hexestra-managed evidence records for the active engagement.',
      {},
      async () => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(sessionService.listEvidence(sessionId), null, 2) }] };
      },
    ),
    sdk.tool(
      'evidence_upsert',
      'The only supported write path for raw Evidence. Invoke and follow hexestra-records before storing verbatim output from a named tool or command; never store interpretation, leads, or conclusions as Evidence.',
      {
        id: z.string().optional(),
        assetId: z.string(),
        sourceAssetId: z.string().optional(),
        title: z.string().min(1).max(300),
        tool: z.string().min(1).max(100),
        kind: z.string().min(1).max(100).optional(),
        content: z.string().max(500_000),
      },
      async (evidence) => {
        if (!sessionId) throw new Error('No active engagement');
        const updated = sessionService.upsertEvidence(sessionId, evidence);
        sender.send('session:data-changed', { sessionId, evidence: true, findings: true, vulnerabilities: true });
        return { content: [{ type: 'text', text: `Saved evidence ${updated.id}` }] };
      },
    ),
    sdk.tool(
      'finding_list',
      'Read reusable project knowledge recorded as Findings for the active engagement.',
      {},
      async () => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(sessionService.listFindings(sessionId), null, 2) }] };
      },
    ),
    sdk.tool(
      'finding_upsert',
      'The only supported write path for Findings. Invoke and follow hexestra-records to classify, link, and verify distilled project knowledge; do not use this for raw output or a validated Vulnerability.',
      {
        id: z.string().optional(),
        assetId: z.string().optional(),
        title: z.string().min(1).max(300),
        kind: z.enum(['observation', 'lead', 'hypothesis', 'behavior', 'access', 'note']).optional(),
        confidence: z.enum(['low', 'medium', 'high']).optional(),
        status: z.enum(['active', 'used', 'archived']).optional(),
        description: z.string().max(20_000).optional(),
        evidenceIds: z.array(z.string()).max(100).optional(),
      },
      async (finding) => {
        if (!sessionId) throw new Error('No active engagement');
        const updated = sessionService.upsertFinding(sessionId, finding);
        sender.send('session:data-changed', { sessionId, findings: true });
        return { content: [{ type: 'text', text: `Saved finding ${updated.id}` }] };
      },
    ),
    sdk.tool(
      'vulnerability_list',
      'Read validated vulnerability records for the active engagement.',
      {},
      async () => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(sessionService.listVulnerabilities(sessionId), null, 2) }] };
      },
    ),
    sdk.tool(
      'vulnerability_upsert',
      'The only supported write path for validated weaknesses. Invoke and follow hexestra-records first; link the real affected asset and supporting records, and include independently executable numbered reproduction steps and observable results.',
      {
        id: z.string().optional(),
        assetId: z.string(),
        title: z.string().min(1).max(300),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
        status: z.enum(['confirmed', 'remediation', 'resolved', 'accepted']).optional(),
        description: z.string().max(20_000).optional(),
        impact: z.string().max(20_000).optional(),
        remediation: z.string().max(20_000).optional(),
        cve: z.string().max(100).optional(),
        cwe: z.string().max(100).optional(),
        cvss: z.number().min(0).max(10).optional(),
        findingIds: z.array(z.string()).max(100).optional(),
        evidenceIds: z.array(z.string()).max(100).optional(),
      },
      async (vulnerability) => {
        if (!sessionId) throw new Error('No active engagement');
        const updated = sessionService.upsertVulnerability(sessionId, vulnerability);
        sender.send('session:data-changed', { sessionId, targets: true, netmap: true, vulnerabilities: true });
        return { content: [{ type: 'text', text: `Saved vulnerability ${updated.id}` }] };
      },
    ),
    sdk.tool(
      'report_list',
      'Read Hexestra-managed penetration-test reports for the active engagement.',
      {},
      async () => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(sessionService.listReports(sessionId), null, 2) }] };
      },
    ),
    sdk.tool(
      'report_upsert',
      'The only supported write path for Markdown reports. Invoke and follow the native project Skill hexestra-report first, then create or update a draft/final report and link the Finding and Vulnerability IDs it summarizes; never write report files under reports/.',
      {
        id: z.string().optional(),
        title: z.string().min(1).max(300),
        status: z.enum(['draft', 'final']).optional(),
        summary: z.string().max(10_000).optional(),
        content: z.string().max(500_000),
        findingIds: z.array(z.string()).max(500).optional(),
        vulnerabilityIds: z.array(z.string()).max(500).optional(),
      },
      async (report) => {
        if (!sessionId) throw new Error('No active engagement');
        const updated = sessionService.upsertReport(sessionId, report);
        sender.send('session:data-changed', { sessionId, reports: true });
        return { content: [{ type: 'text', text: `Saved report ${updated.id}` }] };
      },
    ),
    sdk.tool(
      'task_list',
      'Read the canonical penetration-test task tree parsed from ptt.md.',
      {},
      async () => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(await sessionService.listTasks(sessionId), null, 2) }] };
      },
    ),
    sdk.tool(
      'task_upsert',
      'Create or update a task in the canonical ptt.md task tree. Use parentId for one nested step level.',
      {
        id: z.string().optional(),
        stage: z.enum(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'disengage']),
        title: z.string().min(1).max(300),
        description: z.string().max(2_000).optional(),
        status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed']).optional(),
        parentId: z.string().optional(),
      },
      async (task) => {
        if (!sessionId) throw new Error('No active engagement');
        const updated = await sessionService.upsertTask(sessionId, task);
        sender.send('session:data-changed', { sessionId, tasks: true });
        return { content: [{ type: 'text', text: `Saved task ${updated.id}` }] };
      },
    ),
    sdk.tool(
      'task_update_status',
      'Update a penetration-test task after evidence confirms its state.',
      {
        taskId: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed']),
      },
      async ({ taskId, status }) => {
        if (!sessionId) throw new Error('No active engagement');
        await sessionService.updateTaskStatus(sessionId, taskId, status);
        sender.send('session:data-changed', { sessionId, tasks: true });
        return { content: [{ type: 'text', text: `Updated ${taskId} to ${status}` }] };
      },
    ),
  ];
}
