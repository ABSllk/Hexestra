import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/stores';
import { SkillsSettings } from '@/components/center-panel/tabs/SkillsSettings';

describe('SkillsSettings', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    useSessionStore.setState({ currentSession: { id: 'project-1' } as never });
    invoke.mockImplementation((channel: string) => {
      if (channel === 'claude:skills:list') return Promise.resolve({ runtimeLabel: 'Project', projectAvailable: true, items: [], errors: [] });
      if (channel === 'claude:skills:save') return Promise.resolve({ id: 'project:enabled:new-skill', name: 'new-skill', description: 'New', scope: 'project', enabled: true, sourcePath: 'D:/project/.hexestra/user/skills/new-skill/SKILL.md', content: '# New' });
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'hexestra', { configurable: true, value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() } });
  });

  it('creates a user Skill in the active project', async () => {
    render(<SkillsSettings />);
    expect(await screen.findByText('No global or project user Skills found.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Skill' }));
    expect(screen.getByLabelText('Skill scope')).toHaveValue('project');
    fireEvent.change(screen.getByLabelText('Skill markdown'), { target: { value: '# New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('claude:skills:save', expect.objectContaining({ scope: 'project', name: 'new-skill' })));
  });
});
