import { describe, expect, it } from 'vitest';
import { buildSystemInstructions } from './agent-system-instructions';

describe('Agent system instructions', () => {
  it('separates managed evidence, knowledge, vulnerabilities, and reports', () => {
    const instructions = buildSystemInstructions();
    expect(instructions).toContain('Hexestra-managed tools are the only supported write path');
    expect(instructions).toContain('report_upsert');
    expect(instructions).toContain('Never create');
    expect(instructions).toContain('findings/, vulnerabilities/, evidence/, or');
    expect(instructions).toContain('reports/, even if an older project Skill');
    expect(instructions).toContain('project Skill "hexestra-records"');
    expect(instructions).toContain('It owns Evidence/Finding/Vulnerability');
    expect(instructions).toContain('corresponding list');
    expect(instructions).toContain('call report_list before');
    expect(instructions).toContain('claiming a report was saved');
    expect(instructions).toContain('separate native');
    expect(instructions).toContain('project Skill "hexestra-report"');
    expect(instructions).toContain('It owns report structure');
    expect(instructions).toContain('Stage 0 must define it');
    expect(instructions).toContain('call scope_update');
    expect(instructions).toContain('Never authorize unrelated third-party');
    expect(instructions).toMatch(/shared by every chat\s+conversation/);
    expect(instructions).toMatch(/call target_list, task_list, finding_list,\s+vulnerability_list, evidence_list/);
    expect(instructions).toContain('"hexestra-pentest" for penetration-testing orchestration');
    expect(instructions).toContain('Never invoke or');
    expect(instructions).toContain('personal/user skill named "pentest"');
    expect(instructions).toContain('Use shell_profiles and shell_sessions');
    expect(instructions).toContain('Infrastructure SSH profiles are jump routes');
    expect(instructions).toContain('complete output are written to plaintext');
    expect(instructions).toContain('bypass reverse-');
  });
});
