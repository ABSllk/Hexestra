import { useMemo } from 'react';
import { Icon, type IconName } from '@/components/shared';
import { cn } from '@/lib/cn';
import { usePentestTreeStore } from '@/stores';
import {
  calculateOverallProgress,
  groupTasksByStage,
} from '@/stores/usePentestTreeStore';
import { STAGE_META, type PentestStage, type PentestTask, type TaskStatus } from '@/types';

const STAGE_ORDER: PentestStage[] = [
  'S0',
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'S7',
  'S8',
  'disengage',
];

export function TaskTreeTab() {
  const tasks = usePentestTreeStore((s) => s.tasks);
  const expandedStages = usePentestTreeStore((s) => s.expandedStages);
  const expandedTaskIds = usePentestTreeStore((s) => s.expandedTaskIds);
  const toggleStage = usePentestTreeStore((s) => s.toggleStage);
  const toggleTask = usePentestTreeStore((s) => s.toggleTask);
  const selectTask = usePentestTreeStore((s) => s.selectTask);
  const selectedTaskId = usePentestTreeStore((s) => s.selectedTaskId);
  const updateTaskStatus = usePentestTreeStore((s) => s.updateTaskStatus);
  // Derived objects must not be created inside a Zustand selector. React's
  // external-store contract treats every new object as a changed snapshot.
  const tasksByStage = useMemo(() => groupTasksByStage(tasks), [tasks]);
  const progress = useMemo(() => calculateOverallProgress(tasks), [tasks]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-surface bg-bg-tertiary/50 px-3 py-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-text-secondary">MITRE ATT&amp;CK</span>
          <span className="text-2xs text-text-muted">{progress}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-accent-blue transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {STAGE_ORDER.map((stage) => {
          const meta = STAGE_META[stage];
          const isExpanded = expandedStages.includes(stage);
          const stageTasks = tasksByStage[stage] ?? [];

          return (
            <div key={stage} className="mx-1.5 my-0.5 overflow-hidden rounded-md border border-transparent hover:border-surface/35">
              <button
                onClick={() => {
                  toggleStage(stage);
                  if (isExpanded && tasks.find((task) => task.id === selectedTaskId)?.stage === stage) {
                    selectTask(null);
                  }
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-surface/25"
              >
                <Icon
                  name="chevron-right"
                  size={13}
                  className={cn('text-text-muted transition-transform', isExpanded && 'rotate-90')}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-semibold text-text-secondary">
                      {meta.label}
                    </span>
                    <span className="font-mono text-2xs text-text-muted">{meta.mitreId}</span>
                  </div>
                </div>
                {stageTasks.length > 0 && (
                  <span className="text-2xs text-text-muted">
                    {stageTasks.filter((task) => task.status === 'completed').length}/{stageTasks.length}
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="rounded-b-md bg-bg-tertiary/30 pb-1">
                  {stageTasks.length === 0 ? (
                    <p className="px-5 py-2 text-2xs italic text-text-muted">No tasks yet</p>
                  ) : (
                    <TaskBranch
                      tasks={stageTasks}
                      parentId={undefined}
                      expandedTaskIds={expandedTaskIds}
                      selectedTaskId={selectedTaskId}
                      onToggle={toggleTask}
                      onSelect={selectTask}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {selectedTaskId && (
        <TaskDetail
          task={tasks.find((task) => task.id === selectedTaskId)}
          onStatusChange={(status) => updateTaskStatus(selectedTaskId, status)}
        />
      )}
      <span className="sr-only">{tasks.length} tasks</span>
    </div>
  );
}

function TaskBranch({
  tasks,
  parentId,
  expandedTaskIds,
  selectedTaskId,
  onToggle,
  onSelect,
  depth = 0,
}: {
  tasks: PentestTask[];
  parentId: string | undefined;
  expandedTaskIds: string[];
  selectedTaskId: string | null;
  onToggle: (taskId: string) => void;
  onSelect: (taskId: string | null) => void;
  depth?: number;
}) {
  const children = tasks.filter((task) => task.parentId === parentId);
  return children.map((task) => {
    const descendants = tasks.filter((candidate) => candidate.parentId === task.id);
    const hasChildren = descendants.length > 0;
    const isExpanded = expandedTaskIds.includes(task.id);
    return (
      <div
        key={task.id}
        className={cn('relative', depth > 0 && 'ml-5 border-l border-accent-teal/20')}
      >
        {depth > 0 && (
          <span className="pointer-events-none absolute left-0 top-4 h-px w-3 bg-accent-teal/25" />
        )}
        <div
          className={cn(
            'group mr-1 flex min-h-8 items-center gap-1.5 rounded-r-md border-l-2 border-l-transparent pr-2 text-2xs hover:bg-surface/30',
            depth === 0 ? 'pl-4' : 'pl-3',
            selectedTaskId === task.id && 'border-l-accent-blue bg-accent-blue/10',
          )}
        >
          {hasChildren ? (
            <button
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${task.title}`}
              onClick={() => onToggle(task.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center text-text-muted hover:text-text-primary"
            >
              <Icon
                name="chevron-right"
                size={11}
                className={cn('transition-transform', isExpanded && 'rotate-90')}
              />
            </button>
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <span className="h-1 w-1 rounded-full bg-accent-teal/30" />
            </span>
          )}
          <button
            onClick={() => onSelect(task.id)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          >
            <TaskStatusIcon status={task.status} />
            <span className={cn(
              'truncate text-text-primary',
              task.status === 'completed' && 'text-text-muted line-through decoration-text-muted/40',
            )}>
              {task.title}
            </span>
          </button>
          {hasChildren && (
            <span className="font-mono text-[9px] text-text-muted">
              {descendants.filter((child) => child.status === 'completed').length}/{descendants.length}
            </span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <TaskBranch
            tasks={tasks}
            parentId={task.id}
            expandedTaskIds={expandedTaskIds}
            selectedTaskId={selectedTaskId}
            onToggle={onToggle}
            onSelect={onSelect}
            depth={depth + 1}
          />
        )}
      </div>
    );
  });
}

const TASK_STATUS_ACTIONS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'pending', label: 'Pending' },
  { status: 'in_progress', label: 'Start' },
  { status: 'completed', label: 'Complete' },
  { status: 'blocked', label: 'Block' },
];

function TaskDetail({ task, onStatusChange }: {
  task: PentestTask | undefined;
  onStatusChange: (status: TaskStatus) => void;
}) {
  if (!task) return null;
  return (
    <div className="max-h-48 shrink-0 overflow-y-auto border-t border-surface bg-bg-tertiary/75 p-3">
      <div className="mb-1 text-xs font-semibold text-text-primary">{task.title}</div>
      <p className="mb-3 text-2xs leading-relaxed text-text-muted">{task.description}</p>
      <div className="flex flex-wrap gap-1">
        {TASK_STATUS_ACTIONS.map((action) => (
          <button
            key={action.status}
            onClick={() => onStatusChange(action.status)}
            className={cn(
              'rounded border px-2 py-1 text-2xs transition-colors',
              task.status === action.status
                ? 'border-accent-blue bg-accent-blue/15 text-accent-blue'
                : 'border-surface text-text-muted hover:border-surface-active hover:text-text-primary',
            )}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskStatusIcon({ status }: { status: string }) {
  const icons: Record<string, IconName> = {
    pending: 'circle',
    in_progress: 'activity',
    completed: 'check',
    blocked: 'pause',
    skipped: 'skip',
    failed: 'close',
  };
  const colors: Record<string, string> = {
    pending: 'text-text-muted',
    in_progress: 'text-accent-blue',
    completed: 'text-accent-green',
    blocked: 'text-severity-medium',
    skipped: 'text-text-muted',
    failed: 'text-severity-critical',
  };

  return (
    <Icon
      name={icons[status] ?? 'circle'}
      size={12}
      className={colors[status] ?? 'text-text-muted'}
    />
  );
}
