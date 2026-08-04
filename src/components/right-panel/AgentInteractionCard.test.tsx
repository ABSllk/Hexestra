import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores';
import type { AskUserQuestionRequest, ToolApprovalRequest } from '@/types';
import { AgentInteractionCard } from './AgentInteractionCard';

const answerUserQuestion = vi.fn(async () => {});
const rejectToolRequest = vi.fn();
const approveToolRequest = vi.fn(async () => {});

const questionRequest: AskUserQuestionRequest = {
  kind: 'ask_user_question',
  id: 'question-1',
  toolUseId: 'tool-1',
  toolName: 'AskUserQuestion',
  createdAt: '2026-07-31T00:00:00.000Z',
  questions: [
    {
      question: 'Which path should Claude prioritize?',
      header: 'Priority',
      options: [
        { label: 'Web', description: 'Test the web application first' },
        { label: 'Network', description: 'Test exposed services first' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which checks should be included?',
      header: 'Checks',
      options: [
        { label: 'Headers', description: 'Review security headers' },
        { label: 'Auth', description: 'Review authentication behavior' },
      ],
      multiSelect: true,
    },
  ],
};

describe('AgentInteractionCard', () => {
  beforeEach(() => {
    answerUserQuestion.mockClear();
    rejectToolRequest.mockClear();
    approveToolRequest.mockClear();
    useChatStore.setState({
      answerUserQuestion,
      rejectToolRequest,
      approveToolRequest,
    });
  });

  it('collects single and multiple selections before resuming Claude', async () => {
    render(<AgentInteractionCard request={questionRequest} />);

    const submit = screen.getByRole('button', { name: 'Send answers' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByDisplayValue('Web'));
    fireEvent.click(screen.getByDisplayValue('Headers'));
    fireEvent.click(screen.getByDisplayValue('Auth'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(answerUserQuestion).toHaveBeenCalledWith('question-1', {
      'Which path should Claude prioritize?': 'Web',
      'Which checks should be included?': 'Headers, Auth',
    }));
  });

  it('supports per-question free text', async () => {
    render(<AgentInteractionCard request={{ ...questionRequest, questions: [questionRequest.questions[0]] }} />);

    fireEvent.change(
      screen.getByLabelText('Custom answer for Which path should Claude prioritize?'),
      { target: { value: 'Start with the login flow' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
    await waitFor(() => expect(answerUserQuestion).toHaveBeenCalledWith('question-1', {
      'Which path should Claude prioritize?': 'Start with the login flow',
    }));
  });

  it('lets the operator cancel a clarifying question', () => {
    render(<AgentInteractionCard request={{ ...questionRequest, questions: [questionRequest.questions[0]] }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(rejectToolRequest).toHaveBeenCalledWith('question-1');
  });

  it('keeps the ordinary tool approval flow intact', () => {
    const approval: ToolApprovalRequest = {
      kind: 'tool_approval',
      id: 'approval-1',
      toolUseId: 'tool-2',
      toolName: 'Bash',
      input: { command: 'nmap example.com' },
      description: 'Run nmap example.com',
      riskLevel: 'write',
      createdAt: '2026-07-31T00:00:00.000Z',
    };
    render(<AgentInteractionCard request={approval} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    expect(approveToolRequest).toHaveBeenCalledWith('approval-1');
  });
});
