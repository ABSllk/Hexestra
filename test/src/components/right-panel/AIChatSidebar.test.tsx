import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore, useTabStore } from '@/stores';
import type { AskUserQuestionRequest } from '@/types';
import { AIChatSidebar } from '@/components/right-panel/AIChatSidebar';

const questionRequest: AskUserQuestionRequest = {
  kind: 'ask_user_question',
  id: 'question-layout',
  toolUseId: 'tool-layout',
  toolName: 'AskUserQuestion',
  createdAt: '2026-07-31T00:00:00.000Z',
  questions: [{
    question: 'Which target should be prioritized?',
    header: 'Target',
    options: [{ label: 'Web', description: 'Start with the web application' }],
    multiSelect: false,
  }],
};

describe('AIChatSidebar interaction layout', () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    useChatStore.setState({
      activeProjectId: 'project-a',
      messages: [],
      pendingToolRequest: questionRequest,
      isProcessing: true,
      contextTabs: [],
      subscribeToAgent: () => () => {},
      syncContextTabs: vi.fn(),
    });
  });

  it('docks a pending question inside the constrained chat workspace', () => {
    render(<AIChatSidebar />);

    const workspace = screen.getByTestId('chat-workspace');
    const dock = screen.getByTestId('agent-interaction-dock');
    const composer = screen.getByPlaceholderText('Message AI assistant...').closest<HTMLDivElement>('div.shrink-0');

    expect(workspace).toContainElement(dock);
    expect(workspace).toContainElement(composer);
    expect(dock).toHaveClass('max-h-[60%]', 'overflow-y-auto', 'shrink-0', 'z-20');
    expect(dock.compareDocumentPosition(composer as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Claude question' })).not.toHaveClass('max-h-[58vh]');
  });
});
