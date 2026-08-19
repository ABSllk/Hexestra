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

  it('reviews a folder import, keeps the project default, and imports it enabled', async () => {
    const preview = {
      selectionId: 'selection-1',
      sourceKind: 'directory',
      sourceLabel: 'recon-helper',
      suggestedName: 'recon-helper',
      description: 'Recon workflow',
      content: '---\nname: recon-helper\ndescription: Recon workflow\n---\n\n# Recon',
      fileCount: 3,
      totalBytes: 420,
      diagnostics: [],
      existing: [],
    } as const;
    invoke.mockImplementation((channel: string) => {
      if (channel === 'claude:skills:list') return Promise.resolve({ runtimeLabel: 'Project', projectAvailable: true, items: [], errors: [] });
      if (channel === 'claude:skills:import-pick') return Promise.resolve([preview]);
      if (channel === 'claude:skills:import-apply') return Promise.resolve({
        document: {
          id: 'project:enabled:recon-helper', name: 'recon-helper', description: 'Recon workflow', scope: 'project', enabled: true,
          sourcePath: 'D:/project/.hexestra/user/skills/recon-helper/SKILL.md', content: preview.content,
        },
      });
      return Promise.resolve(null);
    });

    render(<SkillsSettings />);
    await screen.findByText('No global or project user Skills found.');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skill folder' }));
    expect(await screen.findByText('Review Skill import')).toBeInTheDocument();
    expect(screen.getByLabelText('Install scope')).toHaveValue('project');
    fireEvent.click(screen.getByRole('button', { name: 'Import & enable' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('claude:skills:import-apply', expect.objectContaining({
      selectionId: 'selection-1', scope: 'project', name: 'recon-helper', description: 'Recon workflow', collision: 'reject',
    })));
  });

  it('requires repaired name and description for a metadata-free import and supports cancel', async () => {
    const preview = {
      selectionId: 'selection-2',
      sourceKind: 'skill-file',
      sourceLabel: 'external',
      suggestedName: 'imported-skill',
      description: '',
      content: '# External skill',
      fileCount: 1,
      totalBytes: 18,
      diagnostics: [
        { code: 'missing-name', message: 'Add a Skill name before importing.' },
        { code: 'missing-description', message: 'Add a Skill description before importing.' },
      ],
      existing: [],
    } as const;
    invoke.mockImplementation((channel: string) => {
      if (channel === 'claude:skills:list') return Promise.resolve({ runtimeLabel: 'Global', projectAvailable: false, items: [], errors: [] });
      if (channel === 'claude:skills:import-pick') return Promise.resolve([preview]);
      return Promise.resolve(null);
    });
    useSessionStore.setState({ currentSession: null });

    render(<SkillsSettings />);
    await screen.findByText('No global or project user Skills found.');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'SKILL.md file' }));
    const importButton = await screen.findByRole('button', { name: 'Import & enable' });
    expect(importButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'external-helper' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'External workflow' } });
    expect(importButton).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await waitFor(() => expect(screen.getByText('Select a Skill or create a new one')).toBeInTheDocument());
    expect(invoke).not.toHaveBeenCalledWith('claude:skills:import-apply', expect.anything());
  });

  it('walks through multiple selected imports without re-opening the picker', async () => {
    const makePreview = (name: string) => ({
      selectionId: `selection-${name}`,
      sourceKind: 'directory',
      sourceLabel: name,
      suggestedName: 'shared-helper',
      description: `${name} workflow`,
      content: `---\nname: shared-helper\ndescription: ${name} workflow\n---\n`,
      fileCount: 1,
      totalBytes: 120,
      diagnostics: [],
      existing: [],
    });
    const previews = [makePreview('one'), makePreview('two')];
    invoke.mockImplementation((channel: string, payload?: { selectionId?: string }) => {
      if (channel === 'claude:skills:list') return Promise.resolve({ runtimeLabel: 'Project', projectAvailable: true, items: [], errors: [] });
      if (channel === 'claude:skills:import-pick') return Promise.resolve(previews);
      if (channel === 'claude:skills:import-apply') return Promise.resolve({
        document: {
          id: `project:enabled:${payload?.selectionId ?? 'shared-helper'}`, name: payload?.selectionId === 'selection-two' ? 'shared-helper-2' : 'shared-helper',
          description: 'Imported', scope: 'project', enabled: true, sourcePath: '', content: '# imported',
        },
      });
      return Promise.resolve(null);
    });

    render(<SkillsSettings />);
    await screen.findByText('No global or project user Skills found.');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skill folder' }));
    expect(await screen.findByText('Package 1 of 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Skill name')).toHaveValue('shared-helper');
    fireEvent.click(screen.getByRole('button', { name: 'Import & enable' }));
    expect(await screen.findByText('Package 2 of 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Skill name')).toHaveValue('shared-helper-2');
    fireEvent.click(screen.getByRole('button', { name: 'Import & enable' }));
    expect(invoke).toHaveBeenCalledWith('claude:skills:import-apply', expect.objectContaining({ selectionId: 'selection-one', name: 'shared-helper' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('claude:skills:import-apply', expect.objectContaining({ selectionId: 'selection-two', name: 'shared-helper-2' })));
  });
});
