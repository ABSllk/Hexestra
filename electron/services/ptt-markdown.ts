import crypto from 'crypto';
import {
  ATTACK_CATALOG_VERSION,
  ATTACK_TACTICS,
  type ExecutionStep,
  type PentestObjective,
  type PentestTask,
  type PentestTaskInput,
  type PttParseResult,
  type SuccessCriterion,
  type TaskStepInput,
  type TaskStepPlanInput,
  type TaskPlanGroupInput,
  type TaskStatus,
} from '../contracts/tasks';
import { deriveTactics, getTactic, getTechnique, isTechniqueId } from './attack-catalog';

export type { PentestTask, PentestTaskInput, TaskStatus } from '../contracts/tasks';
export type { PentestTaskInput as PttTaskInput } from '../contracts/tasks';

interface TaskMetadata {
  version: 1 | 2 | 3;
  kind?: 'objective' | 'step';
  id: string;
  title: string;
  description: string;
  primaryTacticId?: string;
  techniqueId?: string;
  tacticIds?: string[];
  techniqueIds?: string[];
  targetAssetIds?: string[];
  requiredCapabilities?: string[];
  preferredToolIds?: string[];
  preferredSkillIds?: string[];
  parentId?: string;
  order?: number;
  resultSummary?: string;
  blockedReason?: string;
  dependsOnTaskIds: string[];
  successCriteria: SuccessCriterion[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

type ParsedLineTask = any;

const TASK_LINE = /^(\s*)-\s+\[([ xX])\]\s+(.+?)\s*$/;
const META_LINE = /^(\s*)<!--\s*hexestra:task\s+data="([A-Za-z0-9_-]+)"\s*-->\s*$/i;
const LEGACY_HEADING = /^##\s+(?:Stage\s*[0-8]|Disengagement)/i;
const TACTIC_HEADING = /^##\s+(TA\d{4})\b(?:\s+(.+))?$/i;
const TECHNIQUE_HEADING = /^###\s+(T\d{4,5}(?:\.\d{3})?)\b(?:\s+(.+))?$/i;
const VALID_STATUS = new Set<TaskStatus>(['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed']);

export function parsePttMarkdown(markdown: string): PentestTask[] {
  return parsePttDocument(markdown).tasks;
}

export function parsePttDocument(markdown: string): PttParseResult {
  const lines = splitLines(markdown);
  const diagnostics: string[] = [];
  const catalogVersion = markdown.match(/ATT&CK\s+Catalog\s*:\*?\*?\s*(?:Enterprise\s+)?v?([\d.]+)/i)?.[1]
    ?? markdown.match(/ATT&CK\s+Enterprise\s+v([\d.]+)/i)?.[1];
  if (lines.some((line) => LEGACY_HEADING.test(line))) {
    return { kind: 'legacy_unsupported', tasks: [], diagnostics: ['This project uses the retired Stage 0-8 PTT format. Rebuild it as an ATT&CK task tree.'] };
  }

  const tasks: ParsedLineTask[] = [];
  const parents: ParsedLineTask[] = [];
  let maxMetadataVersion = 0;
  let tacticId: string | null = null;
  let techniqueId: string | null = null;
  lines.forEach((line, lineIndex) => {
    const tacticMatch = line.match(TACTIC_HEADING);
    if (tacticMatch) {
      tacticId = tacticMatch[1].toUpperCase();
      techniqueId = null;
      parents.length = 0;
      if (!getTactic(tacticId)) diagnostics.push(`Unknown ATT&CK tactic ${tacticId} at line ${lineIndex + 1}`);
      return;
    }
    const techniqueMatch = line.match(TECHNIQUE_HEADING);
    if (techniqueMatch) {
      techniqueId = techniqueMatch[1].toUpperCase();
      parents.length = 0;
      if (!isTechniqueId(techniqueId)) diagnostics.push(`Unknown ATT&CK technique ${techniqueId} at line ${lineIndex + 1}`);
      if (tacticId && getTechnique(techniqueId) && !getTechnique(techniqueId)!.tacticIds.includes(tacticId)) {
        diagnostics.push(`Technique ${techniqueId} is not mapped to tactic ${tacticId} at line ${lineIndex + 1}`);
      }
      return;
    }
    if (/^##\s+/.test(line)) {
      tacticId = null;
      techniqueId = null;
      parents.length = 0;
      return;
    }
    if (!tacticId) return;
    const taskMatch = line.match(TASK_LINE);
    if (!taskMatch) return;
    const indent = taskMatch[1].replace(/\t/g, '  ').length;
    while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop();
    const parent = parents[parents.length - 1];
    const metadataLine = lines[lineIndex + 1]?.match(META_LINE);
    const metadata = metadataLine ? decodeMetadata(metadataLine[2]) : null;
    if (metadata) maxMetadataVersion = Math.max(maxMetadataVersion, metadata.version);
    const title = taskMatch[3].trim();
    const taskTechniqueId = (metadata?.kind === 'objective' ? metadata.techniqueId ?? metadata.techniqueIds?.[0] : undefined) ?? techniqueId ?? undefined;
    const id = metadata?.id ?? (parent ? stableStepId(parent.kind === 'objective' ? parent.id : (parent.parentId ?? parent.id), title) : stableTaskId(tacticId, taskTechniqueId ?? 'unclassified', title));
    const statusFromCheckbox: TaskStatus = taskMatch[2].toLowerCase() === 'x' ? 'completed' : 'pending';
    const status = metadata && VALID_STATUS.has(metadata.status as TaskStatus)
      ? metadata.status as TaskStatus
      : statusFromCheckbox;
    const inferredKind = metadata?.kind ?? (parent ? 'step' : 'objective');
    const task: ParsedLineTask = metadata
      ? { ...metadata, kind: inferredKind, status, lineIndex, indent, ...(metadataLine ? { metadataLineIndex: lineIndex + 1 } : {}) }
      : {
        id,
        kind: inferredKind,
        title,
        description: '',
        status,
        primaryTacticId: tacticId,
        tacticIds: [tacticId],
        techniqueIds: taskTechniqueId ? [taskTechniqueId] : [],
        targetAssetIds: [],
        requiredCapabilities: [],
        preferredToolIds: [],
        preferredSkillIds: [],
        ...(parent ? { parentId: parent.kind === 'objective' ? parent.id : parents.find((candidate) => candidate.kind === 'objective')?.id } : {}),
        ...(inferredKind === 'step' ? { order: tasks.filter((candidate) => candidate.kind === 'step' && candidate.parentId === (parent?.kind === 'objective' ? parent.id : parents.find((candidate) => candidate.kind === 'objective')?.id)).length } : {}),
        dependsOnTaskIds: [],
        successCriteria: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date().toISOString(),
        diagnostics: ['Task metadata is missing; edit this task in the Task Detail editor before focusing it.'],
        lineIndex,
        indent,
    };
    if (!metadata) diagnostics.push(`Task "${title}" at line ${lineIndex + 1} is missing Hexestra metadata.`);
    else for (const issue of validateTaskMetadata(task)) diagnostics.push(`Task "${title}" at line ${lineIndex + 1}: ${issue}`);
    if (!metadata && parent && task.kind === 'step') task.parentId = parent.kind === 'objective' ? parent.id : parents.find((candidate) => candidate.kind === 'objective')?.id;
    tasks.push(task);
    parents.push(task);
  });

  const objectives = tasks.filter((task): task is ParsedLineTask & PentestObjective => task.kind === 'objective');
  const objectiveById = new Map(objectives.map((objective) => [objective.id, objective]));
  const normalizedTasks = tasks.map((task) => {
    if (task.kind === 'objective') return task;
    let parentId = task.parentId;
    const seen = new Set<string>();
    while (parentId && !objectiveById.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      parentId = tasks.find((candidate) => candidate.id === parentId)?.parentId;
    }
    const objective = objectiveById.get(parentId ?? '');
    if (!objective) return { ...task, diagnostics: [...(task.diagnostics ?? []), 'Step must have a parent Objective'] };
    return {
      ...task,
      parentId: objective.id,
      order: typeof task.order === 'number' ? task.order : tasks.filter((candidate) => candidate.kind === 'step' && candidate.parentId === objective.id).indexOf(task),
      primaryTacticId: objective.primaryTacticId,
      tacticIds: objective.tacticIds,
      techniqueIds: objective.techniqueIds,
      targetAssetIds: objective.targetAssetIds,
      requiredCapabilities: objective.requiredCapabilities,
      preferredToolIds: objective.preferredToolIds,
      preferredSkillIds: objective.preferredSkillIds,
      dependsOnTaskIds: task.dependsOnTaskIds ?? [],
    } as ParsedLineTask;
  });
  if (!catalogVersion && tasks.length > 0) diagnostics.push('PTT is missing the ATT&CK catalog version header.');
  return {
    kind: diagnostics.some((item) => /missing|unknown|retired|parent Objective/i.test(item)) ? 'invalid' : 'ok',
    tasks: normalizedTasks.map(({ lineIndex: _line, indent: _indent, metadataLineIndex: _meta, ...task }) => task),
    diagnostics,
    catalogVersion,
    metadataVersion: maxMetadataVersion || undefined,
  };
}

export function normalizePttMarkdown(markdown: string) {
  const parsed = parsePttDocument(markdown);
  const metadataVersions = [...markdown.matchAll(/hexestra:task\s+data="([A-Za-z0-9_-]+)"/gi)].map((match) => decodeMetadata(match[1])?.version ?? 2);
  const needsMigration = metadataVersions.some((version) => version < 3) || parsed.tasks.some((task) => task.kind === 'objective' && task.techniqueIds.length !== 1);
  if (!needsMigration) return { markdown, tasks: parsed.tasks, changed: false, parse: parsed };
  const migratedTasks = expandMultiTechniqueTasks(parsed.tasks);
  const migrated = renderCanonicalPttMarkdown(markdown, migratedTasks);
  const reparsed = parsePttDocument(migrated);
  return { markdown: migrated, tasks: reparsed.tasks, changed: true, parse: reparsed };
}

export function updatePttTaskStatus(markdown: string, taskId: string, status: TaskStatus) {
  const lines = splitLines(markdown);
  const parsed = parseLines(markdown);
  const task = parsed.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.kind === 'step' && status === 'completed' && !task.resultSummary?.trim()) throw new Error('Completed Steps require a concise result summary');
  if (task.kind === 'step' && (status === 'blocked' || status === 'failed') && !task.blockedReason?.trim()) throw new Error('Blocked or failed Steps require a reason');
  if (task.kind === 'objective' && status === 'completed') {
    const steps = parsed.filter((candidate): candidate is ExecutionStep => candidate.kind === 'step' && candidate.parentId === task.id);
    if (steps.some((step) => step.status !== 'completed' && step.status !== 'skipped')) throw new Error('Objective cannot be completed until every Step is completed or skipped');
  }
  if (status === 'completed' && task.successCriteria.some((criterion: { completed: boolean }) => !criterion.completed)) {
    throw new Error('Task cannot be completed until every success criterion is checked');
  }
  const source = lines[task.lineIndex];
  const match = source.match(TASK_LINE);
  if (!match || task.metadataLineIndex === undefined) throw new Error('Task metadata is missing; edit the task in the Task Detail editor first');
  lines[task.lineIndex] = `${match[1]}- [${status === 'completed' ? 'x' : ' '}] ${task.title}`;
  const next = withMetadata({ ...task, status, updatedAt: new Date().toISOString(), ...(status === 'in_progress' && !task.startedAt ? { startedAt: new Date().toISOString() } : {}), ...(status === 'completed' ? { completedAt: new Date().toISOString() } : {}) });
  lines[task.metadataLineIndex] = `${' '.repeat(task.indent + 2)}${next}`;
  return { markdown: joinLines(lines, markdown), task: { ...task, status } };
}

export function upsertPttTask(markdown: string, input: PentestTaskInput) {
  const title = input.title.trim();
  if (!title) throw new Error('Task title is required');
  const parsed = parsePttDocument(markdown);
  if (parsed.kind === 'legacy_unsupported') throw new Error(parsed.diagnostics[0]);
  const tasks = parseLines(markdown);
  const existing = input.id ? tasks.find((task) => task.id === input.id) : undefined;
  const now = new Date().toISOString();
  const techniqueIds = unique(input.techniqueIds ?? existing?.techniqueIds ?? []);
  const derivedTactics = deriveTactics(techniqueIds);
  const tacticIds = unique(derivedTactics.length ? derivedTactics : (existing?.tacticIds ?? []));
  const primaryTacticId = input.primaryTacticId ?? existing?.primaryTacticId ?? tacticIds[0];
  if (!primaryTacticId || !getTactic(primaryTacticId)) throw new Error('A valid primary ATT&CK tactic is required');
  if (techniqueIds.some((id) => !isTechniqueId(id))) throw new Error('Every task must reference a valid bundled ATT&CK technique');
  if (techniqueIds.length !== 1) throw new Error('Every Agent Task must reference exactly one ATT&CK technique');
  if (primaryTacticId && tacticIds.length && !tacticIds.includes(primaryTacticId)) throw new Error('Primary tactic must be derived from the selected techniques');
  const techniqueId = techniqueIds[0];
  if (!getTechnique(techniqueId)?.tacticIds.includes(primaryTacticId)) throw new Error(`Technique ${techniqueId} is not mapped to tactic ${primaryTacticId}`);
  if (existing?.kind === 'step') throw new Error('task_upsert only creates or edits Objective nodes');
  if (existing && existing.kind === 'objective' && (existing.status !== 'pending' || existing.startedAt)
    && (existing.primaryTacticId !== primaryTacticId || existing.techniqueIds[0] !== techniqueId)) {
    throw new Error('Started Agent Tasks cannot be reclassified');
  }
  const id = existing?.id ?? input.id ?? stableTaskId(primaryTacticId, techniqueId, title);
  const criteria = normalizeCriteria(input.successCriteria ?? existing?.successCriteria ?? []);
  if (criteria.length === 0) throw new Error('At least one success criterion is required');
  const task: PentestObjective = {
    id,
    kind: 'objective',
    title,
    description: input.description ?? existing?.description ?? '',
    status: input.status ?? existing?.status ?? 'pending',
    primaryTacticId,
    tacticIds,
    techniqueIds,
    targetAssetIds: unique(input.targetAssetIds ?? existing?.targetAssetIds ?? []),
    requiredCapabilities: unique(input.requiredCapabilities ?? existing?.requiredCapabilities ?? []),
    preferredToolIds: unique(input.preferredToolIds ?? existing?.preferredToolIds ?? []),
    preferredSkillIds: unique(input.preferredSkillIds ?? existing?.preferredSkillIds ?? []),
    dependsOnTaskIds: unique(input.dependsOnTaskIds ?? existing?.dependsOnTaskIds ?? []),
    successCriteria: criteria,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.startedAt ? { startedAt: existing.startedAt } : {}),
    ...(existing?.completedAt ? { completedAt: existing.completedAt } : {}),
  };
  if (task.status === 'completed' && task.successCriteria.some((criterion: SuccessCriterion) => !criterion.completed)) throw new Error('Task cannot be completed until every success criterion is checked');
  if (task.dependsOnTaskIds.includes(task.id)) throw new Error('A task cannot depend on itself');
  const taskIds = new Set(tasks.map((candidate) => candidate.id));
  for (const dependencyId of task.dependsOnTaskIds) if (!taskIds.has(dependencyId)) throw new Error(`Dependency task ${dependencyId} not found`);
  if (hasTaskDependencyCycle(task, tasks)) throw new Error('Task dependency graph contains a cycle');

  const nextTasks = existing ? tasks.map((candidate) => candidate.id === existing.id ? task : candidate) : [...tasks, task];
  const next = renderCanonicalPttMarkdown(markdown, nextTasks);
  const saved = parseLines(next).find((candidate) => candidate.id === task.id);
  if (!saved) throw new Error(`Failed to persist task ${task.id}`);
  return { markdown: next, task: saved };
}

export function planPttSteps(markdown: string, input: TaskStepPlanInput) {
  const tasks = parseLines(markdown);
  const objective = tasks.find((task) => task.id === input.objectiveId && task.kind === 'objective');
  if (!objective) throw new Error(`Objective ${input.objectiveId} not found`);
  if (tasks.some((task) => task.kind === 'step' && task.parentId === objective.id)) throw new Error('This Agent Task already has execution Steps');
  if (input.steps.length < 3 || input.steps.length > 7) throw new Error('Initial execution plan must contain 3 to 7 Steps');
  const titles = input.steps.map((step) => step.title.trim().toLocaleLowerCase());
  if (titles.some((title) => !title) || new Set(titles).size !== titles.length) throw new Error('Step titles must be non-empty and unique');
  let next = markdown;
  for (const [index, step] of input.steps.entries()) {
    next = insertPttStep(next, {
      parentId: objective.id,
      title: step.title,
      description: step.description,
      order: step.order ?? index,
    }).markdown;
  }
  return { markdown: next, steps: parsePttMarkdown(next).filter((task): task is ExecutionStep => task.kind === 'step' && task.parentId === objective.id) };
}

/** Validate and materialize an incremental Agent plan in one caller-visible write. */
export function planPttTasks(markdown: string, groups: TaskPlanGroupInput[]) {
  if (!groups.length) throw new Error('At least one ATT&CK planning group is required');
  let next = markdown;
  const created: PentestTask[] = [];
  for (const group of groups) {
    if (!getTactic(group.tacticId)) throw new Error(`Unknown ATT&CK tactic ${group.tacticId}`);
    if (!getTechnique(group.techniqueId)) throw new Error(`Unknown ATT&CK technique ${group.techniqueId}`);
    if (!getTechnique(group.techniqueId)!.tacticIds.includes(group.tacticId)) throw new Error(`Technique ${group.techniqueId} is not mapped to tactic ${group.tacticId}`);
    for (const input of group.tasks) {
      const result = upsertPttTask(next, { ...input, primaryTacticId: group.tacticId, techniqueIds: [group.techniqueId] });
      next = result.markdown;
      created.push(result.task);
    }
  }
  return { markdown: next, tasks: created };
}

export function insertPttStep(markdown: string, input: TaskStepInput) {
  const tasks = parseLines(markdown);
  const parent = tasks.find((task) => task.id === input.parentId && task.kind === 'objective');
  if (!parent) throw new Error(`Parent Objective ${input.parentId} not found`);
  if (!input.title.trim()) throw new Error('Step title is required');
  if (tasks.some((task) => task.kind === 'step' && task.parentId === parent.id && task.title.trim().toLocaleLowerCase() === input.title.trim().toLocaleLowerCase())) throw new Error('Step title must be unique within the Objective');
  const siblings = tasks.filter((task) => task.kind === 'step' && task.parentId === parent.id);
  const now = new Date().toISOString();
  const step: ExecutionStep = {
    id: input.id ?? stableStepId(parent.id, input.title),
    kind: 'step',
    parentId: parent.id,
    order: input.order ?? siblings.length,
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    status: input.status ?? 'pending',
    resultSummary: input.resultSummary?.trim() || undefined,
    blockedReason: input.blockedReason?.trim() || undefined,
    primaryTacticId: parent.primaryTacticId,
    tacticIds: parent.tacticIds,
    techniqueIds: parent.techniqueIds,
    targetAssetIds: parent.targetAssetIds,
    requiredCapabilities: parent.requiredCapabilities,
    preferredToolIds: parent.preferredToolIds,
    preferredSkillIds: parent.preferredSkillIds,
    dependsOnTaskIds: [],
    successCriteria: normalizeCriteria(input.successCriteria ?? []),
    createdAt: now,
    updatedAt: now,
  };
  const lines = splitLines(markdown);
  const parentLine = tasks.find((task) => task.id === parent.id)!;
  const insertAt = endOfTaskBranch(tasks, parentLine, lines);
  lines.splice(insertAt, 0, `  - [ ] ${step.title}`, `    ${withMetadata(step)}`);
  return { markdown: joinLines(lines, markdown), step };
}

export function updatePttStep(markdown: string, input: TaskStepInput) {
  const lines = splitLines(markdown);
  const tasks = parseLines(markdown);
  const existing = tasks.find((task) => task.id === input.id && task.kind === 'step') as (ParsedLineTask & ExecutionStep) | undefined;
  if (!existing) throw new Error(`Step ${input.id} not found`);
  if (existing.parentId !== input.parentId) throw new Error('Steps cannot move across Objectives');
  const titleChanged = input.title !== undefined && input.title.trim() !== existing.title;
  const descriptionChanged = input.description !== undefined && input.description.trim() !== existing.description;
  const orderChanged = input.order !== undefined && input.order !== existing.order;
  if (existing.status !== 'pending' && (titleChanged || orderChanged || descriptionChanged)) throw new Error('Started Steps cannot be renamed or reordered');
  const next: ExecutionStep = {
    ...existing,
    title: input.title?.trim() ?? existing.title,
    description: input.description?.trim() ?? existing.description,
    order: input.order ?? existing.order,
    status: input.status ?? existing.status,
    resultSummary: input.resultSummary?.trim() ?? existing.resultSummary,
    blockedReason: input.blockedReason?.trim() ?? existing.blockedReason,
    successCriteria: input.successCriteria ? normalizeCriteria(input.successCriteria) : existing.successCriteria,
    updatedAt: new Date().toISOString(),
    ...(input.status === 'in_progress' && !existing.startedAt ? { startedAt: new Date().toISOString() } : {}),
    ...(input.status === 'completed' ? { completedAt: new Date().toISOString() } : {}),
  };
  if (next.status === 'completed' && next.successCriteria.some((criterion) => !criterion.completed)) throw new Error('Step cannot be completed until every success criterion is checked');
  if (next.status === 'completed' && !next.resultSummary?.trim()) throw new Error('Completed Steps require a concise result summary');
  if ((next.status === 'blocked' || next.status === 'failed') && !next.blockedReason?.trim()) throw new Error('Blocked or failed Steps require a reason');
  const match = lines[existing.lineIndex].match(TASK_LINE);
  if (!match || existing.metadataLineIndex === undefined) throw new Error('Step metadata is missing');
  lines[existing.lineIndex] = `${match[1]}- [${next.status === 'completed' ? 'x' : ' '}] ${next.title}`;
  lines[existing.metadataLineIndex] = `${' '.repeat(existing.indent + 2)}${withMetadata(next)}`;
  return { markdown: joinLines(lines, markdown), step: next };
}

export function deletePttStep(markdown: string, stepId: string) {
  const lines = splitLines(markdown);
  const step = parseLines(markdown).find((task) => task.id === stepId && task.kind === 'step');
  if (!step || step.metadataLineIndex === undefined) throw new Error(`Step ${stepId} not found`);
  if (step.status !== 'pending') throw new Error('Started Steps cannot be deleted');
  let end = step.lineIndex + 1;
  while (end < lines.length) {
    const taskMatch = lines[end].match(TASK_LINE);
    if (taskMatch && taskMatch[1].replace(/\t/g, '  ').length <= step.indent) break;
    end += 1;
  }
  lines.splice(step.lineIndex, end - step.lineIndex);
  return joinLines(lines, markdown);
}

export function deletePttTask(markdown: string, taskId: string) {
  const lines = splitLines(markdown);
  const tasks = parseLines(markdown);
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.metadataLineIndex === undefined) throw new Error(`Task ${taskId} not found or has invalid metadata`);
  if (task.kind === 'step') throw new Error('Use the Step delete operation for Execution Steps');
  if (tasks.some((candidate) => candidate.parentId === taskId || candidate.dependsOnTaskIds.includes(taskId))) throw new Error('Cannot delete a task with children or dependents');
  lines.splice(task.metadataLineIndex, 1);
  lines.splice(task.lineIndex, 1);
  return joinLines(lines, markdown);
}

function parseLines(markdown: string): ParsedLineTask[] {
  const result = parsePttDocument(markdown);
  const lines = splitLines(markdown);
  const parsed: ParsedLineTask[] = [];
  const parents: ParsedLineTask[] = [];
  let tacticId: string | null = null;
  let techniqueId: string | null = null;
  lines.forEach((line, lineIndex) => {
    const heading = line.match(TACTIC_HEADING);
    if (heading) { tacticId = heading[1].toUpperCase(); techniqueId = null; parents.length = 0; return; }
    const techniqueHeading = line.match(TECHNIQUE_HEADING);
    if (techniqueHeading) { techniqueId = techniqueHeading[1].toUpperCase(); parents.length = 0; return; }
    if (/^##\s+/.test(line)) { tacticId = null; techniqueId = null; parents.length = 0; return; }
    if (!tacticId) return;
    const match = line.match(TASK_LINE);
    if (!match) return;
    const indent = match[1].replace(/\t/g, '  ').length;
    while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop();
    const parent = parents[parents.length - 1];
    const metadataMatch = lines[lineIndex + 1]?.match(META_LINE);
    const metadata = metadataMatch ? decodeMetadata(metadataMatch[2]) : null;
    const fallback = result.tasks.find((task) => task.id === (parent ? stableStepId(parent.kind === 'objective' ? parent.id : (parent.parentId ?? parent.id), match[3].trim()) : stableTaskId(tacticId!, techniqueId ?? 'unclassified', match[3].trim())));
    const task = metadata ?? fallback ?? createDraft(tacticId, match[3].trim(), parent?.id, techniqueId ?? undefined);
    const status: TaskStatus = match[2].toLowerCase() === 'x' ? 'completed' : task.status;
    const parsedTask: ParsedLineTask = { ...task, status, lineIndex, indent, ...(metadataMatch ? { metadataLineIndex: lineIndex + 1 } : {}) };
    parsed.push(parsedTask);
    parents.push(parsedTask);
  });
  return parsed;
}

function createDraft(tacticId: string, title: string, parentId?: string, techniqueId?: string): PentestTask {
  if (parentId) {
    return {
      id: stableStepId(parentId, title), kind: 'step', parentId, order: 0, title, description: '', status: 'pending',
      primaryTacticId: tacticId, tacticIds: [tacticId], techniqueIds: techniqueId ? [techniqueId] : [], targetAssetIds: [], requiredCapabilities: [],
      preferredToolIds: [], preferredSkillIds: [], dependsOnTaskIds: [], successCriteria: [],
      createdAt: new Date(0).toISOString(), updatedAt: new Date().toISOString(), diagnostics: ['Task metadata is missing'],
    };
  }
  return {
    id: stableTaskId(tacticId, techniqueId ?? 'unclassified', title), kind: 'objective', title, description: '', status: 'pending', primaryTacticId: tacticId,
    tacticIds: [tacticId], techniqueIds: techniqueId ? [techniqueId] : [], targetAssetIds: [], requiredCapabilities: [], preferredToolIds: [],
    preferredSkillIds: [], dependsOnTaskIds: [], successCriteria: [], createdAt: new Date(0).toISOString(),
    updatedAt: new Date().toISOString(), diagnostics: ['Task metadata is missing'],
  };
}

function hasTaskDependencyCycle(task: PentestTask, tasks: PentestTask[]) {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  byId.set(task.id, task);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const candidate = byId.get(id);
    const cycle = candidate?.dependsOnTaskIds.some((dependencyId) => visit(dependencyId)) ?? false;
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  return visit(task.id);
}

function decodeMetadata(value: string): (PentestTask & { status: TaskStatus; version: 1 | 2 | 3 }) | null {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const metadata = JSON.parse(decoded) as TaskMetadata & { status?: TaskStatus };
    if (metadata.version !== 1 && metadata.version !== 2 && metadata.version !== 3 || typeof metadata.id !== 'string') return null;
    if (typeof metadata.title !== 'string' || typeof metadata.description !== 'string') return null;
    const kind = metadata.kind ?? (metadata.parentId ? 'step' : 'objective');
    if (kind === 'objective' && (typeof metadata.primaryTacticId !== 'string'
      || !isStringArray(metadata.tacticIds) || !isStringArray(metadata.techniqueIds)
      || !isStringArray(metadata.targetAssetIds) || !isStringArray(metadata.requiredCapabilities)
      || !isStringArray(metadata.preferredToolIds) || !isStringArray(metadata.preferredSkillIds))) return null;
    if (!isStringArray(metadata.dependsOnTaskIds ?? []) || !Array.isArray(metadata.successCriteria)) return null;
    const status = metadata.status && VALID_STATUS.has(metadata.status) ? metadata.status : 'pending';
    if (kind === 'step' && !metadata.parentId) return null;
    return { ...metadata, kind, status, version: metadata.version, diagnostics: undefined } as PentestTask & { status: TaskStatus; version: 1 | 2 | 3 };
  } catch { return null; }
}

function validateTaskMetadata(task: PentestTask) {
  const issues: string[] = [];
  if (task.kind === 'step') {
    if (!task.parentId) issues.push('step must have a parent Objective');
    return issues;
  }
  if (!getTactic(task.primaryTacticId)) issues.push('primary tactic is invalid');
  if (task.techniqueIds.length !== 1) issues.push('exactly one ATT&CK technique is required');
  if (task.techniqueIds.some((id) => !isTechniqueId(id))) issues.push('contains an unknown ATT&CK technique');
  const derived = deriveTactics(task.techniqueIds);
  if (derived.length && !derived.some((id) => id === task.primaryTacticId)) issues.push('primary tactic is not derived from the selected techniques');
  if (task.techniqueIds.length === 1 && !getTechnique(task.techniqueIds[0])?.tacticIds.includes(task.primaryTacticId)) issues.push('task technique is not mapped to its tactic');
  if (task.successCriteria.length === 0) issues.push('at least one success criterion is required');
  if (task.status === 'completed' && task.successCriteria.some((criterion) => !criterion.completed)) issues.push('completed tasks require all success criteria');
  return issues;
}

function withMetadata(task: PentestTask) {
  const payload: TaskMetadata & { status: TaskStatus } = task.kind === 'step'
    ? {
      version: 3, kind: 'step', id: task.id, title: task.title, description: task.description, parentId: task.parentId,
      order: task.order, resultSummary: task.resultSummary, blockedReason: task.blockedReason, successCriteria: task.successCriteria,
      createdAt: task.createdAt, updatedAt: task.updatedAt, startedAt: task.startedAt, completedAt: task.completedAt,
      dependsOnTaskIds: [], status: task.status,
    }
    : {
      version: 3, kind: 'objective', id: task.id, title: task.title, description: task.description,
      primaryTacticId: task.primaryTacticId, tacticIds: task.tacticIds, techniqueId: task.techniqueIds[0], techniqueIds: task.techniqueIds,
      targetAssetIds: task.targetAssetIds, requiredCapabilities: task.requiredCapabilities,
      preferredToolIds: task.preferredToolIds, preferredSkillIds: task.preferredSkillIds,
      dependsOnTaskIds: task.dependsOnTaskIds, successCriteria: task.successCriteria,
      createdAt: task.createdAt, updatedAt: task.updatedAt, startedAt: task.startedAt, completedAt: task.completedAt, status: task.status,
    };
  delete (payload as unknown as { diagnostics?: string[] }).diagnostics;
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `<!-- hexestra:task data="${encoded}" -->`;
}

function normalizeCriteria(criteria: Array<Partial<SuccessCriterion> & Pick<SuccessCriterion, 'text'>>): SuccessCriterion[] {
  return criteria.map((criterion, index) => ({ id: criterion.id ?? `criterion-${index + 1}`, text: criterion.text.trim(), completed: criterion.completed === true })).filter((criterion) => criterion.text.length > 0);
}

function unique(values: string[]) { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function stableTaskId(tacticId: string, techniqueId: string, title: string) { return `ptt-${crypto.createHash('sha1').update(`${tacticId}:${techniqueId}:task:${title.trim().toLowerCase()}`).digest('hex').slice(0, 12)}`; }
function stableStepId(parentId: string, title: string) { return `step-${crypto.createHash('sha1').update(`${parentId}:${title.trim().toLowerCase()}`).digest('hex').slice(0, 12)}`; }
function endOfTaskBranch(tasks: ParsedLineTask[], parent: ParsedLineTask, lines: string[]) { const following = tasks.filter((task) => task.lineIndex > parent.lineIndex); const nextPeer = following.find((task) => task.indent <= parent.indent); return Math.min(nextPeer?.lineIndex ?? lines.length, findNextGroupHeading(lines, parent.lineIndex + 1)); }
function endOfTactic(tasks: ParsedLineTask[], tacticId: string, lines: string[]) { const heading = lines.findIndex((line) => line.match(TACTIC_HEADING)?.[1].toUpperCase() === tacticId); if (heading < 0) throw new Error(`Tactic ${tacticId} not found in PTT`); return findNextTacticHeading(lines, heading + 1); }
function findNextTacticHeading(lines: string[], start: number) { const relative = lines.slice(start).findIndex((line) => /^##\s+/.test(line)); return relative < 0 ? lines.length : start + relative; }
function findNextGroupHeading(lines: string[], start: number) { const relative = lines.slice(start).findIndex((line) => /^(?:##|###)\s+/.test(line)); return relative < 0 ? lines.length : start + relative; }
function splitLines(markdown: string) { return markdown.replace(/\r\n/g, '\n').split('\n'); }
function joinLines(lines: string[], original: string) { const value = lines.join('\n'); return original.endsWith('\n') && !value.endsWith('\n') ? `${value}\n` : value; }

function expandMultiTechniqueTasks(tasks: PentestTask[]) {
  const objectives = tasks.filter((task): task is PentestObjective => task.kind === 'objective');
  const steps = tasks.filter((task): task is ExecutionStep => task.kind === 'step');
  const result: PentestTask[] = [];
  for (const objective of objectives) {
    const techniqueIds = objective.techniqueIds.filter(isTechniqueId);
    const selectedTechniques = techniqueIds.length ? techniqueIds : ['unclassified'];
    selectedTechniques.forEach((techniqueId, index) => {
      const mappedTacticId = techniqueId === 'unclassified' ? objective.primaryTacticId : getTechnique(techniqueId)?.tacticIds[0] ?? objective.primaryTacticId;
      const nextObjective = index === 0
        ? { ...objective, primaryTacticId: mappedTacticId, tacticIds: [mappedTacticId], techniqueIds: techniqueId === 'unclassified' ? [] : [techniqueId] }
        : { ...objective, id: stableTaskId(mappedTacticId, techniqueId, objective.title), primaryTacticId: mappedTacticId, tacticIds: [mappedTacticId], techniqueIds: [techniqueId], diagnostics: ['Migrated from a multi-Technique task; review copied execution context.'] };
      result.push(nextObjective);
      if (index === 0) result.push(...steps.filter((step) => step.parentId === objective.id));
    });
  }
  return result;
}

function renderCanonicalPttMarkdown(original: string, tasks: PentestTask[]) {
  const lines = splitLines(original);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (TASK_LINE.test(lines[index])) {
      if (META_LINE.test(lines[index + 1] ?? '')) index += 1;
      continue;
    }
    kept.push(lines[index]);
  }
  for (const tactic of ATTACK_TACTICS) {
    const headingIndex = kept.findIndex((line) => line.match(TACTIC_HEADING)?.[1].toUpperCase() === tactic.id);
    if (headingIndex < 0) continue;
    const end = findNextTacticHeading(kept, headingIndex + 1);
    const nodes = tasks.filter((task): task is PentestObjective => task.kind === 'objective' && task.primaryTacticId === tactic.id);
    const techniqueIds = [...new Set(nodes.flatMap((task) => task.techniqueIds.slice(0, 1)))].filter((id) => isTechniqueId(id));
    const rendered = techniqueIds.flatMap((techniqueId) => {
      const technique = getTechnique(techniqueId);
      const techniqueTasks = nodes.filter((task) => task.techniqueIds[0] === techniqueId);
      const taskLines = techniqueTasks.flatMap((objective) => {
        const children = tasks.filter((task): task is ExecutionStep => task.kind === 'step' && task.parentId === objective.id).sort((left, right) => left.order - right.order);
        return [
          `- [${objective.status === 'completed' ? 'x' : ' '}] ${objective.title}`,
          `  ${withMetadata(objective)}`,
          ...children.flatMap((step) => [`  - [${step.status === 'completed' ? 'x' : ' '}] ${step.title}`, `    ${withMetadata(step)}`]),
        ];
      });
      return [`### ${techniqueId}${technique ? ` ${technique.name}` : ''}`, '', ...taskLines, ''];
    });
    kept.splice(end, 0, ...rendered);
  }
  return joinLines(kept, original);
}
