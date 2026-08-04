import { z } from 'zod';

const askUserQuestionOptionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000),
  preview: z.string().max(20_000).optional(),
});

const askUserQuestionSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  header: z.string().trim().min(1).max(12),
  options: z.array(askUserQuestionOptionSchema).min(2).max(4),
  multiSelect: z.boolean(),
}).superRefine(({ options }, context) => {
  const seen = new Set<string>();
  options.forEach(({ label }, index) => {
    if (seen.has(label)) {
      context.addIssue({
        code: 'custom',
        path: ['options', index, 'label'],
        message: 'Option labels must be unique',
      });
    }
    seen.add(label);
  });
});

const askUserQuestionInputSchema = z.object({
  questions: z.array(askUserQuestionSchema).min(1).max(4),
}).superRefine(({ questions }, context) => {
  const seen = new Set<string>();
  questions.forEach(({ question }, index) => {
    if (seen.has(question)) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index, 'question'],
        message: 'Question text must be unique',
      });
    }
    seen.add(question);
  });
});

const askUserQuestionAnswersSchema = z.record(
  z.string().min(1).max(2_000),
  z.string().trim().min(1).max(4_000),
);

export type AskUserQuestionOption = z.infer<typeof askUserQuestionOptionSchema>;
export type AskUserQuestion = z.infer<typeof askUserQuestionSchema>;
export type AskUserQuestionAnswers = Record<string, string>;

interface InteractionRequestBase {
  id: string;
  toolUseId: string;
  createdAt: string;
}

export interface ToolApprovalRequest extends InteractionRequestBase {
  kind: 'tool_approval';
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  riskLevel: 'read' | 'write';
}

export interface AskUserQuestionRequest extends InteractionRequestBase {
  kind: 'ask_user_question';
  toolName: 'AskUserQuestion';
  questions: AskUserQuestion[];
}

export type ToolRequest = ToolApprovalRequest | AskUserQuestionRequest;

export function parseAskUserQuestionInput(input: Record<string, unknown>): AskUserQuestion[] {
  const result = askUserQuestionInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid AskUserQuestion input: ${z.prettifyError(result.error)}`);
  }
  return result.data.questions;
}

export function parseAskUserQuestionAnswers(
  questions: AskUserQuestion[],
  input: unknown,
): AskUserQuestionAnswers {
  const result = askUserQuestionAnswersSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid AskUserQuestion answers: ${z.prettifyError(result.error)}`);
  }

  const expectedQuestions = new Set(questions.map(({ question }) => question));
  for (const question of expectedQuestions) {
    if (!(question in result.data)) {
      throw new Error(`Missing answer for question: ${question}`);
    }
  }
  for (const question of Object.keys(result.data)) {
    if (!expectedQuestions.has(question)) {
      throw new Error(`Unexpected answer for question: ${question}`);
    }
  }
  return result.data;
}

export function buildAskUserQuestionUpdatedInput(
  originalInput: Record<string, unknown>,
  questions: AskUserQuestion[],
  answersInput: unknown,
): Record<string, unknown> {
  return {
    ...originalInput,
    questions,
    answers: parseAskUserQuestionAnswers(questions, answersInput),
  };
}
