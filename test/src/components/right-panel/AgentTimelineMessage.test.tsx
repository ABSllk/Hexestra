import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, SubagentRun } from '@/types';
import { AgentTimelineMessage } from '@/components/right-panel/AgentTimelineMessage';
import { useSessionStore } from '@/stores/useSessionStore';
import { useTabStore } from '@/stores/useTabStore';

describe('AgentTimelineMessage', () => {
  beforeEach(() => {
    useSessionStore.setState({ currentSession: null });
    useTabStore.getState().resetProject();
  });
  it('renders text, collapsed thinking, and tool execution in source order', () => {
    const message: ChatMessage = {
      id: 'assistant-turn',
      role: 'assistant',
      content: 'Inspecting `package.json`.\n\nThe version is pinned.',
      timestamp: new Date().toISOString(),
      status: 'complete',
      activities: [
        { id: 'text-before', kind: 'text', status: 'complete', content: 'Inspecting `package.json`.' },
        { id: 'thinking', kind: 'thinking', status: 'complete', content: 'Choose the smallest relevant file range.' },
        {
          id: 'read',
          kind: 'tool',
          status: 'complete',
          toolUseId: 'tool-1',
          toolName: 'Read',
          label: 'Read',
          summary: 'package.json (lines 1-10)',
          input: { file_path: 'package.json', offset: 1, limit: 10 },
          output: '{ "name": "hexestra" }',
          outputSummary: 'Completed',
        },
        { id: 'text-after', kind: 'text', status: 'complete', content: 'The project is **Hexestra**.' },
      ],
    };

    render(<AgentTimelineMessage message={message} />);

    const timeline = screen.getByRole('article', { name: 'AI activity timeline' });
    const text = timeline.textContent ?? '';
    expect(text.indexOf('Inspecting')).toBeLessThan(text.indexOf('Thinking'));
    expect(text.indexOf('Thinking')).toBeLessThan(text.indexOf('Read'));
    expect(text.indexOf('Read')).toBeLessThan(text.indexOf('The project is Hexestra.'));
    expect(screen.getByText('package.json', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText('Hexestra', { selector: 'strong' })).toBeInTheDocument();

    const thinking = screen.getByText('Thinking').closest('details');
    expect(thinking).not.toHaveAttribute('open');
    const tool = screen.getByText('Read').closest('details');
    expect(tool).not.toHaveAttribute('open');
    expect(within(tool!).getByText('Completed')).toBeInTheDocument();
  });

  it('shows failure states without replacing preceding activity content', () => {
    const message: ChatMessage = {
      id: 'failed-turn',
      role: 'assistant',
      content: 'Starting scan',
      timestamp: new Date().toISOString(),
      status: 'error',
      activities: [
        { id: 'text', kind: 'text', status: 'complete', content: 'Starting scan' },
        {
          id: 'tool',
          kind: 'tool',
          status: 'error',
          toolName: 'Bash',
          label: 'Bash',
          summary: 'nmap -sV 192.0.2.10',
          outputSummary: 'permission denied',
        },
      ],
    };

    render(<AgentTimelineMessage message={message} />);

    expect(screen.getByText('Starting scan')).toBeInTheDocument();
    expect(screen.getByText('permission denied')).toBeInTheDocument();
    expect(screen.getByText('Request failed')).toBeInTheDocument();
  });

  it('renders GitHub-flavored Markdown without enabling raw HTML', () => {
    const markdown = [
      '# Findings',
      '',
      '- [x] HTTPS verified',
      '- ~~HTTP open~~',
      '',
      '> Validate with the operator.',
      '',
      '| Port | Service |',
      '| --- | --- |',
      '| 443 | `https` |',
      '',
      '[Reference](https://example.com)',
      '',
      '<script>alert("unsafe")</script>',
    ].join('\n');
    const message: ChatMessage = {
      id: 'markdown-turn',
      role: 'assistant',
      content: markdown,
      timestamp: new Date().toISOString(),
      status: 'complete',
      activities: [{ id: 'markdown', kind: 'text', status: 'complete', content: markdown }],
    };

    const { container } = render(<AgentTimelineMessage message={message} />);

    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('https', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText('HTTP open', { selector: 'del' })).toBeInTheDocument();
    expect(screen.getByText('Validate with the operator.').closest('blockquote')).toBeInTheDocument();
    const reference = screen.getByRole('link', { name: 'Reference' });
    expect(reference).not.toHaveAttribute('target');
    fireEvent.click(reference);
    expect(useTabStore.getState().tabs).toContainEqual(expect.objectContaining({
      type: 'browser', data: { url: 'https://example.com/' },
    }));
    expect(container.querySelector('script')).not.toBeInTheDocument();
  });

  it('opens project Markdown links in the existing editor instead of another app window', () => {
    useSessionStore.setState({ currentSession: {
      id: 'project-1', name: 'Project', basePath: 'D:\\projects\\demo', status: 'active',
      createdAt: '', updatedAt: '', opsecLevel: 'balanced', autonomyLevel: 'medium',
      targetCount: 0, findingCount: 0, vulnerabilityCount: 0,
    } });
    const message: ChatMessage = {
      id: 'file-link', role: 'assistant', content: '[ptt.md](ptt.md)', timestamp: '', status: 'complete',
      activities: [{ id: 'answer', kind: 'text', status: 'complete', content: '[ptt.md](ptt.md)' }],
    };
    render(<AgentTimelineMessage message={message} />);
    const link = screen.getByRole('link', { name: 'ptt.md' });
    expect(link).not.toHaveAttribute('target');
    fireEvent.click(link);
    expect(useTabStore.getState().tabs).toContainEqual(expect.objectContaining({
      type: 'editor', data: { filePath: 'ptt.md', sessionId: 'project-1' },
    }));
    fireEvent.click(link);
    expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'editor')).toHaveLength(1);
  });

  it('keeps project file URLs clickable after Markdown sanitization', () => {
    useSessionStore.setState({ currentSession: {
      id: 'project-1', name: 'Project', basePath: 'D:\\projects\\demo', status: 'active',
      createdAt: '', updatedAt: '', opsecLevel: 'balanced', autonomyLevel: 'medium',
      targetCount: 0, findingCount: 0, vulnerabilityCount: 0,
    } });
    const content = '[ptt.md](file:///D:/projects/demo/ptt.md)';
    render(<AgentTimelineMessage message={{
      id: 'file-url', role: 'assistant', content, timestamp: '', status: 'complete',
      activities: [{ id: 'answer', kind: 'text', status: 'complete', content }],
    }} />);
    const link = screen.getByRole('link', { name: 'ptt.md' });
    expect(link).toHaveAttribute('href', 'file:///D:/projects/demo/ptt.md');
    fireEvent.click(link);
    expect(useTabStore.getState().tabs).toContainEqual(expect.objectContaining({
      type: 'editor', data: { filePath: 'ptt.md', sessionId: 'project-1' },
    }));
  });

  it('keeps live token text lightweight until the activity completes', () => {
    const message: ChatMessage = {
      id: 'streaming-turn',
      role: 'assistant',
      content: '**Live answer**',
      timestamp: new Date().toISOString(),
      status: 'streaming',
      activities: [{
        id: 'live-text',
        kind: 'text',
        status: 'streaming',
        content: '**Live answer**',
      }],
    };

    const { container } = render(<AgentTimelineMessage message={message} />);
    expect(screen.getByText('**Live answer**')).toBeInTheDocument();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('renders a live subagent card with metrics and opens its right-panel detail', () => {
    const message: ChatMessage = {
      id: 'delegating-turn',
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
      activities: [{
        id: 'agent-tool',
        kind: 'tool',
        status: 'running',
        toolUseId: 'spawn-1',
        toolName: 'Agent',
        subagentRunId: 'run-1',
        agentType: 'Explore',
        subagentDescription: 'Inspect response headers',
      }],
    };
    const run: SubagentRun = {
      id: 'run-1',
      taskId: 'task-1',
      agentType: 'Explore',
      description: 'Inspect response headers',
      status: 'running',
      startedAt: new Date(Date.now() - 1_000).toISOString(),
      updatedAt: new Date().toISOString(),
      lastToolName: 'Read',
      usage: { toolUses: 2, totalTokens: 128 },
      activities: [],
    };
    const onOpen = vi.fn();

    render(<AgentTimelineMessage message={message} subagentRuns={[run]} onOpenSubagent={onOpen} />);

    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText(/2 tools/)).toBeInTheDocument();
    expect(screen.getByText(/128 tokens/)).toBeInTheDocument();
    screen.getByRole('button', { name: /open inspect response headers output/i }).click();
    expect(onOpen).toHaveBeenCalledWith('run-1');
  });
});
