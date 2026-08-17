import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/shared";
import { cn } from "@/lib/cn";
import { usePentestTreeStore, useSessionStore } from "@/stores";
import {
  calculateOverallProgress,
  groupTasksByTactic,
  groupTasksByTechnique,
} from "@/stores/usePentestTreeStore";
import type {
  ExecutionStep,
  PentestObjective,
  PentestTask,
  PentestTaskInput,
  TaskStatus,
  TaskTracePackage,
} from "@/types";
import { ATTACK_TACTICS, ATTACK_TECHNIQUES } from "@electron/contracts/tasks";
import { WorkflowLibraryView } from "./WorkflowLibraryView";
import { KnowledgeRefineryLibraryView } from "./KnowledgeRefineryLibraryView";
import { useI18n } from "@/i18n";

export function TaskTreeTab() {
  const tasks = usePentestTreeStore((state) => state.tasks);
  const expandedTactics = usePentestTreeStore((state) => state.expandedTactics);
  const expandedTaskIds = usePentestTreeStore((state) => state.expandedTaskIds);
  const toggleTactic = usePentestTreeStore((state) => state.toggleTactic);
  const toggleTask = usePentestTreeStore((state) => state.toggleTask);
  const selectTask = usePentestTreeStore((state) => state.selectTask);
  const selectedTaskId = usePentestTreeStore((state) => state.selectedTaskId);
  const updateTaskStatus = usePentestTreeStore(
    (state) => state.updateTaskStatus,
  );
  const upsertTask = usePentestTreeStore((state) => state.upsertTask);
  const focusTask = usePentestTreeStore((state) => state.focusTask);
  const focusedTaskId = usePentestTreeStore((state) => state.focusedTaskId);
  const pttStatus = usePentestTreeStore((state) => state.pttStatus);
  const rebuildPtt = usePentestTreeStore((state) => state.rebuildPtt);
  const [coverageView, setCoverageView] = useState(false);
  const [collapsedTechniques, setCollapsedTechniques] = useState<string[]>([]);
  const [panelView, setPanelView] = useState<
    "tasks" | "workflows" | "refinery"
  >("tasks");
  const { t } = useI18n();
  const objectives = tasks.filter(
    (task): task is PentestObjective => task.kind === "objective",
  );
  const tasksByTactic = useMemo(() => groupTasksByTactic(tasks), [tasks]);
  const tasksByTechnique = useMemo(() => groupTasksByTechnique(tasks), [tasks]);
  const progress = useMemo(() => calculateOverallProgress(tasks), [tasks]);

  return (
    <div className="flex h-full flex-col bg-canvas text-text-primary">
      <div className="shrink-0 border-b border-border-subtle bg-panel/70 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 rounded border border-border-subtle bg-panel p-0.5">
            <button
              type="button"
              aria-pressed={panelView === "tasks"}
              onClick={() => setPanelView("tasks")}
              className={cn(
                "rounded px-2 py-1 text-[10px]",
                panelView === "tasks"
                  ? "bg-raised text-text-primary"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              {t("taskTree.tasks")}
            </button>
            <button
              type="button"
              aria-pressed={panelView === "workflows"}
              onClick={() => setPanelView("workflows")}
              className={cn(
                "rounded px-2 py-1 text-[10px]",
                panelView === "workflows"
                  ? "bg-raised text-accent-blue"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              {t("taskTree.workflows")}
            </button>
            <button
              type="button"
              aria-pressed={panelView === "refinery"}
              onClick={() => setPanelView("refinery")}
              className={cn(
                "rounded px-2 py-1 text-[10px]",
                panelView === "refinery"
                  ? "bg-raised text-accent-blue"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              {t("taskTree.refinery")}
            </button>
          </div>
          {panelView === "tasks" && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-text-muted">
                {objectives.length}
              </span>
              <button
                aria-pressed={coverageView}
                onClick={() => setCoverageView((value) => !value)}
                className="rounded border border-border-subtle px-2 py-1 text-[10px] text-accent-blue hover:bg-accent-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {coverageView ? "Tasks only" : "Coverage"}
              </button>
            </div>
          )}
        </div>
        {panelView === "tasks" && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full bg-accent-blue transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-text-muted">
              {progress}%
            </span>
          </div>
        )}
      </div>
      {panelView === "workflows" ? (
        <WorkflowLibraryView />
      ) : panelView === "refinery" ? (
        <KnowledgeRefineryLibraryView />
      ) : (
        <>
          {pttStatus?.kind === "legacy_unsupported" && (
            <div className="m-2 rounded border border-severity-medium/35 bg-severity-medium/10 p-2 text-[11px] text-severity-medium">
              <p className="mb-2">
                Retired Stage-format PTT detected. Rebuild it as an empty
                ATT&amp;CK tree; the original is backed up read-only.
              </p>
              <button
                onClick={() => void rebuildPtt()}
                className="rounded border border-severity-medium/40 px-2 py-1 text-2xs hover:bg-severity-medium/10"
              >
                Rebuild PTT
              </button>
            </div>
          )}
          {pttStatus?.kind === "invalid" && (
            <div className="m-2 rounded border border-severity-medium/35 bg-severity-medium/10 p-2 text-[11px] text-severity-medium">
              <p className="font-medium">PTT needs attention</p>
              <p className="mt-1">
                {pttStatus.diagnostics.slice(0, 2).join(" · ")}
              </p>
            </div>
          )}
          <div
            role="tree"
            aria-label="ATT&CK task tree"
            className="flex-1 overflow-y-auto py-1"
          >
            {ATTACK_TACTICS.map((tactic) => {
              const tacticObjectives =
                (tasksByTactic[tactic.id] as PentestObjective[] | undefined) ??
                [];
              const techniqueIds = [
                ...new Set(
                  tacticObjectives
                    .map((task) => task.techniqueIds[0])
                    .filter((id): id is string => Boolean(id)),
                ),
              ];
              if (!coverageView && tacticObjectives.length === 0) return null;
              const expanded = expandedTactics.includes(tactic.id);
              const done = tacticObjectives.filter(
                (task) => task.status === "completed",
              ).length;
              return (
                <section
                  key={tactic.id}
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={expanded}
                  className="mx-1.5 my-0.5 overflow-hidden rounded-md border border-transparent hover:border-border-subtle/40"
                >
                  <button
                    aria-expanded={expanded}
                    onClick={() => {
                      toggleTactic(tactic.id);
                      if (
                        expanded &&
                        selectedTaskId &&
                        tasks.some(
                          (task) =>
                            task.id === selectedTaskId &&
                            (task.primaryTacticId === tactic.id ||
                              (task.kind === "step" &&
                                tacticObjectives.some(
                                  (objective) => objective.id === task.parentId,
                                ))),
                        )
                      )
                        selectTask(null);
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-raised/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <Icon
                      name="chevron-right"
                      size={13}
                      className={cn(
                        "text-text-muted transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-text-secondary">
                          {tactic.name}
                        </span>
                        <span className="font-mono text-[10px] text-text-muted">
                          {tactic.id}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-muted">
                        {tacticObjectives.length
                          ? `${done}/${tacticObjectives.length} tasks complete`
                          : "No tasks"}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-text-muted">
                      {tacticObjectives.length}
                    </span>
                  </button>
                  {expanded && (
                    <div className="rounded-b-md bg-panel/25 pb-1">
                      {tacticObjectives.length === 0 ? (
                        <p className="px-9 py-2 text-[10px] italic text-text-muted">
                          No tasks in this tactic
                        </p>
                      ) : (
                        techniqueIds.map((techniqueId) => (
                          <TechniqueRow
                            key={techniqueId}
                            techniqueId={techniqueId}
                            tasks={
                              (tasksByTechnique[
                                `${tactic.id}:${techniqueId}`
                              ] as PentestObjective[]) ?? []
                            }
                            expanded={
                              !collapsedTechniques.includes(
                                `${tactic.id}:${techniqueId}`,
                              )
                            }
                            onToggle={() =>
                              setCollapsedTechniques((current) =>
                                current.includes(`${tactic.id}:${techniqueId}`)
                                  ? current.filter(
                                      (id) =>
                                        id !== `${tactic.id}:${techniqueId}`,
                                    )
                                  : [...current, `${tactic.id}:${techniqueId}`],
                              )
                            }
                            steps={tasks.filter(
                              (task): task is ExecutionStep =>
                                task.kind === "step",
                            )}
                            expandedTaskIds={expandedTaskIds}
                            selectedTaskId={selectedTaskId}
                            focusedTaskId={focusedTaskId}
                            onTaskToggle={toggleTask}
                            onSelect={selectTask}
                          />
                        ))
                      )}
                    </div>
                  )}
                </section>
              );
            })}
            {tasks.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-text-muted">
                Ask the Agent to create an ATT&amp;CK Task plan when you are
                ready to execute.
              </p>
            )}
          </div>
          {selectedTaskId && (
            <TaskDetail
              task={tasks.find((task) => task.id === selectedTaskId)}
              focused={focusedTaskId === selectedTaskId}
              onFocus={() =>
                void focusTask(
                  focusedTaskId === selectedTaskId ? null : selectedTaskId,
                )
              }
              onSave={upsertTask}
              onStatusChange={(status) =>
                updateTaskStatus(selectedTaskId, status)
              }
              onClose={() => selectTask(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function TechniqueRow({
  techniqueId,
  tasks,
  expanded,
  onToggle,
  steps,
  expandedTaskIds,
  selectedTaskId,
  focusedTaskId,
  onTaskToggle,
  onSelect,
}: {
  techniqueId: string;
  tasks: PentestObjective[];
  expanded: boolean;
  onToggle: () => void;
  steps: ExecutionStep[];
  expandedTaskIds: string[];
  selectedTaskId: string | null;
  focusedTaskId: string | null;
  onTaskToggle: (id: string) => void;
  onSelect: (id: string | null) => void;
}) {
  const technique = ATTACK_TECHNIQUES.find(
    (candidate) => candidate.id === techniqueId,
  );
  const completed = tasks.filter((task) => task.status === "completed").length;
  return (
    <div
      role="treeitem"
      aria-level={2}
      aria-expanded={expanded}
      className="ml-3 border-l border-border-subtle/70"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-10 w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-raised/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Icon
          name="chevron-right"
          size={11}
          className={cn(
            "text-text-muted transition-transform",
            expanded && "rotate-90",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-accent-blue">
              {techniqueId}
            </span>
            <span className="min-w-0 whitespace-normal break-words text-[11px] text-text-secondary">
              {technique?.name ?? "Unknown Technique"}
            </span>
          </div>
          <span className="text-[9px] text-text-muted">
            {completed}/{tasks.length} tasks complete
          </span>
        </div>
        <span className="font-mono text-[10px] text-text-muted">
          {tasks.length}
        </span>
      </button>
      {expanded && (
        <div className="pb-1">
          {tasks.map((objective) => (
            <ObjectiveRow
              key={objective.id}
              objective={objective}
              steps={steps.filter((step) => step.parentId === objective.id)}
              expanded={expandedTaskIds.includes(objective.id)}
              selectedTaskId={selectedTaskId}
              focusedTaskId={focusedTaskId}
              onToggle={onTaskToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectiveRow({
  objective,
  steps,
  expanded,
  selectedTaskId,
  focusedTaskId,
  onToggle,
  onSelect,
}: {
  objective: PentestObjective;
  steps: ExecutionStep[];
  expanded: boolean;
  selectedTaskId: string | null;
  focusedTaskId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string | null) => void;
}) {
  const completeSteps = steps.filter(
    (step) => step.status === "completed" || step.status === "skipped",
  ).length;
  const criteriaDone = objective.successCriteria.filter(
    (criterion) => criterion.completed,
  ).length;
  const activeStep = steps.find((step) => step.id === focusedTaskId);
  return (
    <div
      role="treeitem"
      aria-level={3}
      aria-expanded={expanded}
      className={cn(
        "border-l-2 border-l-transparent",
        selectedTaskId === objective.id &&
          "border-l-accent-blue bg-accent-blue/8",
      )}
    >
      <div className="group flex items-start gap-1.5 px-2.5 py-2 hover:bg-raised/25">
        <button
          aria-label={`${expanded ? "Collapse" : "Expand"} Steps for ${objective.title}`}
          onClick={() => onToggle(objective.id)}
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Icon
            name="chevron-right"
            size={11}
            className={cn("transition-transform", expanded && "rotate-90")}
          />
        </button>
        <button
          onClick={() => onSelect(objective.id)}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <div className="flex items-start gap-2">
            <TaskStatusIcon status={objective.status} />
            <span className="min-w-0 whitespace-normal break-words text-xs leading-5 text-text-primary">
              {objective.title}
            </span>
            {(focusedTaskId === objective.id || activeStep) && (
              <span className="shrink-0 rounded bg-accent-teal/10 px-1.5 py-0.5 text-[9px] text-accent-teal">
                {activeStep ? `STEP ${activeStep.order + 1} ACTIVE` : "FOCUSED"}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-5 text-[10px] text-text-muted">
            <span>{objective.targetAssetIds.length} target hints</span>
            <span>·</span>
            <span>
              {steps.length
                ? `${completeSteps}/${steps.length} steps`
                : "No steps planned"}
            </span>
            <span>·</span>
            <span>
              {criteriaDone}/{objective.successCriteria.length} criteria
            </span>
          </div>
        </button>
        <ObjectiveTraceButton nodeId={objective.id} />
      </div>
      {expanded && (
        <div className="ml-9 mr-2 border-l border-accent-teal/20 pb-1">
          {steps
            .sort((a, b) => a.order - b.order)
            .map((step) => (
              <StepRow
                key={step.id}
                step={step}
                selected={selectedTaskId === step.id}
                focused={focusedTaskId === step.id}
                onSelect={onSelect}
              />
            ))}
          {steps.length === 0 && (
            <p className="px-3 py-2 text-[10px] italic text-text-muted">
              Agent will create 3–7 Steps before the first real action.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ObjectiveTraceButton({ nodeId }: { nodeId: string }) {
  const sessionId = useSessionStore(
    (state) => state.currentSession?.id ?? null,
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TaskTracePackage | null>(null);
  const toggle = () => {
    setOpen((value) => !value);
    if (!trace && sessionId) {
      setLoading(true);
      void window.hexestra
        ?.invoke<TaskTracePackage>("tasks:trace", sessionId, nodeId)
        .then(setTrace)
        .catch(() => setTrace(null))
        .finally(() => setLoading(false));
    }
  };
  return (
    <div className="shrink-0">
      <button
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} Agent Task run trace`}
        onClick={toggle}
        className="mt-1 rounded border border-border-subtle px-1.5 py-1 text-[9px] text-text-muted hover:border-accent-blue/50 hover:text-accent-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {open ? "Hide trace" : "Trace"}
      </button>
      {open && <TracePanel trace={trace} loading={loading} onRetry={toggle} />}
    </div>
  );
}

function StepRow({
  step,
  selected,
  focused,
  onSelect,
}: {
  step: ExecutionStep;
  selected: boolean;
  focused: boolean;
  onSelect: (id: string | null) => void;
}) {
  const [traceOpen, setTraceOpen] = useState(false);
  const [trace, setTrace] = useState<TaskTracePackage | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionId = useSessionStore(
    (state) => state.currentSession?.id ?? null,
  );
  const toggleTrace = () => {
    setTraceOpen((open) => !open);
    if (!trace && sessionId) {
      setLoading(true);
      void window.hexestra
        ?.invoke<TaskTracePackage>("tasks:trace", sessionId, step.id)
        .then(setTrace)
        .catch(() => setTrace(null))
        .finally(() => setLoading(false));
    }
  };
  return (
    <div
      role="treeitem"
      aria-level={4}
      className={cn(
        "border-l-2 border-l-transparent px-2 py-2",
        selected && "border-l-accent-blue bg-accent-blue/8",
      )}
    >
      <div className="flex items-start gap-2">
        <TaskStatusIcon status={step.status} />
        <button
          onClick={() => onSelect(step.id)}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 font-mono text-[10px] text-text-muted">
              {String(step.order + 1).padStart(2, "0")}
            </span>
            <span className="whitespace-normal break-words text-[11px] leading-4 text-text-primary">
              {step.title}
            </span>
            {focused && (
              <span className="rounded bg-accent-teal/10 px-1 text-[9px] text-accent-teal">
                ACTIVE
              </span>
            )}
          </div>
          {step.resultSummary && (
            <p className="mt-1 pl-5 text-[10px] leading-4 text-text-secondary">
              {step.resultSummary}
            </p>
          )}
          {step.blockedReason && (
            <p className="mt-1 pl-5 text-[10px] leading-4 text-severity-medium">
              {step.blockedReason}
            </p>
          )}
          <p className="mt-1 pl-5 text-[9px] text-text-muted">
            {step.status.replace("_", " ")} · updated{" "}
            {new Date(step.updatedAt).toLocaleTimeString()}
          </p>
        </button>
        <button
          aria-expanded={traceOpen}
          aria-label={`${traceOpen ? "Hide" : "Show"} run trace for ${step.title}`}
          onClick={toggleTrace}
          className="mt-0.5 shrink-0 rounded border border-border-subtle px-1.5 py-1 text-[9px] text-text-muted hover:border-accent-blue/50 hover:text-accent-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {traceOpen ? "Hide trace" : "Trace"}
        </button>
      </div>
      {traceOpen && (
        <TracePanel trace={trace} loading={loading} onRetry={toggleTrace} />
      )}
    </div>
  );
}

function TracePanel({
  trace,
  loading,
  onRetry,
}: {
  trace: TaskTracePackage | null;
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading)
    return (
      <div
        role="status"
        className="ml-5 mt-2 rounded border border-border-subtle bg-canvas/60 px-2.5 py-2 text-[10px] text-text-muted"
      >
        Loading run trace…
      </div>
    );
  if (!trace)
    return (
      <div className="ml-5 mt-2 flex items-center justify-between gap-2 rounded border border-severity-medium/30 bg-severity-medium/8 px-2.5 py-2 text-[10px] text-severity-medium">
        <span>Trace unavailable.</span>
        <button
          onClick={onRetry}
          className="rounded border border-severity-medium/40 px-1.5 py-0.5 hover:bg-severity-medium/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Retry
        </button>
      </div>
    );
  return (
    <div className="ml-5 mt-2 rounded border border-border-subtle bg-canvas/60 p-2.5">
      <div className="mb-2 flex items-center justify-between text-[10px] text-text-muted">
        <span>{trace.entries.length} events</span>
        <span>
          {trace.stats.agentActions} agent · {trace.stats.subagentRuns}{" "}
          sub-agent
        </span>
      </div>
      {trace.entries.length === 0 ? (
        <p className="text-[10px] italic text-text-muted">
          No recorded activity yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {trace.entries.slice(0, 12).map((entry) => (
            <div key={entry.id} className="flex gap-2 text-[10px]">
              <span className="mt-0.5 text-accent-teal">•</span>
              <div className="min-w-0">
                <div className="text-text-secondary">{entry.label}</div>
                {entry.detail && (
                  <div className="break-words text-text-muted">
                    {entry.detail}
                  </div>
                )}
                <div className="font-mono text-[9px] text-text-muted">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskDetail({
  task,
  focused,
  onFocus,
  onSave,
  onStatusChange,
  onClose,
}: {
  task: PentestTask | undefined;
  focused: boolean;
  onFocus: () => void;
  onSave: (input: PentestTaskInput) => Promise<PentestTask | null>;
  onStatusChange: (status: TaskStatus) => void;
  onClose: () => void;
}) {
  const sessionId = useSessionStore(
    (state) => state.currentSession?.id ?? null,
  );
  const [context, setContext] = useState<{
    blockers?: string[];
    notices?: Array<{ message: string; severity?: "info" | "warning" }>;
    restrictions?: Array<{
      scope?: string;
      sources?: string[];
      text: string;
      matchedBy?: string[];
      conflictRuleIds?: string[];
    }>;
    skills?: Array<{ name: string; match: string }>;
    tools?: Array<{ name: string; available: boolean }>;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [techniques, setTechniques] = useState("");
  const [primaryTactic, setPrimaryTactic] = useState("");
  const [targets, setTargets] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [preferredTools, setPreferredTools] = useState("");
  const [preferredSkills, setPreferredSkills] = useState("");
  const [dependencies, setDependencies] = useState("");
  const [criteria, setCriteria] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setPrimaryTactic(task.primaryTacticId);
    setTechniques(task.techniqueIds[0] ?? "");
    setTargets(task.targetAssetIds.join(", "));
    setCapabilities(task.requiredCapabilities.join(", "));
    setPreferredTools(task.preferredToolIds.join(", "));
    setPreferredSkills(task.preferredSkillIds.join(", "));
    setDependencies(task.dependsOnTaskIds.join(", "));
    setCriteria(
      task.successCriteria
        .map(
          (criterion) =>
            `${criterion.completed ? "[x]" : "[ ]"} ${criterion.text}`,
        )
        .join("\n"),
    );
  }, [task?.id]);
  useEffect(() => {
    if (!task || !sessionId || !window.hexestra) {
      setContext(null);
      return;
    }
    void window.hexestra
      .invoke<typeof context>("tasks:context", sessionId, task.id)
      .then(setContext)
      .catch(() => setContext(null));
  }, [sessionId, task?.id]);
  if (!task) return null;
  const objective = task.kind === "objective";
  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        id: task.id,
        title,
        description,
        primaryTacticId: primaryTactic,
        techniqueIds: techniques ? [techniques] : [],
        targetAssetIds: targets
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        requiredCapabilities: capabilities
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        preferredToolIds: preferredTools
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        preferredSkillIds: preferredSkills
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        dependsOnTaskIds: dependencies
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        successCriteria: criteria
          .split(/\r?\n/)
          .map((line, index) => ({
            id: task.successCriteria[index]?.id,
            text: line.replace(/^\s*\[[ xX]\]\s*/, "").trim(),
            completed: /^\s*\[x\]/i.test(line),
          }))
          .filter((criterion) => criterion.text),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="max-h-[32rem] shrink-0 overflow-y-auto border-t border-border-subtle bg-panel/90 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            aria-label="Back to task list"
            onClick={onClose}
            className="mt-0.5 shrink-0 rounded border border-border-subtle p-1 text-text-muted hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Icon name="chevron-left" size={12} />
          </button>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-primary">
              {objective ? "Agent Task detail" : "Step detail"}
            </div>
            <div className="mt-0.5 break-words text-[11px] text-text-secondary">
              {task.title}
            </div>
          </div>
        </div>
        <span className="rounded bg-accent-blue/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-blue">
          {task.kind}
        </span>
      </div>
      <button
        onClick={onFocus}
        disabled={Boolean(task.diagnostics?.length)}
        className={cn(
          "mb-3 rounded border px-2 py-1 text-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          focused
            ? "border-accent-teal/40 bg-accent-teal/10 text-accent-teal"
            : "border-accent-blue/30 text-accent-blue disabled:opacity-40",
        )}
      >
        {focused ? "Unfocus" : "Focus for Agent"}
      </button>
      {objective ? (
        <div className="space-y-2">
          <Field label="Title">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="settings-input mt-1 w-full text-xs"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="settings-input mt-1 w-full resize-y text-2xs"
            />
          </Field>
          <Field label="Tactic">
            <select
              value={primaryTactic}
              onChange={(event) => {
                const nextTactic = event.target.value;
                setPrimaryTactic(nextTactic);
                const nextTechnique = ATTACK_TECHNIQUES.find((technique) =>
                  technique.tacticIds.includes(nextTactic),
                );
                if (nextTechnique) setTechniques(nextTechnique.id);
              }}
              className="settings-input mt-1 w-full font-mono text-2xs"
            >
              {ATTACK_TACTICS.map((tactic) => (
                <option key={tactic.id} value={tactic.id}>
                  {tactic.id} · {tactic.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Technique">
            <select
              value={techniques}
              onChange={(event) => setTechniques(event.target.value)}
              className="settings-input mt-1 w-full font-mono text-2xs"
            >
              <option value="">Select a technique</option>
              {ATTACK_TECHNIQUES.filter(
                (technique) =>
                  technique.tacticIds.includes(primaryTactic) ||
                  technique.id === techniques,
              ).map((technique) => (
                <option key={technique.id} value={technique.id}>
                  {technique.id} · {technique.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target asset IDs (advisory)">
            <input
              value={targets}
              onChange={(event) => setTargets(event.target.value)}
              className="settings-input mt-1 w-full font-mono text-2xs"
            />
          </Field>
          <Field label="Capabilities">
            <input
              value={capabilities}
              onChange={(event) => setCapabilities(event.target.value)}
              className="settings-input mt-1 w-full font-mono text-2xs"
            />
          </Field>
          <Field label="Preferred tools">
            <input
              value={preferredTools}
              onChange={(event) => setPreferredTools(event.target.value)}
              className="settings-input mt-1 w-full font-mono text-2xs"
            />
          </Field>
          <Field label="Preferred Skills">
            <input
              value={preferredSkills}
              onChange={(event) => setPreferredSkills(event.target.value)}
              className="settings-input mt-1 w-full font-mono text-2xs"
            />
          </Field>
          <Field label="Dependencies">
            <input
              value={dependencies}
              onChange={(event) => setDependencies(event.target.value)}
              className="settings-input mt-1 w-full font-mono text-2xs"
            />
          </Field>
          <Field label="Success criteria">
            <textarea
              value={criteria}
              onChange={(event) => setCriteria(event.target.value)}
              rows={3}
              className="settings-input mt-1 w-full resize-y font-mono text-2xs"
            />
          </Field>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded border border-accent-blue/30 bg-accent-blue/15 px-2 py-1 text-2xs text-accent-blue disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save Agent Task"}
          </button>
        </div>
      ) : (
        <div className="space-y-2 text-[10px] text-text-muted">
          <p>
            Execution Steps can only be renamed, described or reordered while
            pending.
          </p>
          <p>
            Status:{" "}
            <span className="text-text-secondary">
              {task.status.replace("_", " ")}
            </span>
          </p>
          {task.resultSummary && (
            <p>
              Result:{" "}
              <span className="text-text-secondary">{task.resultSummary}</span>
            </p>
          )}
          {task.blockedReason && (
            <p className="text-severity-medium">
              Blocked: {task.blockedReason}
            </p>
          )}
        </div>
      )}
      {context && (
        <div className="mt-3 space-y-1 rounded border border-border-subtle bg-canvas/50 p-2 text-[10px] text-text-muted">
          {context.blockers?.length ? (
            <div className="text-severity-medium">
              <span className="font-medium">Blockers:</span>{" "}
              {context.blockers.join(" · ")}
            </div>
          ) : null}
          {context.notices?.length ? (
            <div className="text-severity-medium">
              <span className="font-medium">Advisory:</span>{" "}
              {context.notices.map((notice) => notice.message).join(" · ")}
            </div>
          ) : null}
          <div>
            <span className="font-medium text-text-secondary">
              Restrictions:
            </span>{" "}
            {context.restrictions?.length
              ? context.restrictions
                  .map(
                    (restriction) =>
                      `${(restriction.sources ?? [restriction.scope ?? "unknown"]).join("/")}: ${restriction.text}${restriction.conflictRuleIds?.length ? " · possible conflict" : ""}`,
                  )
                  .join(" · ")
              : "none"}
          </div>
          <div>
            <span className="font-medium text-text-secondary">Skills:</span>{" "}
            {context.skills?.length
              ? context.skills
                  .slice(0, 4)
                  .map((skill) => `${skill.name} (${skill.match})`)
                  .join(", ")
              : "none"}
          </div>
          <div>
            <span className="font-medium text-text-secondary">Tools:</span>{" "}
            {context.tools?.length
              ? context.tools
                  .map(
                    (tool) =>
                      `${tool.name}${tool.available ? "" : " · unavailable"}`,
                  )
                  .join(", ")
              : "none matched"}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {(
          [
            "pending",
            "in_progress",
            "blocked",
            "skipped",
            "completed",
          ] as TaskStatus[]
        ).map((status) => (
          <button
            key={status}
            onClick={() => onStatusChange(status)}
            className={cn(
              "rounded border px-2 py-1 text-2xs",
              task.status === status
                ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                : "border-border-subtle text-text-muted hover:border-border-strong hover:text-text-primary",
            )}
          >
            {status.replace("_", " ")}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-2xs text-text-muted">
      {label}
      {children}
    </label>
  );
}
function TaskStatusIcon({ status }: { status: TaskStatus }) {
  const icons: Record<string, IconName> = {
    pending: "circle",
    in_progress: "activity",
    completed: "check",
    blocked: "pause",
    skipped: "skip",
    failed: "close",
  };
  const colors: Record<string, string> = {
    pending: "text-text-muted",
    in_progress: "text-accent-blue",
    completed: "text-accent-green",
    blocked: "text-severity-medium",
    skipped: "text-text-muted",
    failed: "text-severity-critical",
  };
  return (
    <Icon
      aria-hidden="true"
      name={icons[status] ?? "circle"}
      size={12}
      className={colors[status] ?? "text-text-muted"}
    />
  );
}
