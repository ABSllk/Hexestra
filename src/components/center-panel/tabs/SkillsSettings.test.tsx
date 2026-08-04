import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/stores';
import { SkillsSettings } from './SkillsSettings';

describe('SkillsSettings', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    useSessionStore.setState({ currentSession: null });
    invoke.mockImplementation((channel: string) => {
      if (channel === 'claude:skills:list') return Promise.resolve({ runtimeLabel: 'WSL · Ubuntu-24.04', projectAvailable: false, items: [], errors: [] });
      if (channel === 'claude:skills:save') return Promise.resolve({ id: 'personal:enabled:new-skill', name: 'new-skill', description: 'New', scope: 'personal', enabled: true, sourcePath: '/home/testuser/.claude/skills/new-skill/SKILL.md', content: '# New' });
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'hexestra', { configurable: true, value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() } });
  });

  it('creates a personal Skill when no engagement is open', async () => {
    render(<SkillsSettings />);
    expect(await screen.findByText('No personal or project Skills found.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Skill' }));
    expect(screen.getByLabelText('Skill scope')).toHaveValue('personal');
    fireEvent.change(screen.getByLabelText('Skill markdown'), { target: { value: '# New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('claude:skills:save', expect.objectContaining({ scope: 'personal', name: 'new-skill' })));
  });
});
