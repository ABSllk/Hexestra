import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface ProjectMetadata {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed';
  opsecLevel: 'stealth' | 'balanced' | 'loud';
  autonomyLevel: 'low' | 'medium' | 'high';
  scope?: { inScope: string[]; outOfScope: string[]; targets: string[] };
  createdAt: string;
  updatedAt: string;
  targetCount: number;
  findingCount: number;
  vulnerabilityCount: number;
}

export interface RecentProjectReference {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
}

interface RecentProjectFile {
  version: 1;
  projects: RecentProjectReference[];
}

const PROJECT_ID = /^[a-zA-Z0-9-]{1,200}$/;
const MAX_RECENT_PROJECTS = 100;
export const PROJECT_DATA_DIRECTORY = '.hexestra';
const LEGACY_PROJECT_DATA_DIRECTORY = '.pengent';

export class ProjectRegistry {
  constructor(private readonly filePath: string) {}

  list(): RecentProjectReference[] {
    const state = this.read();
    const available = state.projects.filter((project) => projectExists(project.path, project.id));
    if (available.length !== state.projects.length) this.write({ version: 1, projects: available });
    return available;
  }

  remember(project: ProjectMetadata, projectPath: string) {
    const normalizedPath = normalizeProjectPath(projectPath);
    const state = this.read();
    const identityConflict = state.projects.find(
      (candidate) => candidate.id === project.id && !samePath(candidate.path, normalizedPath),
    );
    if (identityConflict) {
      throw new Error(`Project ${project.id} is already registered at another path`);
    }
    const projects = state.projects.filter(
      (candidate) => candidate.id !== project.id && !samePath(candidate.path, normalizedPath),
    );
    projects.unshift({
      id: project.id,
      path: normalizedPath,
      name: project.name,
      lastOpenedAt: new Date().toISOString(),
    });
    this.write({ version: 1, projects: projects.slice(0, MAX_RECENT_PROJECTS) });
  }

  remove(projectId: string) {
    assertProjectId(projectId);
    const state = this.read();
    this.write({
      version: 1,
      projects: state.projects.filter((project) => project.id !== projectId),
    });
  }

  resolve(projectId: string) {
    assertProjectId(projectId);
    return this.list().find((project) => project.id === projectId)?.path ?? null;
  }

  private read(): RecentProjectFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, projects: [] };
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<RecentProjectFile>;
      if (value.version !== 1 || !Array.isArray(value.projects)) return { version: 1, projects: [] };
      return {
        version: 1,
        projects: value.projects.flatMap(normalizeReference).slice(0, MAX_RECENT_PROJECTS),
      };
    } catch {
      return { version: 1, projects: [] };
    }
  }

  private write(value: RecentProjectFile) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}

export function readProjectMetadata(projectPath: string): ProjectMetadata | null {
  const metadataPath = projectMetadataPath(projectPath);
  if (!fs.existsSync(metadataPath)) return null;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    throw new Error('Hexestra project metadata is malformed');
  }
  const metadata = normalizeMetadata(value);
  if (!metadata) throw new Error('Hexestra project metadata is invalid');
  return metadata;
}

export function writeProjectMetadata(projectPath: string, metadata: ProjectMetadata) {
  const metadataPath = projectMetadataPath(projectPath);
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  const temporary = `${metadataPath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, metadataPath);
}

export function createProjectMetadata(projectPath: string, scope?: string): ProjectMetadata {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: path.basename(normalizeProjectPath(projectPath)),
    status: 'active',
    opsecLevel: 'balanced',
    autonomyLevel: 'medium',
    scope: scope ? { inScope: [scope], outOfScope: [], targets: [] } : undefined,
    createdAt: now,
    updatedAt: now,
    targetCount: 0,
    findingCount: 0,
    vulnerabilityCount: 0,
  };
}

export function normalizeProjectPath(value: string) {
  if (!value || !path.isAbsolute(value)) throw new Error('Project path must be absolute');
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Project folder does not exist');
  }
  return resolved;
}

export function projectMetadataPath(projectPath: string) {
  return path.join(projectDataPath(projectPath), 'project.json');
}

export function projectDataPath(projectPath: string) {
  const root = path.resolve(projectPath);
  const currentPath = path.join(root, PROJECT_DATA_DIRECTORY);
  const legacyPath = path.join(root, LEGACY_PROJECT_DATA_DIRECTORY);
  if (!fs.existsSync(currentPath) && fs.existsSync(legacyPath) && fs.statSync(legacyPath).isDirectory()) {
    fs.renameSync(legacyPath, currentPath);
  }
  return currentPath;
}

function projectExists(projectPath: string, projectId: string) {
  try {
    return readProjectMetadata(projectPath)?.id === projectId;
  } catch {
    return false;
  }
}

function normalizeReference(value: unknown): RecentProjectReference[] {
  if (!isRecord(value) || !PROJECT_ID.test(String(value.id ?? ''))) return [];
  if (typeof value.path !== 'string' || !path.isAbsolute(value.path)) return [];
  return [{
    id: String(value.id),
    path: path.resolve(value.path),
    name: typeof value.name === 'string' && value.name.trim()
      ? value.name.trim().slice(0, 200)
      : path.basename(value.path),
    lastOpenedAt: typeof value.lastOpenedAt === 'string'
      ? value.lastOpenedAt
      : new Date(0).toISOString(),
  }];
}

function normalizeMetadata(value: unknown): ProjectMetadata | null {
  if (!isRecord(value) || !PROJECT_ID.test(String(value.id ?? ''))) return null;
  if (typeof value.name !== 'string' || !value.name.trim()) return null;
  const status = value.status === 'paused' || value.status === 'completed' ? value.status : 'active';
  const opsecLevel = value.opsecLevel === 'stealth' || value.opsecLevel === 'loud'
    ? value.opsecLevel
    : 'balanced';
  const autonomyLevel = value.autonomyLevel === 'low' || value.autonomyLevel === 'high'
    ? value.autonomyLevel
    : 'medium';
  return {
    id: String(value.id),
    name: value.name.trim().slice(0, 200),
    status,
    opsecLevel,
    autonomyLevel,
    scope: normalizeScope(value.scope),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    targetCount: safeCount(value.targetCount),
    findingCount: safeCount(value.findingCount),
    vulnerabilityCount: safeCount(value.vulnerabilityCount),
  };
}

function normalizeScope(value: unknown): ProjectMetadata['scope'] {
  if (!isRecord(value)) return undefined;
  return {
    inScope: stringArray(value.inScope),
    outOfScope: stringArray(value.outOfScope),
    targets: stringArray(value.targets),
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : [];
}

function safeCount(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? Math.max(0, value) : 0;
}

function samePath(left: string, right: string) {
  return process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
}

function assertProjectId(value: string) {
  if (!PROJECT_ID.test(value)) throw new Error('Invalid project identifier');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
