import { BrowserWindow, dialog, ipcMain } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { resolveGlobalUserPath } from './hexestra-home';
import {
  WORKFLOW_IPC,
  type WorkflowDocument,
  type WorkflowExportResult,
  type WorkflowInvocation,
  type WorkflowRunPreparation,
  type WorkflowSaveInput,
  type WorkflowSummary,
} from '../contracts/workflows';

const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_WORKFLOW_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_VERSION_LENGTH = 64;
const MAX_TAG_LENGTH = 40;

interface ParsedWorkflow {
  frontmatter: Record<string, unknown>;
  body: string;
  diagnostics: string[];
}

export interface WorkflowImportResult {
  canceled: boolean;
  conflict?: boolean;
  sourcePath?: string;
  existing?: WorkflowSummary;
  workflow?: WorkflowDocument;
}

function uniqueStrings(value: unknown, maxLength = MAX_TAG_LENGTH): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= maxLength))];
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || `workflow-${Date.now().toString(36)}`;
}

function fingerprint(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function splitFrontmatter(raw: string): ParsedWorkflow {
  const diagnostics: string[] = [];
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: normalized.trim(), diagnostics: ['Workflow must start with YAML frontmatter.'] };
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closingIndex < 0) {
    return { frontmatter: {}, body: '', diagnostics: ['Workflow frontmatter is missing its closing --- marker.'] };
  }
  const frontmatterText = lines.slice(1, closingIndex).join('\n');
  let parsed: unknown;
  try {
    parsed = YAML.parse(frontmatterText);
  } catch (error) {
    return {
      frontmatter: {},
      body: lines.slice(closingIndex + 1).join('\n').trim(),
      diagnostics: [`Workflow frontmatter is invalid YAML: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    diagnostics.push('Workflow frontmatter must be a mapping.');
    return { frontmatter: {}, body: lines.slice(closingIndex + 1).join('\n').trim(), diagnostics };
  }
  return {
    frontmatter: parsed as Record<string, unknown>,
    body: lines.slice(closingIndex + 1).join('\n').replace(/^\n+/, '').trim(),
    diagnostics,
  };
}

function normalizeFrontmatter(frontmatter: Record<string, unknown>, body: string): {
  value?: { schema: 1; id: string; name: string; description: string; version: string; tags: string[] };
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const schema = frontmatter.schema;
  const id = typeof frontmatter.id === 'string' ? frontmatter.id.trim().toLowerCase() : '';
  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
  const versionValue = frontmatter.version;
  const version = typeof versionValue === 'string' || typeof versionValue === 'number'
    ? String(versionValue).trim()
    : '';
  const tags = uniqueStrings(frontmatter.tags);

  if (schema !== 1) diagnostics.push('Workflow schema must be 1.');
  if (!WORKFLOW_ID.test(id)) diagnostics.push('Workflow id must be 1–64 lowercase letters, numbers, or hyphens.');
  if (!name || name.length > MAX_NAME_LENGTH) diagnostics.push(`Workflow name must contain 1–${MAX_NAME_LENGTH} characters.`);
  if (description.length > MAX_DESCRIPTION_LENGTH) diagnostics.push(`Workflow description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  if (!version || version.length > MAX_VERSION_LENGTH) diagnostics.push(`Workflow version must contain 1–${MAX_VERSION_LENGTH} characters.`);
  if (Array.isArray(frontmatter.tags) && frontmatter.tags.some((tag) => typeof tag !== 'string' || tag.trim().length > MAX_TAG_LENGTH)) {
    diagnostics.push(`Workflow tags must be strings of at most ${MAX_TAG_LENGTH} characters.`);
  }
  if (!body.trim()) diagnostics.push('Workflow body must not be empty.');

  if (diagnostics.length) return { diagnostics };
  return { value: { schema: 1, id, name, description, version, tags }, diagnostics };
}

function canonicalWorkflow(value: { schema: 1; id: string; name: string; description: string; version: string; tags: string[] }, body: string): string {
  const frontmatter = YAML.stringify({
    schema: value.schema,
    id: value.id,
    name: value.name,
    description: value.description,
    version: value.version,
    tags: value.tags,
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body.trim()}\n`;
}

function validateWorkflowRaw(raw: string): { value?: { schema: 1; id: string; name: string; description: string; version: string; tags: string[]; body: string }; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const byteLength = Buffer.byteLength(raw, 'utf8');
  if (byteLength > MAX_WORKFLOW_BYTES) diagnostics.push(`Workflow file must be at most ${MAX_WORKFLOW_BYTES} bytes.`);
  const parsed = splitFrontmatter(raw);
  diagnostics.push(...parsed.diagnostics);
  const normalized = normalizeFrontmatter(parsed.frontmatter, parsed.body);
  diagnostics.push(...normalized.diagnostics);
  if (diagnostics.length || !normalized.value) return { diagnostics };
  return { value: { ...normalized.value, body: parsed.body }, diagnostics };
}

function workflowPath(root: string, id: string): string {
  if (!WORKFLOW_ID.test(id)) throw new Error('Invalid workflow id');
  const base = path.resolve(root);
  const candidate = path.resolve(base, `${id}.md`);
  if (path.dirname(candidate) !== base) throw new Error('Workflow path escaped the workflow library');
  return candidate;
}

function writeAtomic(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

function rawWorkflowDocument(filePath: string): { raw: string; stat: fs.Stats } {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Workflow path is not a file');
  if (stat.size > MAX_WORKFLOW_BYTES) throw new Error(`Workflow file must be at most ${MAX_WORKFLOW_BYTES} bytes.`);
  return { raw: fs.readFileSync(filePath, 'utf8'), stat };
}

export function parseWorkflowMarkdown(raw: string) {
  return validateWorkflowRaw(raw);
}

export function renderWorkflowMarkdown(input: WorkflowSaveInput): { raw?: string; diagnostics: string[]; id: string } {
  const id = (input.id?.trim().toLowerCase() || slugify(input.name));
  const value = {
    schema: 1 as const,
    id,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    version: input.version?.trim() || '1.0.0',
    tags: uniqueStrings(input.tags),
  };
  const raw = canonicalWorkflow(value, input.body);
  const validation = validateWorkflowRaw(raw);
  return { raw: validation.diagnostics.length ? undefined : raw, diagnostics: validation.diagnostics, id };
}

export class WorkflowService {
  private readonly root: string;

  constructor(root = path.join(resolveGlobalUserPath(), 'workflows'), registerHandlers = true) {
    this.root = path.resolve(root);
    if (registerHandlers) this.registerHandlers();
  }

  getRoot() { return this.root; }

  private registerHandlers() {
    if (!ipcMain?.handle) return;
    ipcMain.handle(WORKFLOW_IPC.LIST, () => this.list());
    ipcMain.handle(WORKFLOW_IPC.READ, (_event, id: string) => this.read(id));
    ipcMain.handle(WORKFLOW_IPC.SAVE, (_event, input: WorkflowSaveInput) => this.save(input));
    ipcMain.handle(WORKFLOW_IPC.DELETE, (_event, id: string, expectedFingerprint?: string) => this.remove(id, expectedFingerprint));
    ipcMain.handle(WORKFLOW_IPC.IMPORT, async (event, sourcePath?: string, overwrite = false) => sourcePath ? this.importFile(sourcePath, overwrite) : this.importFromDialog(event.sender, overwrite));
    ipcMain.handle(WORKFLOW_IPC.EXPORT, async (event, id: string) => this.exportFromDialog(event.sender, id));
    ipcMain.handle(WORKFLOW_IPC.PREPARE_RUN, (_event, id: string, note?: string) => this.prepareRun(id, note));
  }

  list(): WorkflowSummary[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => this.readSummary(path.join(this.root, entry.name)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  read(id: string): WorkflowDocument | null {
    const filePath = workflowPath(this.root, id);
    if (!fs.existsSync(filePath)) return null;
    return this.readDocument(filePath);
  }

  save(input: WorkflowSaveInput): WorkflowDocument {
    const rendered = renderWorkflowMarkdown(input);
    if (!rendered.raw) throw new Error(rendered.diagnostics.join('; '));
    const filePath = workflowPath(this.root, rendered.id);
    const existing = fs.existsSync(filePath) ? this.readDocument(filePath) : null;
    if (!existing && input.expectedFingerprint) throw new Error('Workflow does not exist for the supplied fingerprint');
    if (existing && input.expectedFingerprint && existing.fingerprint !== input.expectedFingerprint) throw new Error('Workflow changed on disk. Reload it before saving.');
    if (existing && !input.expectedFingerprint) throw new Error('Workflow id already exists. Reload it and confirm the overwrite before saving.');
    if (!existing && fs.existsSync(filePath)) throw new Error('Workflow id already exists.');
    writeAtomic(filePath, rendered.raw);
    return this.readDocument(filePath);
  }

  remove(id: string, expectedFingerprint?: string): boolean {
    const filePath = workflowPath(this.root, id);
    if (!fs.existsSync(filePath)) return false;
    const current = this.readDocument(filePath);
    if (expectedFingerprint && current.fingerprint !== expectedFingerprint) throw new Error('Workflow changed on disk. Reload it before deleting.');
    fs.unlinkSync(filePath);
    return true;
  }

  prepareRun(id: string, note?: string): WorkflowRunPreparation {
    const workflow = this.read(id);
    if (!workflow) throw new Error(`Workflow ${id} not found`);
    const trimmedNote = typeof note === 'string' ? note.trim().slice(0, 2_000) : '';
    const invocation: WorkflowInvocation = {
      workflowId: workflow.id,
      name: workflow.name,
      version: workflow.version,
      fingerprint: workflow.fingerprint,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    };
    const noteBlock = trimmedNote ? `\n\nAdditional note:\n${trimmedNote}` : '';
    const content = [
      `Run the user workflow "${workflow.name}" (${workflow.id}, version ${workflow.version}).`,
      '',
      'This is an operator-initiated, authorized security-testing request. First review the current PTT and existing findings, then reuse, adjust, or create tasks per the workflow body; once the task tree is consistent, continue with the first runnable task. Do not re-ask for authorization solely because of Scope or target labels.',
      '',
      '<hexestra_workflow>',
      workflow.body,
      '</hexestra_workflow>',
      noteBlock,
    ].join('\n');
    return { content, invocation };
  }

  private readDocument(filePath: string): WorkflowDocument {
    const { raw, stat } = rawWorkflowDocument(filePath);
    const parsed = validateWorkflowRaw(raw);
    if (parsed.diagnostics.length || !parsed.value) throw new Error(parsed.diagnostics.join('; '));
    return {
      ...parsed.value,
      fingerprint: fingerprint(raw),
      path: filePath,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  private readSummary(filePath: string): WorkflowSummary {
    try {
      const { raw, stat } = rawWorkflowDocument(filePath);
      const parsed = validateWorkflowRaw(raw);
      const value = parsed.value;
      return {
        schema: 1,
        id: value?.id ?? path.basename(filePath, path.extname(filePath)),
        name: value?.name ?? path.basename(filePath, path.extname(filePath)),
        description: value?.description ?? '',
        version: value?.version ?? '',
        tags: value?.tags ?? [],
        fingerprint: fingerprint(raw),
        path: filePath,
        updatedAt: stat.mtime.toISOString(),
        valid: parsed.diagnostics.length === 0 && Boolean(value),
        diagnostics: parsed.diagnostics,
      };
    } catch (error) {
      return {
        schema: 1,
        id: path.basename(filePath, path.extname(filePath)),
        name: path.basename(filePath, path.extname(filePath)),
        description: '',
        version: '',
        tags: [],
        fingerprint: '',
        path: filePath,
        updatedAt: new Date(0).toISOString(),
        valid: false,
        diagnostics: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private async importFromDialog(ownerContents: Electron.WebContents, overwrite: boolean): Promise<WorkflowImportResult> {
    const owner = BrowserWindow.fromWebContents(ownerContents);
    const result = owner
      ? await dialog.showOpenDialog(owner, { title: 'Import workflow', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] })
      : await dialog.showOpenDialog({ title: 'Import workflow', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return this.importFile(result.filePaths[0], overwrite);
  }

  importFile(sourcePath: string, overwrite = false): WorkflowImportResult {
    const source = path.resolve(sourcePath);
    const { raw } = rawWorkflowDocument(source);
    const parsed = validateWorkflowRaw(raw);
    if (parsed.diagnostics.length || !parsed.value) throw new Error(parsed.diagnostics.join('; '));
    const target = workflowPath(this.root, parsed.value.id);
    if (fs.existsSync(target) && !overwrite) {
      return { canceled: false, conflict: true, sourcePath: source, existing: this.readSummary(target) };
    }
    writeAtomic(target, canonicalWorkflow(parsed.value, parsed.value.body));
    return { canceled: false, sourcePath: source, workflow: this.readDocument(target) };
  }

  private async exportFromDialog(ownerContents: Electron.WebContents, id: string): Promise<WorkflowExportResult> {
    const workflow = this.read(id);
    if (!workflow) throw new Error(`Workflow ${id} not found`);
    const owner = BrowserWindow.fromWebContents(ownerContents);
    const result = owner
      ? await dialog.showSaveDialog(owner, { title: 'Export workflow', defaultPath: `${workflow.id}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
      : await dialog.showSaveDialog({ title: 'Export workflow', defaultPath: `${workflow.id}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    writeAtomic(path.resolve(result.filePath), canonicalWorkflow(workflow, workflow.body));
    return { canceled: false, filePath: result.filePath };
  }
}

export const workflowService = new WorkflowService();
