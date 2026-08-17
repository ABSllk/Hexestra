import { describe, expect, it } from 'vitest';
import { normalizePttMarkdown, parsePttDocument, parsePttMarkdown, planPttSteps, planPttTasks, updatePttStep, updatePttTaskStatus, upsertPttTask } from '@electron/services/ptt-markdown';

const sample = `# PTT — ATT&CK Task Tree
**ATT&CK Catalog:** Enterprise v19.1

## TA0043 Reconnaissance
## TA0007 Discovery
`;

describe('ptt-markdown', () => {
  it('rejects the retired Stage format instead of migrating it', () => {
    const parsed = parsePttDocument('## Stage 2: Active Scanning\n- [ ] Scan ports');
    expect(parsed.kind).toBe('legacy_unsupported');
    expect(parsed.tasks).toHaveLength(0);
  });

  it('persists an ATT&CK task with hidden versioned metadata', () => {
    const result = upsertPttTask(sample, {
      primaryTacticId: 'TA0043',
      title: 'Enumerate services',
      description: 'Identify exposed services',
      techniqueIds: ['T1595.001'],
      targetAssetIds: ['host-1'],
      successCriteria: [{ id: 'ports-recorded', text: 'Every discovered port is recorded' }],
    });
    expect(result.markdown).toContain('## TA0043 Reconnaissance');
    expect(result.markdown).toContain('hexestra:task data=');
    expect(result.task.techniqueIds).toEqual(['T1595.001']);
    expect(parsePttMarkdown(result.markdown)[0].targetAssetIds).toEqual(['host-1']);
    expect(result.markdown).toContain('### T1595.001 Scanning IP Blocks');
  });

  it('requires one exact technique and supports incremental grouped planning', () => {
    expect(() => upsertPttTask(sample, {
      primaryTacticId: 'TA0043',
      title: 'Ambiguous task',
      techniqueIds: ['T1595.001', 'T1595.002'],
      successCriteria: [{ text: 'Choose a technique' }],
    })).toThrow(/exactly one/);
    const result = planPttTasks(sample, [{
      tacticId: 'TA0043',
      techniqueId: 'T1595.002',
      tasks: [{ title: 'Scan exposed services', successCriteria: [{ text: 'Record scan result' }] }],
    }]);
    expect(result.tasks).toHaveLength(1);
    expect(result.markdown).toContain('### T1595.002 Vulnerability Scanning');
    expect(parsePttMarkdown(result.markdown)[0].techniqueIds).toEqual(['T1595.002']);
  });

  it('keeps started task classification stable', () => {
    const result = upsertPttTask(sample, {
      primaryTacticId: 'TA0043',
      title: 'Started scan',
      techniqueIds: ['T1595.001'],
      successCriteria: [{ text: 'Record result' }],
      status: 'in_progress',
    });
    expect(() => upsertPttTask(result.markdown, {
      id: result.task.id,
      primaryTacticId: 'TA0043',
      title: 'Started scan',
      techniqueIds: ['T1595.002'],
      successCriteria: [{ text: 'Record result' }],
    })).toThrow(/cannot be reclassified/);
  });

  it('requires all success criteria before completion', () => {
    const result = upsertPttTask(sample, {
      primaryTacticId: 'TA0043',
      title: 'Scan',
      techniqueIds: ['T1595.001'],
      targetAssetIds: ['host-1'],
      successCriteria: [{ text: 'Record result' }],
    });
    expect(() => updatePttTaskStatus(result.markdown, result.task.id, 'completed')).toThrow(/success criterion/);
  });

  it('creates a bounded execution plan under an Agent Task', () => {
    const parent = upsertPttTask(sample, {
      primaryTacticId: 'TA0007',
      title: 'Discovery',
      techniqueIds: ['T1046'],
      targetAssetIds: ['host-1'],
      successCriteria: [{ text: 'Record services' }],
    });
    const planned = planPttSteps(parent.markdown, {
      objectiveId: parent.task.id,
      steps: [{ title: 'Probe TCP' }, { title: 'Validate services' }, { title: 'Record open ports' }],
    });
    expect(planned.steps).toHaveLength(3);
    expect(planned.steps.every((step) => step.kind === 'step' && step.parentId === parent.task.id)).toBe(true);
    expect(planned.markdown).toContain('  - [ ] Probe TCP');
  });

  it('allows started Steps to update results when immutable fields are unchanged', () => {
    const parent = upsertPttTask(sample, {
      primaryTacticId: 'TA0007',
      title: 'Discovery',
      techniqueIds: ['T1046'],
      successCriteria: [{ text: 'Record services' }],
    });
    const planned = planPttSteps(parent.markdown, {
      objectiveId: parent.task.id,
      steps: [
        { title: 'Probe TCP', description: 'Collect service evidence', order: 0 },
        { title: 'Validate service banners', order: 1 },
        { title: 'Record open ports', order: 2 },
      ],
    });
    const started = updatePttStep(planned.markdown, {
      id: planned.steps[0].id,
      parentId: parent.task.id,
      title: 'Probe TCP',
      description: 'Collect service evidence',
      order: 0,
      status: 'in_progress',
    });

    const completed = updatePttStep(started.markdown, {
      id: planned.steps[0].id,
      parentId: parent.task.id,
      title: 'Probe TCP',
      description: 'Collect service evidence',
      order: 0,
      status: 'completed',
      resultSummary: 'TCP services were collected and recorded.',
    });

    expect(completed.step.status).toBe('completed');
    expect(completed.step.resultSummary).toBe('TCP services were collected and recorded.');
    expect(() => updatePttStep(started.markdown, {
      id: planned.steps[0].id,
      parentId: parent.task.id,
      title: 'Probe UDP instead',
      resultSummary: 'Changed plan',
    })).toThrow(/cannot be renamed or reordered/);
  });

  it('migrates legacy metadata to v3 without preserving nested grandchildren', () => {
    const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const objective = { version: 1, id: 'legacy-objective', title: 'Legacy objective', description: '', primaryTacticId: 'TA0007', tacticIds: ['TA0007'], techniqueIds: ['T1046'], targetAssetIds: ['host-1'], requiredCapabilities: [], preferredToolIds: [], preferredSkillIds: [], dependsOnTaskIds: [], successCriteria: [{ id: 'c1', text: 'Record', completed: false }], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), status: 'pending' };
    const child = { version: 1, id: 'legacy-step', title: 'Legacy step', description: '', parentId: 'legacy-objective', dependsOnTaskIds: [], successCriteria: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), status: 'pending' };
    const source = `# PTT\n**ATT&CK Catalog:** Enterprise v19.1\n\n## TA0007 Discovery\n- [ ] Legacy objective\n  <!-- hexestra:task data="${encode(objective)}" -->\n  - [ ] Legacy step\n    <!-- hexestra:task data="${encode(child)}" -->\n`;
    const migrated = normalizePttMarkdown(source);
    expect(migrated.changed).toBe(true);
    expect(migrated.markdown).toContain('hexestra:task data=');
    expect(migrated.tasks.filter((task) => task.kind === 'objective')).toHaveLength(1);
    expect(migrated.tasks.filter((task) => task.kind === 'step')).toHaveLength(1);
  });
});
