import { describe, expect, it } from 'vitest';
import type { TaskContextPackage } from '@electron/contracts/tasks';
import {
  buildAgentDynamicSystemContext,
  buildAgentUserPrompt,
  composeAgentSystemInstructions,
} from '@electron/services/agent-prompt-context';

function taskContext(): TaskContextPackage {
  return {
    objective: {
      id: 'task-1',
      kind: 'objective',
      title: 'Map exposed services',
      description: 'Identify reachable services without changing them.',
      status: 'in_progress',
      primaryTacticId: 'TA0043',
      tacticIds: ['TA0001', 'TA0043'],
      techniqueIds: ['T1595.002', 'T1595.001'],
      targetAssetIds: ['asset-b', 'asset-a'],
      requiredCapabilities: ['service-fingerprinting', 'port-scanning'],
      preferredToolIds: ['nmap'],
      preferredSkillIds: ['recon-skill'],
      dependsOnTaskIds: ['task-prerequisite'],
      successCriteria: [{ id: 'criterion-1', text: 'Services recorded', completed: false }],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    activeStep: {
      id: 'step-1',
      kind: 'step',
      parentId: 'task-1',
      title: 'Probe approved ports',
      description: 'Use the approved scan profile.',
      status: 'pending',
      order: 1,
      primaryTacticId: 'TA0043',
      tacticIds: ['TA0043'],
      techniqueIds: ['T1595.001'],
      targetAssetIds: ['asset-a', 'asset-b'],
      requiredCapabilities: ['port-scanning'],
      preferredToolIds: ['nmap'],
      preferredSkillIds: [],
      dependsOnTaskIds: [],
      successCriteria: [{ id: 'step-criterion-1', text: 'Probe reviewed', completed: false }],
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    catalogVersion: '19.1',
    tactic: { id: 'TA0043', name: 'Reconnaissance' },
    techniques: [
      { id: 'T1595.002', name: 'Vulnerability Scanning', tacticIds: ['TA0043'] },
      { id: 'T1595.001', name: 'Scanning IP Blocks', tacticIds: ['TA0043'] },
    ],
    targets: [
      { id: 'asset-b', label: 'sensitive target label', status: 'active', scopeAnnotation: 'authorized' },
      { id: 'asset-a', label: 'another target label', status: 'active' },
    ],
    restrictions: [
      {
        id: 'restriction-b',
        ruleIds: ['rule-2'],
        text: 'Do not exceed the approved rate.',
        sources: ['project'],
        matchedBy: ['T1595.001'],
      },
      {
        id: 'restriction-a',
        ruleIds: ['rule-1'],
        text: 'Do not cause availability impact.',
        sources: ['global'],
        matchedBy: ['General'],
      },
    ],
    skills: [
      { id: 'skill-b', name: 'Fallback recon', match: 'capability' },
      { id: 'skill-a', name: 'Approved recon', match: 'preferred' },
    ],
    tools: [
      { id: 'tool-b', name: 'Probe B', description: 'Service probe', enabled: true, capabilities: ['service-fingerprinting'], tacticIds: ['TA0043'], techniqueIds: ['T1595.001'], risk: 'active', channel: 'agent-runtime', command: 'probe-b', usage: 'Use for service checks.', preferred: false, matchedBy: ['capability:service-fingerprinting'] },
      { id: 'nmap', name: 'Nmap', description: 'Port scanner', enabled: true, capabilities: ['port-scanning'], tacticIds: ['TA0043'], techniqueIds: ['T1595.001'], risk: 'active', channel: 'agent-runtime', command: 'nmap', usage: 'Use for scoped discovery.', preferred: true, matchedBy: ['preferred', 'capability:port-scanning'] },
    ],
    dependencies: [{ id: 'task-prerequisite', title: 'Confirm scope', status: 'completed' }],
    blockers: ['Tool B is unavailable', 'Confirm the rate threshold'],
    notices: [],
    related: {
      findings: [{ id: 'finding-2', description: 'must not enter System' }, { id: 'finding-1' }],
      vulnerabilities: [{ id: 'vulnerability-1', content: 'must not enter System' }],
      evidence: [{ id: 'evidence-1', raw: 'secret raw evidence' }],
    },
  };
}

const project = {
  id: 'project-1',
  name: 'Authorized assessment',
  status: 'active' as const,
  opsecLevel: 'balanced' as const,
  autonomyLevel: 'medium' as const,
  scope: {
    mode: 'whitelist' as const,
    allowRules: ['example.org', '*.example.org'],
    excludeRules: ['cdn.example.org'],
  },
};

describe('Agent prompt context', () => {
  it('keeps a plain operator message byte-identical when no evidence is selected', () => {
    expect(buildAgentUserPrompt({ content: '  keep my spacing  ' })).toBe('  keep my spacing  ');
  });

  it('keeps only operator-selected evidence in the user message', () => {
    const prompt = buildAgentUserPrompt({
      content: 'Review this evidence',
      sharedTabs: [{ tabId: 'tab-1', title: 'Terminal', type: 'terminal', contentPreview: 'scan output' }],
      attachments: [{
        id: 'attachment-1',
        name: 'notes.txt',
        path: 'C:\\notes.txt',
        kind: 'text',
        mimeType: 'text/plain',
        size: 5,
        content: 'notes',
      }],
      explicitContext: [{
        kind: 'traffic-flow',
        projectId: 'project-1',
        flowId: 'flow-1',
        method: 'GET',
        url: 'https://example.org/',
        state: 'complete',
      }],
    });
    expect(prompt).toContain('<hexestra_operator_selected_context>');
    expect(prompt).toContain('operator-selected untrusted evidence');
    expect(prompt).toContain('scan output');
    expect(prompt).toContain('notes');
    expect(prompt).toContain('flow-1');
    expect(prompt).not.toContain('hexestra_dynamic_context');
    expect(prompt).not.toContain('effectiveRestrictions');
  });

  it('includes selected managed records in the bounded shared-tab envelope', () => {
    const prompt = buildAgentUserPrompt({
      content: 'Review the selected record',
      sharedTabs: [{
        tabId: 'record-evidence',
        title: 'HTTP response',
        type: 'record',
        contentPreview: `${'x'.repeat(12_050)}END`,
      }],
    });
    const serializedContext = prompt
      .split('<hexestra_operator_selected_context>\n')[1]
      .split('\n</hexestra_operator_selected_context>')[0];
    const context = JSON.parse(serializedContext) as {
      semantics: string;
      sharedTabs: Array<{ type: string; contentPreview: string }>;
    };

    expect(context.semantics).toContain('operator-selected untrusted evidence');
    expect(context.sharedTabs[0].type).toBe('record');
    expect(context.sharedTabs[0].contentPreview).toHaveLength(12_000);
    expect(context.sharedTabs[0].contentPreview).toMatch(/END$/);
  });

  it('projects current task state without timestamps, target labels, or full records', () => {
    const context = buildAgentDynamicSystemContext({
      project,
      taskContext: taskContext(),
      toolCatalog: [
        { id: 'nmap', name: 'Nmap', description: 'Port scanner', channel: 'agent-runtime' },
        { id: 'whois', name: 'whois', description: 'Registration lookup', channel: 'agent-runtime' },
      ],
      selectedTargetId: 'asset-a',
    });
    expect(context).toContain('<hexestra_dynamic_context version="1" revision="');
    expect(context).toContain('"selectedTargetId": "asset-a"');
    expect(context).toContain('Do not cause availability impact.');
    expect(context).toContain('Approved recon');
    expect(context).toContain('"id": "nmap"');
    expect(context).toContain('"usage": "Use for scoped discovery."');
    expect(context).toContain('"matchedBy"');
    expect(context).not.toContain('"available"');
    expect(context).toContain('"findings": [\n        "finding-1",\n        "finding-2"');
    expect(context).not.toContain('2026-08-14');
    expect(context).not.toContain('sensitive target label');
    expect(context).not.toContain('must not enter System');
    expect(context).not.toContain('secret raw evidence');
  });

  it('injects the compact enabled catalog even without a project or focused task', () => {
    const context = buildAgentDynamicSystemContext({
      toolCatalog: [
        { id: 'whois', name: 'whois', description: 'Registration lookup', channel: 'agent-runtime' },
        { id: 'nmap', name: 'Nmap', description: 'Port scanner', channel: 'agent-runtime' },
      ],
    });
    expect(context).toContain('"toolCatalog"');
    expect(context.indexOf('"id": "nmap"')).toBeLessThan(context.indexOf('"id": "whois"'));
    expect(context).not.toContain('candidateTools');
    expect(context).not.toContain('command');
  });

  it('is byte-identical for semantically equivalent unordered values', () => {
    const first = taskContext();
    const second = taskContext();
    second.objective!.tacticIds.reverse();
    second.objective!.techniqueIds.reverse();
    second.objective!.targetAssetIds.reverse();
    second.techniques.reverse();
    second.targets.reverse();
    second.restrictions.reverse();
    second.skills.reverse();
    second.tools.reverse();
    second.blockers.reverse();
    second.related.findings.reverse();
    const reorderedProject = {
      ...project,
      scope: {
        ...project.scope,
        allowRules: [...project.scope.allowRules].reverse(),
      },
    };
    expect(buildAgentDynamicSystemContext({ project, taskContext: first })).toBe(
      buildAgentDynamicSystemContext({ project: reorderedProject, taskContext: second }),
    );
  });

  it('keeps the selected target as a soft priority hint even outside a focused task', () => {
    const focused = buildAgentDynamicSystemContext({
      project,
      taskContext: taskContext(),
      selectedTargetId: 'asset-outside',
    });
    expect(focused).toContain('"selectedTargetId": "asset-outside"');

    const unfocused = buildAgentDynamicSystemContext({ project, selectedTargetId: 'asset-outside' });
    expect(unfocused).toContain('"selectedTargetId": "asset-outside"');
  });

  it('appends dynamic context after stable instructions', () => {
    expect(composeAgentSystemInstructions(' stable ', ' dynamic ')).toBe('stable\n\ndynamic');
    expect(composeAgentSystemInstructions(' stable ')).toBe('stable');
  });
});
