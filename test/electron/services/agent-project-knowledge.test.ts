import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionService = {
  loadSession: vi.fn(),
  listTargets: vi.fn(),
  listAssets: vi.fn(),
  getNetMap: vi.fn(),
  listFindings: vi.fn(),
  listVulnerabilities: vi.fn(),
  listEvidence: vi.fn(),
  listReports: vi.fn(),
  listTasks: vi.fn(),
  listScanRuns: vi.fn(),
  listAssetChanges: vi.fn(),
};

vi.mock('@electron/services/session.service', () => ({ sessionService }));

describe('Agent project knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionService.loadSession.mockResolvedValue({
      id: 'project-a',
      name: 'Project A',
      status: 'active',
      scope: { inScope: ['example.com'], outOfScope: [], targets: ['example.com'] },
    });
    sessionService.listTargets.mockReturnValue([]);
    sessionService.listAssets.mockReturnValue([]);
    sessionService.getNetMap.mockResolvedValue({ assets: [], edges: [] });
    sessionService.listFindings.mockReturnValue([]);
    sessionService.listVulnerabilities.mockReturnValue([]);
    sessionService.listEvidence.mockReturnValue([]);
    sessionService.listReports.mockReturnValue([]);
    sessionService.listTasks.mockResolvedValue([]);
    sessionService.listScanRuns.mockReturnValue([]);
    sessionService.listAssetChanges.mockReturnValue([]);
  });

  it('marks the snapshot as current project-shared data', async () => {
    const { buildAgentProjectKnowledge } = await import('@electron/services/agent-project-knowledge');
    const knowledge = await buildAgentProjectKnowledge('project-a');

    expect(knowledge.semantics).toEqual(expect.objectContaining({
      authority: 'current_project_shared_state',
      conversationIsolation: 'chat_history_only',
      completeness: 'bounded_snapshot_use_hexestra_list_tools_for_full_records',
    }));
    expect(knowledge.project.scope.inScope).toEqual(['example.com']);
    expect(sessionService.listFindings).toHaveBeenCalledWith('project-a');
    expect(sessionService.listVulnerabilities).toHaveBeenCalledWith('project-a');
    expect(sessionService.listEvidence).toHaveBeenCalledWith('project-a');
    expect(sessionService.listReports).toHaveBeenCalledWith('project-a');
  });

  it('includes useful record excerpts while bounding large project collections', async () => {
    sessionService.listEvidence.mockReturnValue(Array.from({ length: 30 }, (_, index) => ({
      id: `E-${index}`,
      assetId: 'AST-1',
      title: `Evidence ${index}`,
      tool: 'nmap',
      kind: 'scan',
      content: 'x'.repeat(2_000),
      findingIds: [],
      vulnerabilityIds: [],
      observedAt: `2026-07-31T00:00:${String(index).padStart(2, '0')}.000Z`,
      updatedAt: `2026-07-31T00:00:${String(index).padStart(2, '0')}.000Z`,
    })));

    const { buildAgentProjectKnowledge } = await import('@electron/services/agent-project-knowledge');
    const knowledge = await buildAgentProjectKnowledge('project-a');

    expect(knowledge.evidence).toHaveLength(12);
    const excerpt = knowledge.evidence[0]?.contentExcerpt;
    expect(excerpt).toBeTypeOf('string');
    expect((excerpt as string).length).toBeLessThanOrEqual(500);
    expect(knowledge.omittedCounts.evidence).toBe(18);
  });
});
