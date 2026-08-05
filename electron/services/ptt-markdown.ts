import crypto from 'crypto';

export type PentestStage = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'disengage';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped' | 'failed';

export interface PentestTask {
  id: string;
  stage: PentestStage;
  title: string;
  description: string;
  status: TaskStatus;
  parentId?: string;
  toolIds: string[];
  commands: string[];
  findingIds: string[];
  startedAt?: string;
  completedAt?: string;
}

export interface PttTaskInput {
  id?: string;
  stage: PentestStage;
  title: string;
  description?: string;
  status?: TaskStatus;
  parentId?: string;
}

interface ParsedLineTask extends PentestTask {
  lineIndex: number;
  indent: number;
}

const TASK_LINE = /^(\s*)-\s+\[([ xX])\]\s+(.+?)\s*$/;
const META = /\s*<!--\s*hexestra:task\s+id="([^"]+)"(?:\s+status="([a-z_]+)")?\s*-->\s*$/i;
const VALID_STATUS = new Set<TaskStatus>([
  'pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed',
]);

export function parsePttMarkdown(markdown: string): PentestTask[] {
  return parseTaskLines(markdown).map(({ lineIndex: _line, indent: _indent, ...task }) => task);
}

export function normalizePttMarkdown(markdown: string) {
  const lines = splitLines(markdown);
  const parsed = parseTaskLines(markdown);
  let changed = false;
  for (const task of parsed) {
    const line = lines[task.lineIndex];
    if (META.test(line)) continue;
    lines[task.lineIndex] = `${line} ${metadata(task.id, task.status)}`;
    changed = true;
  }
  return { markdown: joinLines(lines, markdown), tasks: parsePttMarkdown(joinLines(lines, markdown)), changed };
}

export function updatePttTaskStatus(markdown: string, taskId: string, status: TaskStatus) {
  const lines = splitLines(markdown);
  const task = parseTaskLines(markdown).find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const source = lines[task.lineIndex];
  const match = source.match(TASK_LINE);
  if (!match) throw new Error(`Task ${taskId} has an invalid Markdown line`);
  const title = stripMetadata(match[3]);
  const checkbox = status === 'completed' ? 'x' : ' ';
  lines[task.lineIndex] = `${match[1]}- [${checkbox}] ${title} ${metadata(task.id, status)}`;
  return { markdown: joinLines(lines, markdown), task: { ...task, status } };
}

export function upsertPttTask(markdown: string, input: PttTaskInput) {
  const title = input.title.trim();
  if (!title) throw new Error('Task title is required');
  const normalized = normalizePttMarkdown(markdown);
  const lines = splitLines(normalized.markdown);
  const tasks = parseTaskLines(normalized.markdown);
  const existing = input.id ? tasks.find((task) => task.id === input.id) : undefined;
  const status = input.status ?? existing?.status ?? 'pending';
  const id = existing?.id ?? input.id ?? stableTaskId(input.stage, title, input.parentId);
  const checkbox = status === 'completed' ? 'x' : ' ';

  if (existing) {
    const original = lines[existing.lineIndex].match(TASK_LINE);
    const indent = original?.[1] ?? ' '.repeat(existing.indent);
    lines[existing.lineIndex] = `${indent}- [${checkbox}] ${title} ${metadata(id, status)}`;
  } else {
    const parent = input.parentId ? tasks.find((task) => task.id === input.parentId) : undefined;
    if (input.parentId && (!parent || parent.stage !== input.stage)) {
      throw new Error(`Parent task ${input.parentId} not found in ${input.stage}`);
    }
    const indent = parent ? parent.indent + 2 : 0;
    const newLine = `${' '.repeat(indent)}- [${checkbox}] ${title} ${metadata(id, status)}`;
    const insertAt = parent
      ? endOfTaskBranch(tasks, parent, lines)
      : endOfStage(tasks, input.stage, lines);
    lines.splice(insertAt, 0, newLine);
  }

  const next = joinLines(lines, normalized.markdown);
  const task = parsePttMarkdown(next).find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Failed to persist task ${id}`);
  return { markdown: next, task };
}

function parseTaskLines(markdown: string): ParsedLineTask[] {
  const lines = splitLines(markdown);
  const tasks: ParsedLineTask[] = [];
  let stage: PentestStage | null = null;
  const parents: ParsedLineTask[] = [];

  lines.forEach((line, lineIndex) => {
    if (/^##\s+/.test(line)) {
      stage = stageFromHeading(line);
      parents.length = 0;
      return;
    }
    if (!stage) return;
    const match = line.match(TASK_LINE);
    if (!match) return;
    const indent = match[1].replace(/\t/g, '  ').length;
    const titleWithMeta = match[3];
    const meta = titleWithMeta.match(META);
    const title = displayTitle(titleWithMeta);
    if (!title) return;
    while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop();
    const parent = parents[parents.length - 1];
    const completed = match[2].toLowerCase() === 'x';
    const requestedStatus = meta?.[2]?.toLowerCase();
    const status = completed
      ? 'completed'
      : requestedStatus && VALID_STATUS.has(requestedStatus as TaskStatus)
        ? requestedStatus as TaskStatus
        : 'pending';
    const id = meta?.[1] ?? stableTaskId(stage, title, parent?.id);
    const task: ParsedLineTask = {
      id,
      stage,
      title,
      description: '',
      status,
      ...(parent ? { parentId: parent.id } : {}),
      toolIds: [],
      commands: [],
      findingIds: [],
      lineIndex,
      indent,
    };
    tasks.push(task);
    parents.push(task);
  });
  return tasks;
}

function stageFromHeading(heading: string): PentestStage | null {
  if (/disengagement/i.test(heading)) return 'disengage';
  const match = heading.match(/(?:stage\s*)?([0-8])(?:\.|:|\s)/i);
  return match ? `S${match[1]}` as PentestStage : null;
}

function stripMetadata(value: string) {
  return value.replace(META, '').trimEnd();
}

function displayTitle(value: string) {
  return stripMetadata(value).replace(/\s*<!--.*?-->\s*/g, ' ').trim();
}

function metadata(id: string, status: TaskStatus) {
  return `<!-- hexestra:task id="${id}" status="${status}" -->`;
}

function stableTaskId(stage: PentestStage, title: string, parentId?: string) {
  const key = `${stage}:${parentId ?? 'root'}:${title.trim().toLowerCase()}`;
  return `ptt-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
}

function endOfTaskBranch(tasks: ParsedLineTask[], parent: ParsedLineTask, lines: string[]) {
  const following = tasks.filter((task) => task.lineIndex > parent.lineIndex);
  const nextPeer = following.find((task) => task.indent <= parent.indent);
  const sectionEnd = findNextStageHeading(lines, parent.lineIndex + 1);
  return Math.min(nextPeer?.lineIndex ?? lines.length, sectionEnd);
}

function endOfStage(tasks: ParsedLineTask[], stage: PentestStage, lines: string[]) {
  const stageTasks = tasks.filter((task) => task.stage === stage);
  const headingIndex = lines.findIndex((line) => stageFromHeading(line) === stage);
  if (headingIndex < 0) throw new Error(`Stage ${stage} not found in PTT`);
  const sectionEnd = findNextStageHeading(lines, headingIndex + 1);
  if (!stageTasks.length) return headingIndex + 1;
  return sectionEnd;
}

function findNextStageHeading(lines: string[], start: number) {
  const relative = lines.slice(start).findIndex((line) => /^##\s+/.test(line) && stageFromHeading(line) !== null);
  return relative < 0 ? lines.length : start + relative;
}

function splitLines(markdown: string) {
  return markdown.replace(/\r\n/g, '\n').split('\n');
}

function joinLines(lines: string[], original: string) {
  const value = lines.join('\n');
  return original.endsWith('\n') && !value.endsWith('\n') ? `${value}\n` : value;
}
