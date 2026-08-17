import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentInstructionsSettings } from '@/components/center-panel/tabs/AgentInstructionsSettings';
import { ConfirmDialogProvider } from '@/components/shared';
import { useSessionStore } from '@/stores';

const emptyRestrictions = {
  version: 1,
  global: {
    document: { version: 1, rules: [] },
    diagnostics: [],
    sourcePath: 'global/restrictions.yaml',
    fingerprint: 'global',
  },
  project: {
    document: { version: 1, rules: [] },
    diagnostics: [],
    sourcePath: 'project/restrictions.yaml',
    fingerprint: 'project',
  },
  diagnostics: [],
};

function renderSettings() {
  return render(<ConfirmDialogProvider><AgentInstructionsSettings /></ConfirmDialogProvider>);
}

describe('AgentInstructionsSettings restriction editor', () => {
  const invoke = vi.fn(async (channel: string): Promise<unknown> => {
    if (channel === 'restrictions:list') return emptyRestrictions;
    return undefined;
  });

  beforeEach(() => {
    invoke.mockClear();
    useSessionStore.setState({ currentSession: { id: 'project-1', name: 'Project' } as never });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined), once: vi.fn(), send: vi.fn() },
    });
  });

  it('opens as an inline master-detail editor instead of a modal or drawer', async () => {
    const { container } = renderSettings();
    const [trigger] = await screen.findAllByRole('button', { name: 'Add restriction' });

    fireEvent.click(trigger);

    const pane = screen.getByTestId('restriction-editor-pane');
    expect(container).toContainElement(pane);
    expect(pane).toHaveClass('h-full', 'min-h-0');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const restrictionInput = screen.getByLabelText('Restriction');
    expect(restrictionInput).toHaveClass('settings-textarea-large');
    expect(restrictionInput).toHaveAttribute('rows', '7');
    await waitFor(() => expect(restrictionInput).toHaveFocus());
  });

  it('closes from the inline action row and restores focus to the opening control', async () => {
    renderSettings();
    const [trigger] = await screen.findAllByRole('button', { name: 'Add restriction' });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByLabelText('Restriction')).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId('restriction-editor-pane')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('exposes the complete catalog with a searchable technique picker', async () => {
    renderSettings();
    const [trigger] = await screen.findAllByRole('button', { name: 'Add restriction' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'ATT&CK' }));
    fireEvent.click(screen.getByRole('tab', { name: /Techniques 0/ }));

    expect(screen.getByText('697 of 697 shown')).toBeInTheDocument();
    const query = screen.getByRole('textbox', { name: 'Search ATT&CK techniques' });
    fireEvent.change(query, { target: { value: 'Query Public AI Services' } });

    await waitFor(() => expect(screen.getByText('Query Public AI Services')).toBeInTheDocument());
    expect(screen.queryByText('Active Scanning')).not.toBeInTheDocument();
  });

  it('shows Agent classification as a suggestion and applies it only after confirmation', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'restrictions:list') return emptyRestrictions;
      if (channel === 'restrictions:classify') return {
        selector: { kind: 'attack', tacticIds: [], techniqueIds: ['T1595.001'] },
        confidence: 'high',
        reason: 'The rule specifically constrains IP range scanning.',
        matchedTactics: [],
        matchedTechniques: [{ id: 'T1595.001', name: 'Scanning IP Blocks' }],
      };
      return undefined;
    });
    renderSettings();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add restriction' }))[0]);
    const restrictionInput = screen.getByLabelText('Restriction');
    fireEvent.change(restrictionInput, { target: { value: 'Limit IP range scan rate.' } });
    fireEvent.blur(restrictionInput);

    expect(await screen.findByText('Classification suggestion')).toBeInTheDocument();
    expect(screen.getByText('1 ATT&CK binding')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('restrictions:upsert', expect.anything(), expect.anything(), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion' }));
    expect(screen.getByRole('button', { name: 'Edit ATT&CK bindings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ATT&CK' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the selected tactic and technique identities in rule details', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'restrictions:list') return {
        ...emptyRestrictions,
        global: {
          ...emptyRestrictions.global,
          document: {
            version: 1,
            rules: [{
              id: 'scan-rate',
              text: 'Limit active scanning rate.',
              enabled: true,
              selector: {
                kind: 'attack',
                tacticIds: ['TA0043'],
                techniqueIds: ['T1595.001'],
              },
              createdAt: '2026-08-14T00:00:00.000Z',
              updatedAt: '2026-08-14T00:00:00.000Z',
            }],
          },
        },
      };
      return undefined;
    });
    renderSettings();

    const ruleId = await screen.findByText('scan-rate');
    const ruleButton = ruleId.closest('button');
    expect(ruleButton).not.toBeNull();
    fireEvent.click(ruleButton!);

    expect(screen.getByRole('region', { name: 'Tactics' })).toHaveTextContent('TA0043');
    expect(screen.getByRole('region', { name: 'Tactics' })).toHaveTextContent('Reconnaissance');
    expect(screen.getByRole('region', { name: 'Techniques' })).toHaveTextContent('T1595.001');
    expect(screen.getByRole('region', { name: 'Techniques' })).toHaveTextContent('Scanning IP Blocks');
    expect(screen.getByRole('button', { name: 'Edit ATT&CK bindings' })).toBeInTheDocument();
  });
});
