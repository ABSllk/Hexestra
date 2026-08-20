import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolCatalogSettings } from '@/components/center-panel/tabs/ToolCatalogSettings';
import { ConfirmDialogProvider } from '@/components/shared';
import { I18nProvider } from '@/i18n';
import { APP_SETTINGS_IPC } from '@electron/contracts/app-settings';
import { TOOL_CATALOG_IPC, type ToolCatalogDocumentResult, type ToolCatalogRecord } from '@electron/contracts/tool-catalog';

const nmap: ToolCatalogRecord = {
  id: 'nmap',
  name: 'nmap',
  description: 'Port and service discovery',
  enabled: true,
  capabilities: ['port-scanning'],
  tacticIds: ['TA0043'],
  techniqueIds: ['T1046'],
  risk: 'active',
  channel: 'agent-runtime',
  command: 'nmap',
  usage: 'Use for scoped discovery.',
};

function catalog(tools: ToolCatalogRecord[] = [nmap]): ToolCatalogDocumentResult {
  return { path: 'user/tools.yaml', exists: true, document: { version: 1, tools }, diagnostics: [] };
}

describe('ToolCatalogSettings', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === TOOL_CATALOG_IPC.LIST) return catalog();
      if (channel === TOOL_CATALOG_IPC.UPDATE) return catalog([{ id: args[0] as string, ...(args[1] as Omit<ToolCatalogRecord, 'id'>) }]);
      if (channel === TOOL_CATALOG_IPC.CREATE) return catalog([nmap, args[0] as ToolCatalogRecord]);
      if (channel === TOOL_CATALOG_IPC.DELETE) return catalog([]);
      if (channel === 'dialog:confirm') return true;
      if (channel === APP_SETTINGS_IPC.GET) return { version: 4, language: 'en', theme: 'system', mitmdumpPath: null, mihomoPath: null };
      return undefined;
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined), once: vi.fn(), send: vi.fn() },
    });
  });

  it('loads, searches, edits with a locked ID, and has no probe UI', async () => {
    render(<ConfirmDialogProvider><ToolCatalogSettings /></ConfirmDialogProvider>);
    expect(await screen.findByText('Port and service discovery')).toBeInTheDocument();
    expect(screen.queryByText(/probe local tools/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search name, ID, or capability'), { target: { value: 'port-scanning' } });
    fireEvent.click(screen.getByRole('button', { name: 'nmap' }));
    expect(screen.getByLabelText('ID')).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save tool' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      TOOL_CATALOG_IPC.UPDATE,
      'nmap',
      expect.objectContaining({ enabled: false, command: 'nmap' }),
    ));
  });

  it('creates a tool and reports save errors without discarding the draft', async () => {
    render(<ConfirmDialogProvider><ToolCatalogSettings /></ConfirmDialogProvider>);
    await screen.findByText('Port and service discovery');
    fireEvent.click(screen.getByRole('button', { name: 'Add tool' }));
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'custom-tool' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Custom' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Custom prompt entry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tool' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(TOOL_CATALOG_IPC.CREATE, expect.objectContaining({ id: 'custom-tool', name: 'Custom' })));

    invoke.mockRejectedValueOnce(new Error('Unable to save catalog'));
    fireEvent.click(screen.getByRole('button', { name: 'Save tool' }));
    expect(await screen.findByText(/Unable to save catalog/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Custom');
  });

  it('confirms deletion and explains unresolved historical task references', async () => {
    render(<ConfirmDialogProvider><ToolCatalogSettings /></ConfirmDialogProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'nmap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete tool' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('dialog:confirm', expect.objectContaining({
      description: expect.stringContaining('Historical tasks'),
      tone: 'danger',
    })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(TOOL_CATALOG_IPC.DELETE, 'nmap'));
  });

  it('renders the Chinese labels from the typed translation catalog', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === APP_SETTINGS_IPC.GET) return { version: 4, language: 'zh-CN', theme: 'system', mitmdumpPath: null, mihomoPath: null };
      if (channel === TOOL_CATALOG_IPC.LIST) return catalog();
      return undefined;
    });
    render(<I18nProvider><ConfirmDialogProvider><ToolCatalogSettings /></ConfirmDialogProvider></I18nProvider>);
    expect(await screen.findByRole('heading', { name: '工具目录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加工具' })).toBeInTheDocument();
  });
});
