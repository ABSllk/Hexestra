import { describe, expect, it } from 'vitest';
import {
  buildAskUserQuestionUpdatedInput,
  parseAskUserQuestionAnswers,
  parseAskUserQuestionInput,
} from '@electron/agent-interaction-contract';

const input = {
  questions: [
    {
      question: 'Which path should I test first?',
      header: 'Priority',
      options: [
        { label: 'Web', description: 'Start with the web application' },
        { label: 'Network', description: 'Start with exposed services' },
      ],
      multiSelect: false,
    },
  ],
};

describe('AskUserQuestion contract', () => {
  it('normalizes valid SDK questions and validates complete answers', () => {
    const questions = parseAskUserQuestionInput(input);
    expect(questions[0]).toMatchObject({ header: 'Priority', multiSelect: false });
    expect(parseAskUserQuestionAnswers(questions, {
      'Which path should I test first?': 'Web',
    })).toEqual({ 'Which path should I test first?': 'Web' });
    expect(buildAskUserQuestionUpdatedInput(
      { questions: input.questions, opaqueSdkField: 'preserved' },
      questions,
      { 'Which path should I test first?': 'Web' },
    )).toEqual({
      questions,
      answers: { 'Which path should I test first?': 'Web' },
      opaqueSdkField: 'preserved',
    });
  });

  it('rejects malformed, duplicate, missing, and unexpected question data', () => {
    expect(() => parseAskUserQuestionInput({ questions: [] })).toThrow(
      'Invalid AskUserQuestion input',
    );
    expect(() => parseAskUserQuestionInput({
      questions: [input.questions[0], input.questions[0]],
    })).toThrow('Question text must be unique');

    const questions = parseAskUserQuestionInput(input);
    expect(() => parseAskUserQuestionAnswers(questions, {})).toThrow('Missing answer');
    expect(() => parseAskUserQuestionAnswers(questions, {
      'Which path should I test first?': 'Web',
      'Not requested': 'Anything',
    })).toThrow('Unexpected answer');
  });
});
