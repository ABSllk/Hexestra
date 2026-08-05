import { useMemo, useState } from 'react';
import { Icon } from '@/components/shared';
import { useChatStore } from '@/stores';
import type {
  AskUserQuestion,
  AskUserQuestionAnswers,
  AskUserQuestionRequest,
  ToolApprovalRequest,
  ToolRequest,
} from '@/types';

export function AgentInteractionCard({ request }: { request: ToolRequest }) {
  return request.kind === 'ask_user_question'
    ? <AskUserQuestionCard request={request} />
    : <ToolApprovalCard request={request} />;
}

function ToolApprovalCard({ request }: { request: ToolApprovalRequest }) {
  const approve = useChatStore((state) => state.approveToolRequest);
  const reject = useChatStore((state) => state.rejectToolRequest);

  return (
    <section className="shrink-0 border-t border-severity-medium/30 bg-[#17130d] p-3" aria-label="Tool approval">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="tool" size={14} className="text-severity-medium" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-text-primary">{request.toolName}</p>
          <p className="text-[9px] uppercase tracking-wider text-severity-medium">
            Human approval required · {request.riskLevel}
          </p>
        </div>
      </div>
      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-primary/70 p-2 font-mono text-[9px] text-text-muted">
        {request.description}
      </pre>
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={() => reject(request.id)}
          className="rounded border border-surface px-2.5 py-1 text-2xs text-text-muted hover:text-text-primary"
        >
          Reject
        </button>
        <button
          onClick={() => void approve(request.id)}
          className="rounded border border-accent-green/30 bg-accent-green/10 px-2.5 py-1 text-2xs text-accent-green"
        >
          Approve once
        </button>
      </div>
    </section>
  );
}

interface AnswerDraft {
  selected: string[];
  customActive: boolean;
  custom: string;
}

function AskUserQuestionCard({ request }: { request: AskUserQuestionRequest }) {
  const answer = useChatStore((state) => state.answerUserQuestion);
  const reject = useChatStore((state) => state.rejectToolRequest);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>(() =>
    Object.fromEntries(request.questions.map(({ question }) => [question, emptyDraft()])),
  );

  const answers = useMemo(
    () => buildAnswers(request.questions, drafts),
    [drafts, request.questions],
  );

  const selectOption = (question: AskUserQuestion, label: string) => {
    setDrafts((current) => {
      const draft = current[question.question] ?? emptyDraft();
      const selected = question.multiSelect
        ? draft.selected.includes(label)
          ? draft.selected.filter((candidate) => candidate !== label)
          : [...draft.selected, label]
        : [label];
      return {
        ...current,
        [question.question]: {
          ...draft,
          selected,
          ...(question.multiSelect ? {} : { customActive: false }),
        },
      };
    });
  };

  const setCustomActive = (question: AskUserQuestion, active: boolean) => {
    setDrafts((current) => {
      const draft = current[question.question] ?? emptyDraft();
      return {
        ...current,
        [question.question]: {
          ...draft,
          customActive: active,
          ...(!question.multiSelect && active ? { selected: [] } : {}),
        },
      };
    });
  };

  const setCustom = (question: AskUserQuestion, custom: string) => {
    setDrafts((current) => {
      const draft = current[question.question] ?? emptyDraft();
      return {
        ...current,
        [question.question]: {
          ...draft,
          custom,
          customActive: true,
          ...(!question.multiSelect ? { selected: [] } : {}),
        },
      };
    });
  };

  const submit = async () => {
    if (!answers || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await answer(request.id, answers);
    } catch (error) {
      setSubmitError(String(error));
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Claude question"
      className="border-t border-accent-blue/25 bg-[#10151e] p-3"
    >
      <div className="mb-3 flex items-start gap-2">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent-blue/20 bg-accent-blue/10">
          <Icon name="message" size={13} className="text-accent-blue" />
        </div>
        <div>
          <p className="text-xs font-semibold text-text-primary">Claude needs your input</p>
          <p className="mt-0.5 text-[9px] leading-relaxed text-text-muted">
            The Agent is paused. Your answers will be returned to the active Claude turn.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {request.questions.map((question, questionIndex) => {
          const draft = drafts[question.question] ?? emptyDraft();
          return (
            <fieldset key={question.question} className="min-w-0">
              <legend className="mb-2 w-full">
                <span className="mr-2 rounded border border-surface bg-bg-primary px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-accent-blue">
                  {question.header}
                </span>
                <span className="text-[9px] text-text-muted">
                  {questionIndex + 1}/{request.questions.length}
                  {question.multiSelect ? ' · multiple choices' : ''}
                </span>
                <span className="mt-1.5 block text-[11px] font-medium leading-relaxed text-text-primary">
                  {question.question}
                </span>
              </legend>

              <div className="space-y-1.5">
                {question.options.map((option) => {
                  const selected = draft.selected.includes(option.label);
                  return (
                    <label
                      key={option.label}
                      className={selected
                        ? 'flex cursor-pointer gap-2 rounded-md border border-accent-blue/35 bg-accent-blue/10 p-2'
                        : 'flex cursor-pointer gap-2 rounded-md border border-surface/70 bg-bg-primary/45 p-2 hover:border-surface-hover'}
                    >
                      <input
                        checked={selected}
                        className="mt-0.5 accent-[#89b4fa]"
                        name={`question-${request.id}-${questionIndex}`}
                        onChange={() => selectOption(question, option.label)}
                        type={question.multiSelect ? 'checkbox' : 'radio'}
                        value={option.label}
                      />
                      <span className="min-w-0">
                        <span className="block text-[10px] font-medium text-text-primary">{option.label}</span>
                        <span className="mt-0.5 block text-[9px] leading-relaxed text-text-muted">
                          {option.description}
                        </span>
                        {option.preview && (
                          <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-surface/60 bg-bg-tertiary p-1.5 font-mono text-[8px] text-text-secondary">
                            {option.preview}
                          </pre>
                        )}
                      </span>
                    </label>
                  );
                })}

                <label className={draft.customActive
                  ? 'block rounded-md border border-accent-blue/35 bg-accent-blue/10 p-2'
                  : 'block rounded-md border border-surface/70 bg-bg-primary/45 p-2 hover:border-surface-hover'}
                >
                  <span className="flex cursor-pointer items-center gap-2 text-[10px] font-medium text-text-primary">
                    <input
                      checked={draft.customActive}
                      className="accent-[#89b4fa]"
                      name={`question-${request.id}-${questionIndex}`}
                      onChange={(event) => setCustomActive(question, event.target.checked)}
                      type={question.multiSelect ? 'checkbox' : 'radio'}
                    />
                    Other
                  </span>
                  <input
                    aria-label={`Custom answer for ${question.question}`}
                    className="mt-1.5 w-full rounded border border-surface bg-bg-tertiary px-2 py-1.5 text-[10px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-blue/50"
                    onChange={(event) => setCustom(question, event.target.value)}
                    onFocus={() => setCustomActive(question, true)}
                    placeholder="Type your own answer"
                    value={draft.custom}
                  />
                </label>
              </div>
            </fieldset>
          );
        })}
      </div>

      {submitError && (
        <p className="mt-2 rounded border border-severity-critical/25 bg-severity-critical/10 px-2 py-1.5 text-[9px] text-severity-critical">
          {submitError}
        </p>
      )}

      <div className="sticky bottom-0 -mx-3 -mb-3 mt-3 flex justify-end gap-2 border-t border-surface/50 bg-[#10151e] px-3 py-2.5">
        <button
          disabled={submitting}
          onClick={() => reject(request.id)}
          className="rounded border border-surface px-2.5 py-1 text-2xs text-text-muted hover:text-text-primary disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          disabled={!answers || submitting}
          onClick={() => void submit()}
          className="rounded border border-accent-blue/30 bg-accent-blue/10 px-2.5 py-1 text-2xs font-medium text-accent-blue disabled:cursor-not-allowed disabled:opacity-35"
        >
          {submitting ? 'Sending…' : 'Send answers'}
        </button>
      </div>
    </section>
  );
}

function emptyDraft(): AnswerDraft {
  return { selected: [], customActive: false, custom: '' };
}

function buildAnswers(
  questions: AskUserQuestion[],
  drafts: Record<string, AnswerDraft>,
): AskUserQuestionAnswers | null {
  const answers: AskUserQuestionAnswers = {};
  for (const question of questions) {
    const draft = drafts[question.question] ?? emptyDraft();
    const custom = draft.custom.trim();
    const values = question.multiSelect
      ? [...draft.selected, ...(draft.customActive && custom ? [custom] : [])]
      : draft.customActive
        ? custom ? [custom] : []
        : draft.selected.slice(0, 1);
    if (values.length === 0) return null;
    answers[question.question] = values.join(', ');
  }
  return answers;
}
