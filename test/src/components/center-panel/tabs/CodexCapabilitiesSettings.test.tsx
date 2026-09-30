import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore, useTabStore } from '@/stores';
import { SkillsSettings } from '@/components/center-panel/tabs/SkillsSettings';
import { McpSettings } from '@/components/center-panel/tabs/McpSettings';
import { I18nProvider } from '@/i18n';

describe('Codex capability settings', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    useSessionStore.setState({ currentSession: { id: 'project-1' } as never });
    Object.defineProperty(window, 'hexestra', { configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() } });
  });

  it('loads Codex Skills separately and saves new Skills to the project', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'claude:skills:list') return Promise.resolve({ runtimeLabel: 'Claude', projectAvailable: true, items: [], errors: [] });
      if (channel === 'codex:skills:detailed') return Promise.resolve({ runtimeLabel: 'Codex · Native', projectAvailable: true, items: [], errors: [] });
      if (channel === 'codex:skills:save') return Promise.resolve('D:/project/.agents/skills/new-skill/SKILL.md');
      return Promise.resolve(null);
    });
    render(<SkillsSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(await screen.findByText('No Skills found.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex:skills:save', expect.objectContaining({
      sessionId: 'project-1', scope: 'repo', name: 'new-skill',
    })));
    expect(invoke).not.toHaveBeenCalledWith('claude:skills:save', expect.anything());
  });

  it('loads Codex MCP definitions and writes to the Codex channel', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'claude:mcp:list') return Promise.resolve({ runtimeLabel: 'Claude', projectAvailable: true, items: [], errors: [] });
      if (channel === 'codex:mcp:list') return Promise.resolve({ runtimeLabel: 'Codex · Native', items: [] });
      return Promise.resolve(null);
    });
    render(<McpSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(await screen.findByText('No MCP servers configured.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Server' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex:mcp:save', expect.objectContaining({
      name: 'new-server', definition: { command: 'npx', args: ['-y', 'your-mcp-server'] },
    })));
    expect(invoke).not.toHaveBeenCalledWith('claude:mcp:save', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Edit project config' }));
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'editor', data: {
      sessionId: 'project-1', filePath: '.codex/config.toml', allowMissing: true,
    } });
  });

  it('shows Chinese controls for both Codex capability pages when Chinese is selected', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'app:settings:get') return Promise.resolve({ version: 5, language: 'zh-CN', theme: 'dark', shortcutOverrides: {} });
      if (channel === 'app:getCapabilities') return Promise.resolve({ platform: 'win32' });
      if (channel === 'codex:skills:detailed') return Promise.resolve({ runtimeLabel: 'Codex · Native', projectAvailable: true, items: [], errors: [] });
      if (channel === 'codex:mcp:list') return Promise.resolve({ runtimeLabel: 'Codex · Native', items: [] });
      return Promise.resolve({ runtimeLabel: 'Claude', projectAvailable: true, items: [], errors: [] });
    });
    const skills = render(<I18nProvider><SkillsSettings backend="codex" /></I18nProvider>);
    expect(await screen.findByText('未找到技能。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建技能' })).toBeInTheDocument();
    skills.unmount();

    render(<I18nProvider><McpSettings backend="codex" /></I18nProvider>);
    expect(await screen.findByText('尚未配置 MCP 服务器。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加服务器' })).toBeInTheDocument();
  });

  it('uses the same system scope label for Claude and Codex Skills', async () => {
    const claudeItem = { id: 'core:enabled:core-skill', name: 'core-skill', description: '', scope: 'core', enabled: true, sourcePath: 'D:/project/.claude/skills/core-skill/SKILL.md' };
    const codexItem = { name: 'system-skill', description: '', path: 'D:/codex/system-skill/SKILL.md', scope: 'system', enabled: true, editable: false };
    invoke.mockImplementation((channel: string) => {
      if (channel === 'app:settings:get') return Promise.resolve({ version: 5, language: 'zh-CN', theme: 'dark', shortcutOverrides: {} });
      if (channel === 'app:getCapabilities') return Promise.resolve({ platform: 'win32' });
      if (channel === 'claude:skills:list') return Promise.resolve({ runtimeLabel: 'Claude', projectAvailable: true, items: [claudeItem], errors: [] });
      if (channel === 'claude:skills:read') return Promise.resolve({ ...claudeItem, content: '---\nname: core-skill\ndescription: Core\n---\n' });
      if (channel === 'codex:skills:detailed') return Promise.resolve({ runtimeLabel: 'Codex', projectAvailable: true, items: [codexItem], errors: [] });
      if (channel === 'codex:skills:read') return Promise.resolve({ ...codexItem, content: '---\nname: system-skill\ndescription: System\n---\n' });
      return Promise.resolve(null);
    });
    const claude = render(<I18nProvider><SkillsSettings backend="claude" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'core-skill' }));
    expect(await screen.findByLabelText('范围')).toHaveTextContent('系统');
    claude.unmount();

    render(<I18nProvider><SkillsSettings backend="codex" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'system-skill' }));
    expect(await screen.findByLabelText('范围')).toHaveTextContent('系统');
    expect(screen.getByRole('button', { name: '复制到用户' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制到用户' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex:skills:copy', {
      sessionId: 'project-1', sourcePath: codexItem.path, scope: 'user', name: 'system-skill-copy',
    }));
  });
});
